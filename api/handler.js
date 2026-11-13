import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { put, get } from '@vercel/blob';
import { Readable } from 'node:stream';

let pool;
const allEndpoints = new Set(['login','register','session','logout','profile','password_change','announcements','announcement_create','announcement_delete','notifications','notifications_read','my_history','track','admin_requests','admin_users','admin_assistance_details','admin_id_documents','request_status','my_request','assistance_create','id_application_create','profile_picture','document_download','document_upload']);
const disabled = new Set();
const s = v => String(v ?? '').trim();
const random = (n=16) => crypto.randomBytes(n).toString('hex');
const error = (message,status=400) => {let e=new Error(message);e.status=status;throw e;};
const requireMethod = (req,method) => {if(req.method!==method)error('Method not allowed.',405);};
// Railway MySQL can present a private/self-signed CA. Trust the actual CA
// instead of globally disabling TLS verification (which exposes PWD data).
const tlsOptions = () => {
 const enabled = String(process.env.DB_SSL || '').toLowerCase() === 'true';
 if (!enabled) return undefined;
 const raw = process.env.DB_SSL_CA || '';
 const encoded = process.env.DB_SSL_CA_BASE64 || '';
 if (raw && encoded) error('Set only one of DB_SSL_CA or DB_SSL_CA_BASE64.', 503);
 let ca;
 if (encoded) {
  try { ca = Buffer.from(encoded.replace(/\s/g, ''), 'base64').toString('utf8'); }
  catch { error('DB_SSL_CA_BASE64 is invalid.', 503); }
 } else if (raw) ca = raw.replace(/\\n/g, '\n');
 if (ca && (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----'))) {
  error('Database CA must be a PEM certificate.', 503);
 }
 // Never set rejectUnauthorized:false or disable Node's TLS verification.
 return {minVersion: 'TLSv1.2', rejectUnauthorized: true, ...(ca ? {ca} : {})};
};
const connection = () => {
 if (!pool) {
  const {DB_HOST,DB_USER,DB_NAME,DB_PASS,DB_PORT}=process.env;
  if (!DB_HOST || !DB_USER || !DB_NAME || DB_PASS===undefined) error('Database is not configured.',503);
  const port=Number(DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) error('Database port is invalid.',503);
  pool=mysql.createPool({
   host:DB_HOST,user:DB_USER,password:DB_PASS,database:DB_NAME,port,
   waitForConnections:true,connectionLimit:4,queueLimit:50,
   ssl:tlsOptions(),dateStrings:true
  });
 }
 return pool;
};
const query = async (sql,args=[],db) => (await (db||connection()).execute(sql,args))[0];
const first = async (sql,args=[],db) => (await query(sql,args,db))[0]||null;
const audit = async (uid,action,kind,id,details=null,db) => query('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)',[uid,action,kind,String(id??''),details?JSON.stringify(details):null],db);
const signingSecret = () => {if(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32)error('Session signing secret is not configured.',503);return process.env.SESSION_SECRET;};
const sign = data => {const encoded=Buffer.from(JSON.stringify(data)).toString('base64url');const signature=crypto.createHmac('sha256',signingSecret()).update(encoded).digest('base64url');return encoded+'.'+signature;};
const verify = token => {try {const [body,sig]=token.split('.');const expected=crypto.createHmac('sha256',signingSecret()).update(body).digest('base64url');if(!sig||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;const v=JSON.parse(Buffer.from(body,'base64url').toString());return v.exp>Date.now()&&v.uid? v:null;}catch{return null;}};
const cookieFor = (token,days=7) => `egabay_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days*86400}`;
const clearCookie = () => 'egabay_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
const getCookie = req => (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('egabay_session='))?.slice(15)||'';
const session = req => verify(decodeURIComponent(getCookie(req)));
const auth = async (req,roles) => {const token=session(req);if(!token)error('Please log in first.',401);const row=await first('SELECT user_id,full_name,email,role,account_status FROM users WHERE user_id=?',[token.uid]);if(!row||row.account_status!=='active')error('Please log in first.',401);if(roles&&!roles.includes(row.role))error('You are not authorized for this action.',403);return {user_id:Number(row.user_id),full_name:row.full_name,email:row.email,role:row.role,csrf_token:token.csrf};};
const csrf = (req,user) => {if(!user.csrf_token||req.headers['x-csrf-token']!==user.csrf_token)error('Security token expired. Refresh and try again.',403);};
const current = u => ({user_id:u.user_id,full_name:u.full_name,email:u.email,role:u.role});
const allowedStatus=['Received','Under review','Update available','Approved','Rejected','Closed'];
// Each upload is a separate JSON request (<= 2 MiB) to stay below Vercel Function limits.
// Stored objects MUST go into a PRIVATE Blob store; never expose the direct blob URL.
const fileFields = {
 applicationForm:'application_form',medicalCertificate:'medical_certificate',barangayCertificate:'barangay_certificate',
 validId:'valid_id',birthOrMarriageCertificate:'birth_or_marriage_certificate',idPhotos:'id_photo',wholeBodyPhoto:'whole_body_photo',
 oldPwdId:'old_pwd_id',affidavitOfLoss:'affidavit_of_loss',assistancePwdId:'assistance_pwd_id',
 disabilityPhoto:'assistance_disability_photo',assistanceMedicalCertificate:'assistance_medical_certificate'
};
const MAX_UPLOAD=2*1024*1024;
const validDocument = (buffer,mime) => {
 const jpg=buffer.length>=3 && buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff;
 const png=buffer.length>=8 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const pdf=buffer.length>=5 && buffer.subarray(0,5).toString()==='%PDF-';
 return (mime==='image/jpeg'&&jpg)||(mime==='image/png'&&png)||(mime==='application/pdf'&&pdf);
};
const parseDocTokens=(docs,uid,category,type,lost) => {
 if(!Array.isArray(docs)||docs.length>18)error('Invalid document list (maximum 18 files).',422);
 const allowed=category==='assistance'?['assistancePwdId','disabilityPhoto','assistanceMedicalCertificate']:
 ['applicationForm','medicalCertificate','barangayCertificate','validId','birthOrMarriageCertificate','idPhotos','wholeBodyPhoto','oldPwdId','affidavitOfLoss'];
 const result=[];
 for(const doc of docs){
  const field=s(doc?.field),token=s(doc?.token);
  if(!allowed.includes(field))error('Invalid document category.',422);
  const payload=verify(token);
  if(!payload||payload.kind!=='staged_doc'||payload.uid!==uid||payload.field!==field||!payload.pathname?.startsWith(`egabay/${uid}/`))error('Invalid or expired uploaded document. Please upload it again.',422);
  if(result.some(x=>x.pathname===payload.pathname))error('Repeated uploaded document.',422);
  result.push(payload);
 }
 const mandatory=category==='assistance'?['assistancePwdId','disabilityPhoto','assistanceMedicalCertificate']:
 type==='new'?['applicationForm','medicalCertificate','barangayCertificate','validId','idPhotos']:
 type==='renewal'?['applicationForm','medicalCertificate','barangayCertificate','validId','idPhotos',lost?'affidavitOfLoss':'oldPwdId']:
 ['applicationForm','medicalCertificate','barangayCertificate','validId','idPhotos','affidavitOfLoss'];
 for(const field of mandatory)if(!result.some(x=>x.field===field))error(`Missing required document: ${field}.`,422);
 if(category==='pwd_id'){
  if(type==='new'&&result.some(x=>['oldPwdId','affidavitOfLoss'].includes(x.field)))error('Document does not match application type.',422);
  if(type==='renewal'&&result.some(x=>lost?x.field==='oldPwdId':x.field==='affidavitOfLoss'))error('Old ID and loss declaration conflict.',422);
 }
 return result;
};
const saveDocuments=async (db,requestId,docs)=>{
 for(const doc of docs){
  await query('INSERT INTO application_documents(request_id,document_type,original_file_name,stored_file_name,file_path,mime_type,file_size_bytes) VALUES(?,?,?,?,?,?,?)',
  [requestId,fileFields[doc.field],doc.filename,doc.pathname,'blob:'+doc.pathname,doc.mime,doc.size],db);
 }
};
const requestResponse=(reference,type,municipality,status='Received')=>({id:reference,type,municipality,status,explanation:null});
const requestReference=()=>`EG-${Date.now().toString(36).toUpperCase()}-${random(4).toUpperCase()}`;
const municipalities=['Boac','Mogpog','Gasan','Buenavista','Santa Cruz','Torrijos'];
const municipalId = async name => {if(!s(name))return null;return (await first('SELECT municipality_id FROM municipalities WHERE municipality_name=?',[s(name)]))?.municipality_id||null;};
const validateProfile = async d => {
 const f={full:s(d.name||d.full_name),email:s(d.email).toLowerCase(),contact:s(d.contact_number),sex:s(d.sex),birth:s(d.birth_date),addr:s(d.address_line),municipality:s(d.municipality),barangay:s(d.barangay),pwdId:s(d.pwd_id_number),disability:s(d.disability_type),expiry:s(d.id_valid_until)};
 if(!f.full||f.full.length>150||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)||f.email.length>150)error('Enter a complete name and valid email.',422);
 if(f.contact&&!/^\+?[0-9 ()-]{7,30}$/.test(f.contact))error('Enter a valid contact number.',422);
 if(!['','Female','Male','Prefer not to say','Other'].includes(f.sex))error('Choose a valid sex option.',422);
 if(f.addr.length>255||f.barangay.length>120||f.pwdId.length>80||f.disability.length>150)error('One or more fields exceed the character limit.',422);
 for(const key of ['birth','expiry'])if(f[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(f[key])||!Number.isFinite(Date.parse(f[key]))))error('Invalid date.',422);
 if(f.birth&&(f.birth>'2099-01-01'||f.birth<'1900-01-01'))error('Invalid birth date.',422);
 f.mid=f.municipality?await municipalId(f.municipality):null;if(f.municipality&&!f.mid)error('Choose a valid Marinduque municipality.',422);
 return f;
};
const saveProfile = (uid,f,db) => query('INSERT INTO pwd_profiles(user_id,municipality_id,barangay,address_line,birth_date,sex,pwd_id_number,disability_type,id_valid_until) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE municipality_id=VALUES(municipality_id),barangay=VALUES(barangay),address_line=VALUES(address_line),birth_date=VALUES(birth_date),sex=VALUES(sex),pwd_id_number=VALUES(pwd_id_number),disability_type=VALUES(disability_type),id_valid_until=VALUES(id_valid_until)',[uid,f.mid,f.barangay||null,f.addr||null,f.birth||null,f.sex||null,f.pwdId||null,f.disability||null,f.expiry||null],db);
const profileFor = async uid => {
 const row=await first('SELECT u.user_id,u.full_name,u.email,u.contact_number,u.role,u.account_status,p.birth_date,p.sex,p.address_line,p.barangay,p.pwd_id_number,p.disability_type,p.id_valid_until,p.profile_picture,m.municipality_name AS municipality FROM users u LEFT JOIN pwd_profiles p ON p.user_id=u.user_id LEFT JOIN municipalities m ON m.municipality_id=p.municipality_id WHERE u.user_id=?',[uid]);
 if(!row)error('User not found.',404);
 if(row.birth_date){const b=new Date(row.birth_date),now=new Date();row.age=now.getUTCFullYear()-b.getUTCFullYear()-(now.toISOString().slice(5,10)<row.birth_date.slice(5,10)?1:0);}else row.age=null;
 row.profile_picture_url=row.profile_picture?`api/profile_picture.php?user_id=${Number(uid)}`:null;delete row.profile_picture;return row;
};
const trans = async fn => {const db=await connection().getConnection();try{await db.beginTransaction();const r=await fn(db);await db.commit();return r;}catch(e){await db.rollback();throw e;}finally{db.release();}};
const issueSession = (res,u) => {const csrf=random(32);res.setHeader('Set-Cookie',cookieFor(sign({uid:Number(u.user_id),csrf,exp:Date.now()+7*86400000})));return current(u);};

async function route(endpoint,req,res,params){
 const d=req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body)?req.body:{};
 if(endpoint==='login'){
  requireMethod(req,'POST');const email=s(d.email).toLowerCase(),password=String(d.password||''),role=s(d.role);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!password)error('Enter a valid email and password.',422);
  const u=await first('SELECT user_id,full_name,email,password_hash,role,account_status FROM users WHERE email=? LIMIT 1',[email]);
  if(!u)error('No registered account was found for this email. Please register first.',401);
  const hash=String(u.password_hash||'').replace(/^\$2y\$/,'$2b$');
  if(!hash.startsWith('$2')||!await bcrypt.compare(password,hash))error('Incorrect password. Please try again.',401);
  if(u.account_status!=='active')error('This account is not active. Contact the PDAO office.',403);
  if(role&&role!==u.role&&!(role==='staff'&&u.role==='admin'))error('The selected role does not match this account.',403);
  await query('UPDATE users SET last_login_at=NOW() WHERE user_id=?',[u.user_id]);await audit(u.user_id,'login','user',u.user_id);
  return {success:true,message:'Login successful.',user:issueSession(res,u)};
 }
 if(endpoint==='register'){
  requireMethod(req,'POST');const f=await validateProfile(d),password=String(d.password||''),role=s(d.role),patient=s(d.patientName);
  if(password.length<8||password.length>128)error('Password must be 8–128 characters.',422);
  if(!['pwd','caregiver'].includes(role))error('Only PWD and caregiver accounts can register publicly.',403);
  if(role==='caregiver'&&(!patient||patient.length>150))error('Enter the patient name for the caregiver account.',422);
  if(await first('SELECT user_id FROM users WHERE email=? LIMIT 1',[f.email]))error('An account with this email already exists. Please log in.',409);
  const uid=await trans(async db=>{const username=f.email.split('@')[0].replace(/[^a-z0-9_]/gi,'')+random(4);const r=await query("INSERT INTO users(full_name,username,email,contact_number,password_hash,role,account_status) VALUES(?,?,?,?,?,?,'active')",[f.full,username,f.email,f.contact||null,await bcrypt.hash(password,12),role],db);const id=r.insertId;await saveProfile(id,f,db);if(role==='caregiver')await query('INSERT INTO caregiver_links(caregiver_user_id,patient_name,authorization_confirmed) VALUES(?,?,1)',[id,patient],db);await audit(id,'register','user',id,{role},db);return id;});
  return {success:true,message:'Registration successful.',user:issueSession(res,{user_id:uid,full_name:f.full,email:f.email,role})};
 }
 if(endpoint==='logout'){requireMethod(req,'POST');res.setHeader('Set-Cookie',clearCookie());return {success:true,message:'Logged out.'};}
 const user=await auth(req);
 if(endpoint==='session'){
  requireMethod(req,'GET');const data=current(user);
  if(user.role==='caregiver')data.patient_name=(await first('SELECT patient_name FROM caregiver_links WHERE caregiver_user_id=? ORDER BY caregiver_link_id DESC LIMIT 1',[user.user_id]))?.patient_name||'';
  return {success:true,authenticated:true,user:data,csrf_token:user.csrf_token};
 }
 if(endpoint==='profile'){
  if(req.method==='GET')return {success:true,profile:await profileFor(user.user_id)};
  requireMethod(req,'POST');csrf(req,user);const f=await validateProfile(d);
  await trans(async db=>{await query('UPDATE users SET full_name=?,email=?,contact_number=? WHERE user_id=?',[f.full,f.email,f.contact||null,user.user_id],db);await saveProfile(user.user_id,f,db);await audit(user.user_id,'profile_update','user',user.user_id,null,db);});
  return {success:true,message:'Profile updated.',profile:await profileFor(user.user_id)};
 }
 if(endpoint==='profile_picture'){
  if(req.method==='GET'){
   const requested=Number(params.get('user_id')||user.user_id);
   if(!Number.isSafeInteger(requested)||requested<1)error('Invalid user.',422);
   if(requested!==user.user_id&&!['staff','admin'].includes(user.role))error('You cannot view this profile picture.',403);
   const picture=await first('SELECT profile_picture FROM pwd_profiles WHERE user_id=?',[requested]);
   if(!picture?.profile_picture)error('Profile picture not found.',404);
   // Only allow private objects in the per-user profile-picture prefix.
   if(!/^profile\/[0-9]+\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(picture.profile_picture)||!picture.profile_picture.startsWith(`profile/${requested}/`))error('Invalid profile picture record.',404);
   const blob=await get(picture.profile_picture,{access:'private'});
   if(!blob||blob.statusCode!==200||!blob.stream)error('Profile picture not found in storage.',404);
   const type=picture.profile_picture.endsWith('.png')?'image/png':picture.profile_picture.endsWith('.webp')?'image/webp':'image/jpeg';
   res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('X-Content-Type-Options','nosniff');
   res.setHeader('Cache-Control','private, no-store');
   await new Promise((resolve,reject)=>Readable.fromWeb(blob.stream).on('error',reject).pipe(res).on('finish',resolve).on('error',reject));
   res._egabayStreamed=true;return null;
  }
  requireMethod(req,'POST');csrf(req,user);
  const mime=s(d.mime),data=s(d.base64),allowed=['image/jpeg','image/png','image/webp'];
  if(!allowed.includes(mime))error('Choose a JPG, PNG or WEBP image.',422);
  if(!data||data.length>Math.ceil(MAX_UPLOAD*4/3)+16||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))error('Photo must be under 2 MB.',413);
  const contents=Buffer.from(data,'base64');
  const webp=contents.length>=12&&contents.toString('ascii',0,4)==='RIFF'&&contents.toString('ascii',8,12)==='WEBP';
  if(!contents.length||contents.length>MAX_UPLOAD||!(validDocument(contents,mime)||(mime==='image/webp'&&webp)))error('The photo does not match its selected format.',422);
  const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
  const pathname=`profile/${user.user_id}/${random(12)}.${ext}`;
  await put(pathname,contents,{access:'private',contentType:mime,addRandomSuffix:false});
  // Keep this storage path under the existing VARCHAR(60) database column.
  await query('INSERT INTO pwd_profiles(user_id,profile_picture) VALUES(?,?) ON DUPLICATE KEY UPDATE profile_picture=VALUES(profile_picture)',[user.user_id,pathname]);
  await audit(user.user_id,'profile_photo_update','user',user.user_id);
  return {success:true,message:'Profile picture uploaded successfully.',url:'api/profile_picture.php'};
 }
 if(endpoint==='password_change'){
  requireMethod(req,'POST');csrf(req,user);const old=String(d.current_password||''),next=String(d.new_password||'');
  if(next.length<8||next.length>128)error('New password must be 8–128 characters.',422);
  const row=await first('SELECT password_hash FROM users WHERE user_id=?',[user.user_id]);
  if(!await bcrypt.compare(old,String(row?.password_hash||'').replace(/^\$2y\$/,'$2b$')))error('Current password is incorrect.',403);
  await query('UPDATE users SET password_hash=? WHERE user_id=?',[await bcrypt.hash(next,12),user.user_id]);return {success:true,message:'Password changed successfully.'};
 }
 if(endpoint==='announcements'){
  requireMethod(req,'GET');return {success:true,items:await query('SELECT public_id AS id,title,announcement_date AS date,category,details,location,created_at AS createdAt FROM announcements WHERE is_published=1 ORDER BY announcement_date DESC,created_at DESC')};
 }
 if(endpoint==='notifications'){
  requireMethod(req,'GET');return {success:true,items:await query('SELECT n.notification_id AS id,n.title,n.message,n.created_at AS createdAt,CASE WHEN r.notification_id IS NULL THEN 0 ELSE 1 END AS `read` FROM notifications n LEFT JOIN user_notification_reads r ON r.notification_id=n.notification_id AND r.user_id=? WHERE (n.recipient_user_id=? OR n.recipient_role=?) AND (n.expires_at IS NULL OR n.expires_at>NOW()) ORDER BY n.created_at DESC LIMIT 50',[user.user_id,user.user_id,user.role])};
 }
 if(endpoint==='notifications_read'){
  requireMethod(req,'POST');csrf(req,user);await query('INSERT IGNORE INTO user_notification_reads(notification_id,user_id) SELECT notification_id,? FROM notifications WHERE recipient_user_id=? OR recipient_role=?',[user.user_id,user.user_id,user.role]);return {success:true};
 }
 if(endpoint==='my_history'){
  requireMethod(req,'GET');return {success:true,requests:await query('SELECT s.reference_code,s.request_category,s.request_type,s.applicant_name,s.status,s.submitted_at,s.location_text,s.barangay,m.municipality_name AS municipality,a.assistance_type,a.details AS assistance_details FROM service_requests s LEFT JOIN municipalities m ON m.municipality_id=s.municipality_id LEFT JOIN assistance_request_details a ON a.request_id=s.request_id WHERE s.submitted_by_user_id=? OR s.applicant_user_id=? ORDER BY s.submitted_at DESC',[user.user_id,user.user_id])};
 }
 if(endpoint==='my_request'){
  requireMethod(req,'POST');csrf(req,user);
  if(!['pwd','caregiver'].includes(user.role))error('Only PWD users and caregivers can modify their requests.',403);
  const action=s(d.action),ref=s(d.reference).toUpperCase();
  if(!['edit','delete'].includes(action)||!ref||ref.length>100)error('Invalid request action or reference.',422);
  return await trans(async db=>{
   const reqrow=await first('SELECT request_id,request_category,status FROM service_requests WHERE reference_code=? AND (submitted_by_user_id=? OR applicant_user_id=?) LIMIT 1 FOR UPDATE',[ref,user.user_id,user.user_id],db);
   if(!reqrow)error('Request not found.',404);
   if(reqrow.status!=='Received')error('Only requests that are still Received can be changed.',409);
   if(action==='delete'){
    const count=await first('SELECT COUNT(*) AS count FROM application_documents WHERE request_id=?',[reqrow.request_id],db);
    if(Number(count.count)>0)error('Requests with uploaded documents cannot be deleted here. Contact PDAO staff.',409);
    await audit(user.user_id,'delete','service_request',reqrow.request_id,{reference:ref},db);
    await query('DELETE FROM service_requests WHERE request_id=?',[reqrow.request_id],db);
    return {success:true,message:'Request deleted.'};
   }
   const name=s(d.applicant_name);
   if(!name||name.length>150)error('Enter a valid applicant name.',422);
   if(reqrow.request_category==='assistance'){
    const type=s(d.assistance_type),location=s(d.location),details=s(d.details);
    if(!['Medicine support','Food assistance','Transportation','Other support'].includes(type)||!location||location.length>255||!details||details.length>10000)error('Complete valid assistance request details.',422);
    await query('UPDATE service_requests SET applicant_name=?,request_type=?,location_text=? WHERE request_id=?',[name,type,location,reqrow.request_id],db);
    await query('UPDATE assistance_request_details SET assistance_type=?,details=? WHERE request_id=?',[type,details,reqrow.request_id],db);
   } else {
    const mid=await municipalId(d.municipality);
    if(!mid)error('Choose a valid municipality.',422);
    await query('UPDATE service_requests SET applicant_name=?,municipality_id=? WHERE request_id=?',[name,mid,reqrow.request_id],db);
   }
   await audit(user.user_id,'edit','service_request',reqrow.request_id,{reference:ref},db);
   return {success:true,message:'Request updated.'};
  });
 }
 if(endpoint==='track'){
  requireMethod(req,'GET');const ref=s(params.get('reference')).toUpperCase();if(!ref)error('Enter a reference ID.',422);
  const row=await first("SELECT reference_code AS id,request_type AS type,COALESCE(m.municipality_name,s.location_text,'Marinduque') AS municipality,status,status_explanation AS explanation FROM service_requests s LEFT JOIN municipalities m ON m.municipality_id=s.municipality_id WHERE reference_code=? AND (submitted_by_user_id=? OR applicant_user_id=? OR ? IN ('staff','admin')) LIMIT 1",[ref,user.user_id,user.user_id,user.role]);
  if(!row)error('Reference ID not found.',404);return {success:true,request:row};
 }
 if(endpoint==='announcement_create'){
  requireMethod(req,'POST');const actor=await auth(req,['staff','admin']);csrf(req,actor);
  const title=s(d.title),date=s(d.date),location=s(d.location),category=s(d.category),details=s(d.details);
  if(!title||title.length>255||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!location||!['programs','assistance','general'].includes(category)||!details)error('Complete all announcement fields.',422);
  const id='announcement-'+Date.now()+'-'+random(3);
  await trans(async db=>{const r=await query('INSERT INTO announcements(public_id,title,announcement_date,location,category,details,published_by_user_id) VALUES(?,?,?,?,?,?,?)',[id,title,date,location,category,details,actor.user_id],db);for(const role of ['pwd','caregiver'])await query("INSERT INTO notifications(title,message,notification_type,recipient_role,related_announcement_id) VALUES(?,?,'announcement',?,?)",['New community announcement: '+title,details,role,r.insertId],db);await audit(actor.user_id,'create','announcement',r.insertId,{public_id:id},db);});return {success:true,message:'Announcement published.'};
 }
 if(endpoint==='announcement_delete'){
  requireMethod(req,'POST');const actor=await auth(req,['staff','admin']);csrf(req,actor);const id=s(d.id);if(!id||id.length>100)error('Invalid announcement.',422);
  await trans(async db=>{const row=await first('SELECT announcement_id,title FROM announcements WHERE public_id=? FOR UPDATE',[id],db);if(!row)error('Announcement not found.',404);await query('DELETE FROM announcements WHERE announcement_id=?',[row.announcement_id],db);await audit(actor.user_id,'delete','announcement',row.announcement_id,{public_id:id,title:row.title},db);});return {success:true,message:'Announcement deleted.'};
 }
 if(endpoint==='admin_requests'){
  requireMethod(req,'GET');await auth(req,['staff','admin']);const category=s(params.get('category')),status=s(params.get('status')),municipality=s(params.get('municipality')),search=s(params.get('q'));
  if(category&&!['assistance','pwd_id'].includes(category))error('Invalid request category.',422);
  if(status&&!allowedStatus.includes(status))error('Invalid request status filter.',422);
  if(municipality&&!municipalities.includes(municipality))error('Invalid municipality filter.',422);
  if(search.length>100)error('Search text must be 100 characters or fewer.',422);
  const from=' FROM service_requests s LEFT JOIN municipalities m ON m.municipality_id=s.municipality_id LEFT JOIN assistance_request_details a ON a.request_id=s.request_id LEFT JOIN users submitter ON submitter.user_id=s.submitted_by_user_id';const filters=[],args=[];
  if(category){filters.push('s.request_category=?');args.push(category);}if(status){filters.push('s.status=?');args.push(status);}if(municipality){filters.push('m.municipality_name=?');args.push(municipality);}
  if(search){filters.push('(s.reference_code LIKE ? OR s.request_type LIKE ? OR s.applicant_name LIKE ? OR m.municipality_name LIKE ? OR s.location_text LIKE ? OR a.details LIKE ?)');args.push(...Array(6).fill('%'+search+'%'));}
  const where=filters.length?' WHERE '+filters.join(' AND '):'';
  const requests=await query("SELECT s.reference_code AS id,s.request_type AS type,COALESCE(m.municipality_name,s.location_text,'Marinduque') AS municipality,s.status,s.status_explanation AS explanation,s.applicant_name AS applicant,s.location_text AS location,a.details,submitter.role AS submitted_by"+from+where+' ORDER BY s.submitted_at DESC LIMIT 100',args);
  const count=await first('SELECT COUNT(*) AS cnt'+from+where,args);
  const counts=await first("SELECT COALESCE(SUM(CASE WHEN request_category='pwd_id' THEN 1 ELSE 0 END),0) AS id_applications, COALESCE(SUM(CASE WHEN request_category='assistance' THEN 1 ELSE 0 END),0) AS assistance_requests, COALESCE(SUM(CASE WHEN request_category='pwd_id' AND status IN ('Received','Under review','Update available') THEN 1 ELSE 0 END),0) AS pending_applications FROM service_requests");
  return {success:true,requests,total_requests:Number(count.cnt),counts};
 }
 if(endpoint==='admin_assistance_details'||endpoint==='admin_id_documents'){
  requireMethod(req,'GET');await auth(req,['staff','admin']);const ref=s(params.get('reference'));if(!ref||ref.length>100)error('Invalid request reference.',422);
  const cat=endpoint==='admin_id_documents'?'pwd_id':'assistance';const row=await first("SELECT s.request_id,s.reference_code AS reference,s.applicant_name AS applicant,s.request_type AS type,s.location_text AS location,s.status,s.submitted_at,submitter.role AS submitted_by,a.details FROM service_requests s LEFT JOIN users submitter ON submitter.user_id=s.submitted_by_user_id LEFT JOIN assistance_request_details a ON a.request_id=s.request_id WHERE s.reference_code=? AND s.request_category=? LIMIT 1",[ref,cat]);
  if(!row)error('Request not found.',404);
  const documents=await query('SELECT document_id,document_type,original_file_name,mime_type,uploaded_at,file_size_bytes FROM application_documents WHERE request_id=? ORDER BY uploaded_at,document_id',[row.request_id]);
  return endpoint==='admin_id_documents'?{success:true,reference:ref,documents}:{success:true,request:row,documents};
 }
 if(endpoint==='admin_users'){
  const actor=await auth(req,['staff','admin']);
  if(req.method==='GET'){
    const id=Number(params.get('id'));
    if(Number.isSafeInteger(id)&&id>0){
      const profile=await profileFor(id);
      const documents=await query('SELECT d.document_id,d.document_type,d.original_file_name,d.mime_type,d.uploaded_at,d.verification_status,d.file_size_bytes,s.reference_code,s.request_category,s.request_type,s.applicant_user_id,s.submitted_by_user_id FROM application_documents d INNER JOIN service_requests s ON s.request_id=d.request_id WHERE (s.applicant_user_id=? OR s.submitted_by_user_id=?) ORDER BY d.uploaded_at DESC,d.document_id DESC',[id,id]);
      return {success:true,profile,documents};
    }
    const q=s(params.get('q')),municipality=s(params.get('municipality')),barangay=s(params.get('barangay'));
    if(q.length>100||barangay.length>120)error('Search input is too long.',422);
    let sql='SELECT u.user_id,u.full_name,u.email,u.role,u.account_status,u.contact_number,m.municipality_name AS municipality,p.barangay,p.pwd_id_number FROM users u LEFT JOIN pwd_profiles p ON p.user_id=u.user_id LEFT JOIN municipalities m ON m.municipality_id=p.municipality_id WHERE 1=1';const args=[];
    if(q){sql+=' AND (u.full_name LIKE ? OR u.email LIKE ?)';args.push('%'+q+'%','%'+q+'%');}
    if(municipality){sql+=' AND m.municipality_name=?';args.push(municipality);}
    if(barangay){sql+=' AND p.barangay LIKE ?';args.push('%'+barangay+'%');}
    return {success:true,users:await query(sql+' ORDER BY u.created_at DESC LIMIT 150',args)};
  }
  requireMethod(req,'POST');if(actor.role!=='admin')error('Only administrators may edit another account.',403);csrf(req,actor);
  const id=Number(d.user_id);if(!Number.isSafeInteger(id)||id<1)error('Invalid user.',422);
  await profileFor(id);const f=await validateProfile(d);
  await trans(async db=>{await query('UPDATE users SET full_name=?,email=?,contact_number=? WHERE user_id=?',[f.full,f.email,f.contact||null,id],db);await saveProfile(id,f,db);await audit(actor.user_id,'admin_profile_update','user',id,null,db);});
  return {success:true,message:'Account details updated.'};
 }
 if(endpoint==='document_upload'){
  requireMethod(req,'POST');csrf(req,user);
  if(!['pwd','caregiver'].includes(user.role))error('Only PWD and caregiver accounts may upload documents.',403);
  const field=s(d.field),filename=s(d.filename).replace(/[\\/\x00-\x1f]/g,'_').slice(0,180);
  const mime=s(d.mime),data=s(d.base64);
  if(!fileFields[field]||!filename||!['application/pdf','image/jpeg','image/png'].includes(mime))error('Only PDF, JPG or PNG documents are allowed.',422);
 if(['idPhotos','wholeBodyPhoto','disabilityPhoto'].includes(field) && !['image/jpeg','image/png'].includes(mime))error('This field requires a JPG or PNG image.',422);
  if(data.length>Math.ceil(MAX_UPLOAD*4/3)+16||!data||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))error('File must be a valid PDF, JPG or PNG under 2 MB.',413);
  const contents=Buffer.from(data,'base64');
  if(!contents.length||contents.length>MAX_UPLOAD||!validDocument(contents,mime))error('File content does not match its format.',422);
  const pathname=`egabay/${user.user_id}/${random(16)}/${filename.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const blob=await put(pathname,contents,{access:'private',contentType:mime,addRandomSuffix:false});
  const token=sign({uid:user.user_id,kind:'staged_doc',field,filename,mime,size:contents.length,pathname:blob.pathname,exp:Date.now()+60*60*1000});
  return {success:true,token,filename};
 }
 if(endpoint==='assistance_create'||endpoint==='id_application_create'){
  requireMethod(req,'POST');csrf(req,user);
  if(!['pwd','caregiver'].includes(user.role))error('Only PWD and caregiver accounts can submit requests.',403);
  const category=endpoint==='assistance_create'?'assistance':'pwd_id';
  const name=s(d.name),type=s(d.type),consent=String(d.consent_confirmed||d.consent)==='1';
  if(!name||name.length>150||!consent)error('Enter applicant name and confirm consent.',422);
  const location=s(d.location),details=s(d.details),municipality=s(d.municipality),lost=String(d.old_pwd_id_lost)==='1';
  if(category==='assistance'&&(!['Medicine support','Food assistance','Transportation','Other support'].includes(type)||!location||location.length>255||!details||details.length>10000))error('Complete assistance request information.',422);
  if(category==='pwd_id'&&!['new','renewal','replacement'].includes(type))error('Choose a valid ID application type.',422);
  const mid=category==='pwd_id'?await municipalId(municipality):null;
  if(category==='pwd_id'&&!mid)error('Choose a valid municipality.',422);
  const docs=parseDocTokens(d.documents,user.user_id,category,type,lost);
  const reference=requestReference();
  await trans(async db=>{
   const newRequest=await query('INSERT INTO service_requests(reference_code,request_category,request_type,applicant_name,applicant_user_id,submitted_by_user_id,municipality_id,location_text,consent_confirmed) VALUES(?,?,?,?,?,?,?,?,1)',
   [reference,category,category==='assistance'?type:(type==='new'?'New PWD ID':type==='renewal'?'PWD ID renewal':'Lost PWD ID replacement'),name,user.role==='pwd'?user.user_id:null,user.user_id,mid,category==='assistance'?location:municipality],db);
   const id=newRequest.insertId;
   if(category==='assistance')await query('INSERT INTO assistance_request_details(request_id,assistance_type,details) VALUES(?,?,?)',[id,type,details],db);
   else await query('INSERT INTO pwd_id_application_details(request_id,application_type,old_pwd_id_lost) VALUES(?,?,?)',[id,type,lost?1:0],db);
   await saveDocuments(db,id,docs);
   await query('INSERT INTO request_status_history(request_id,new_status,note,changed_by_user_id) VALUES(?,?,?,?)',[id,'Received','Request submitted.',user.user_id],db);
   await query("INSERT INTO notifications(title,message,notification_type,recipient_user_id,related_request_id) VALUES(?,?,'request',?,?)",['Request received: '+reference,'Your request has been received for review.',user.user_id,id],db);
   await audit(user.user_id,'create','service_request',id,{reference,category,documents:docs.length},db);
  });
  return {success:true,message:'Request submitted successfully.',request:requestResponse(reference,category==='assistance'?type:'PWD ID '+type,category==='assistance'?location:municipality)};
 }
 if(endpoint==='document_download'){
  requireMethod(req,'GET');const id=Number(params.get('id')),mode=s(params.get('mode'));
  if(!Number.isSafeInteger(id)||id<1)error('Invalid document ID.',422);
  const doc=await first('SELECT d.file_path,d.original_file_name,d.mime_type,s.applicant_user_id,s.submitted_by_user_id FROM application_documents d JOIN service_requests s ON d.request_id=s.request_id WHERE d.document_id=?',[id]);
  if(!doc)error('Document not found.',404);
  if(!['staff','admin'].includes(user.role)&&Number(doc.applicant_user_id)!==user.user_id&&Number(doc.submitted_by_user_id)!==user.user_id)error('You cannot access this document.',403);
  if(!doc.file_path.startsWith('blob:'))error('Legacy document has no migrated storage file.',404);
  const result=await get(doc.file_path.slice(5),{access:'private'});
  if(!result||result.statusCode!==200||!result.stream)error('Stored document not found.',404);
  res.statusCode=200;res.setHeader('Content-Type',doc.mime_type);res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','private, no-store');
  const clean=doc.original_file_name.replace(/[\r\n\"\\]/g,'_');
  res.setHeader('Content-Disposition',`${mode==='download'?'attachment':'inline'}; filename="${clean}"`);
  await new Promise((resolve,reject)=>{Readable.fromWeb(result.stream).on('error',reject).pipe(res).on('finish',resolve).on('error',reject);});
  res._egabayStreamed=true;return null;
 }
 if(endpoint==='request_status'){
  requireMethod(req,'POST');const actor=await auth(req,['staff','admin']);csrf(req,actor);
  const ref=s(d.reference).toUpperCase(),status=s(d.status),reason=s(d.reason);if(!ref||!allowedStatus.includes(status))error('Invalid status update.',422);if(reason.length>400||(status==='Approved'||status==='Rejected')&&!reason)error('A valid reason is required.',422);
  await trans(async db=>{const row=await first('SELECT request_id,request_category,status,applicant_user_id,submitted_by_user_id FROM service_requests WHERE reference_code=? LIMIT 1 FOR UPDATE',[ref],db);if(!row)error('Request not found.',404);
   await query('UPDATE service_requests SET status=?,status_explanation=?,closed_at=? WHERE request_id=?',[status,reason||'Request status updated to '+status+'.',status==='Closed'?new Date():null,row.request_id],db);
   await query('INSERT INTO request_status_history(request_id,old_status,new_status,note,changed_by_user_id) VALUES(?,?,?,?,?)',[row.request_id,row.status,status,reason||'Status changed to '+status+'.',actor.user_id],db);
   const label=row.request_category==='pwd_id'?'PWD ID application':'assistance request';for(const rid of new Set([row.applicant_user_id,row.submitted_by_user_id].filter(Boolean))){await query("INSERT INTO notifications(title,message,notification_type,recipient_user_id,related_request_id) VALUES(?,?,'request',?,?)",[(status==='Approved'?'Approved':status==='Rejected'?'Rejected':'Status updated')+': '+ref,'Your '+label+' status is now '+status+'.'+(reason?' Reason: '+reason:''),rid,row.request_id],db);}
   await audit(actor.user_id,'status_update','service_request',row.request_id,{reference:ref,status,reason},db);
  });return {success:true,message:`Status for ${ref} changed to ${status}.`};
 }
 if(disabled.has(endpoint))error('This feature needs persistent object storage and has not yet been migrated. Do not use this build with real PWD records.',501);
 error('This endpoint has not yet been migrated to Vercel Functions.',501);
}

export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
 try{
  const url=new URL(req.url,'https://localhost');const endpoint=s(url.searchParams.get('endpoint'));
  if(!allEndpoints.has(endpoint))error('Unknown API endpoint.',404);
  const result=await route(endpoint,req,res,url.searchParams);
  if (!res._egabayStreamed) res.status(200).json(result);
 }catch(e){
  const status=e.status||(e.code==='ER_DUP_ENTRY'?409:500);
  if(status>=500)console.error('API error',e.code||e.name,e.message);
  res.status(status).json({success:false,message:status===409?'This record already exists.':status===500?'An unexpected server error occurred.':e.message});
 }
}
