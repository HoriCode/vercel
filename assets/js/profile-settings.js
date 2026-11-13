(() => {
  const $=id=>document.getElementById(id);
  const fields=['name','email','contact_number','birth_date','sex','address_line','municipality','barangay','pwd_id_number','disability_type','id_valid_until'];
  let csrf='';
  async function api(url,opts={}){
    if(location.protocol==='file:')throw Error('Open this page from your deployed e-Gabay website, not directly from a local file.');
    const response=await fetch(url,{credentials:'same-origin',...opts});
    let data;
    try{data=await response.json();}catch{throw Error('The profile API returned an invalid response. Check the Vercel API deployment.');}
    if(response.status===401){location.href='login.html?next=profile-settings.html';throw Error('Please log in first.');}
    if(!response.ok||!data.success)throw Error(data.message||'Request failed.');
    return data;
  }
  const post=(url,payload)=>api(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(payload)});
  function fill(profile){
    for(const name of fields){
      const input=$(`pr-${name}`);
      if(input)input.value=profile[name]??(name==='name'?profile.full_name:'');
    }
    if(profile.full_name)$('pr-name').value=profile.full_name;
    $('pr-age').value=profile.age??'';
    const photo=$('profile-photo');
    if(profile.profile_picture_url){photo.src=profile.profile_picture_url+'&v='+Date.now();photo.hidden=false;}
  }
  async function load(){
    if(location.protocol==='file:'){
      throw Error('Open this page through the deployed website URL.');
      return;
    }
    const session=await api('api/session.php');
    csrf=session.csrf_token;
    const portal=({staff:'admin.html',admin:'admin.html',caregiver:'caregiver.html',pwd:'pwd.html'})[session.user.role]||'pwd.html';
    $('back-portal').href=portal;
    $('profile-home').href=portal;
    const profile=(await api('api/profile.php')).profile;
    fill(profile);
    $('back-profile').href='profile.html';
  }
  $('pr-birth_date').addEventListener('change',event=>{
    const value=event.target.value;
    if(!value){$('pr-age').value='';return;}
    const birth=new Date(`${value}T12:00:00`),now=new Date();
    let age=now.getFullYear()-birth.getFullYear();
    if(now.getMonth()<birth.getMonth()||(now.getMonth()===birth.getMonth()&&now.getDate()<birth.getDate()))age--;
    $('pr-age').value=age>=0?age:'';
  });
  $('profile-form').addEventListener('submit',async event=>{
    event.preventDefault();
    try{
      const payload={};
      for(const name of fields)payload[name]=$(`pr-${name}`).value;
      const data=await post('api/profile.php',payload);
      fill(data.profile);
      $('profile-feedback').textContent=data.message;
    }catch(error){$('profile-feedback').textContent=error.message;}
  });
  $('password-form').addEventListener('submit',async event=>{
    event.preventDefault();
    try{
      const data=await post('api/password_change.php',{current_password:$('current-password').value,new_password:$('new-password').value});
      $('password-feedback').textContent=data.message;
      event.target.reset();
    }catch(error){$('password-feedback').textContent=error.message;}
  });
  $('picture-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=event.target.querySelector('button[type="submit"]');
    const feedback=$('picture-feedback');
    const file=$('picture-file').files?.[0];
    if(!file){feedback.textContent='Please choose a photo.';return;}
    if(file.size>2*1024*1024){feedback.textContent='Maximum file size is 2 MB.';return;}
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){feedback.textContent='Choose a JPG, PNG or WEBP photo.';return;}
    button.disabled=true;feedback.textContent='Uploading photo…';
    try{
      const encoded=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result).split(',')[1]);
        reader.onerror=()=>reject(new Error('Could not read the selected photo.'));
        reader.readAsDataURL(file);
      });
      const data=await post('api/profile_picture.php',{mime:file.type,base64:encoded});
      const photo=$('profile-photo');
      photo.src=data.url+'?v='+Date.now();photo.hidden=false;
      feedback.textContent=data.message;
      event.target.reset();
    }catch(error){feedback.textContent=error.message;}
    finally{button.disabled=false;}
  });
  load().catch(error=>{$('profile-feedback').textContent=error.message;});
})();
