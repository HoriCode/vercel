(() => {
  const form=document.querySelector('#auth-form');
  const nameInput=document.querySelector('#account-name'),nameField=document.querySelector('#name-field');
  const patientNameInput=document.querySelector('#patient-name'),patientNameField=document.querySelector('#patient-name-field');
  const emailInput=document.querySelector('#account-email'),roleSelect=document.querySelector('#account-role');
  const passwordInput=document.querySelector('#account-password'),submitButton=document.querySelector('#auth-submit');
  const feedback=document.querySelector('#auth-feedback'),registrationDetails=document.querySelector('#registration-details');
  let mode='login';
  const destinations={pwd:'pwd.html',caregiver:'caregiver.html',staff:'admin.html',admin:'admin.html'};
  const reg={contact_number:'reg-contact',birth_date:'reg-birth',sex:'reg-sex',address_line:'reg-address',municipality:'reg-municipality',barangay:'reg-barangay',pwd_id_number:'reg-pwdid',disability_type:'reg-disability',id_valid_until:'reg-expiry'};
  function updateFields(){
    const registering=mode==='register';nameField.hidden=!registering;nameInput.required=registering;
    registrationDetails.hidden=!registering;
    const caregiver=registering&&roleSelect.value==='caregiver';patientNameField.hidden=!caregiver;patientNameInput.required=caregiver;
    roleSelect.querySelector('[value="staff"]').disabled=registering;
    if(registering&&roleSelect.value==='staff')roleSelect.value='pwd';
    passwordInput.autocomplete=registering?'new-password':'current-password';passwordInput.minLength=registering?8:1;
    submitButton.textContent=registering?'Create account':'Continue to portal';
  }
  document.querySelectorAll('.auth-tab').forEach(tab=>tab.addEventListener('click',()=>{
    mode=tab.dataset.mode;document.querySelectorAll('.auth-tab').forEach(item=>{let selected=item===tab;item.classList.toggle('active',selected);item.setAttribute('aria-selected',String(selected));});
    feedback.textContent='';updateFields();
  }));
  roleSelect.addEventListener('change',updateFields);updateFields();
  document.querySelector('#reg-birth').addEventListener('change',e=>{
    const value=e.target.value, now=new Date(), birth=new Date(value+'T12:00:00');
    let age=now.getFullYear()-birth.getFullYear();if(now.getMonth()<birth.getMonth()||(now.getMonth()===birth.getMonth()&&now.getDate()<birth.getDate()))age--;
    document.querySelector('#reg-age').value=value&&age>=0?String(age):'';
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();feedback.textContent='';if(!form.reportValidity())return;submitButton.disabled=true;
    try{
      const payload={email:emailInput.value.trim(),password:passwordInput.value,role:roleSelect.value};
      if(mode==='register'){
        payload.name=nameInput.value.trim();payload.patientName=patientNameInput.value.trim();
        for(const [key,id] of Object.entries(reg))payload[key]=document.getElementById(id).value.trim();
      }
      const res=await fetch(`api/${mode==='register'?'register':'login'}.php`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
      const responseText=await res.text();
      let data;
      try { data=responseText.trim()?JSON.parse(responseText):null; }
      catch (_) { data=null; }
      if (!data || typeof data!=='object') {
        if (res.status===405) throw new Error('Login API returned HTTP 405. Check the Vercel rewrite and serverless function deployment.');
        if (res.status===404) throw new Error('Login API was not found (HTTP 404). Check the Vercel API rewrite configuration.');
        throw new Error(`Login server returned ${res.status} without valid JSON. Check the Vercel function logs and database configuration.`);
      }
      if(!res.ok||!data.success)throw new Error(data.message||`Login failed (HTTP ${res.status}).`);
      const next=new URLSearchParams(window.location.search).get('next');
      const destination=['profile.html','profile-settings.html'].includes(next)?next:(destinations[data.user.role]||'index.html');
      window.location.assign(destination);
    }catch(err){feedback.textContent=err.message;}finally{submitButton.disabled=false;}
  });
})();
