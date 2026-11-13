import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

let pool;
const allEndpoints = new Set(['login','register','session','logout','profile','password_change','announcements','announcement_create','announcement_delete','notifications','notifications_read','my_history','track','admin_requests','admin_users','admin_assistance_details','admin_id_documents','request_status','my_request','assistance_create','id_application_create','profile_picture','document_download']);
const disabled = new Set(['assistance_create','id_application_create','profile_picture','document_download']);
const s = v => String(v ?? '').trim();
const random = (n=16) => crypto.randomBytes(n).toString('hex');
const error = (message,status=400) => {let e=new Error(message);e.status=status;throw e;};
const requireMethod = (req,method) => {if(req.method!==method)error('Method not allowed.',405);};
const connection = () => {
 if(!pool) {
  const {DB_HOST,DB_USER,DB_NAME,DB_PASS,DB_PORT,DB_SSL}=process.env;
  if(!DB_HOST||!DB_USER||!DB_NAME||DB_PASS===undefined)error('Database is not configured.',503);
  pool=mysql.createPool({host:DB_HOST,user:DB_USER,password:DB_PASS,database:DB_NAME,port:Number(DB_PORT||3306),waitForConnections:true,connectionLimit:4,queueLimit:50,ssl:DB_SSL==='true'?{minVersion:'TLSv1.2'}:undefined,dateStrings:true});
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
 row.profile_picture_url=null;delete row.profile_picture;return row;
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
  res.status(200).json(result);
 }catch(e){
  const status=e.status||(e.code==='ER_DUP_ENTRY'?409:500);
  if(status>=500)console.error('API error',e.code||e.name,e.message);
  res.status(status).json({success:false,message:status===409?'This record already exists.':status===500?'An unexpected server error occurred.':e.message});
 }
}
