(() => {
  const $=id=>document.getElementById(id);
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value=v=>v==null||String(v).trim()===''?'Not provided':String(v);
  const formatDate=v=>{
    if(!v)return 'Not provided';
    const date=new Date(`${v}T12:00:00`);
    return Number.isNaN(date.getTime())?String(v):date.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
  };
  const portalByRole={staff:'admin.html',admin:'admin.html',caregiver:'caregiver.html',pwd:'pwd.html'};
  const roleLabels={staff:'PDAO staff account',admin:'Administrator account',caregiver:'Caregiver account',pwd:'PWD account'};
  const municipalities=['Boac','Mogpog','Gasan','Buenavista','Santa Cruz','Torrijos'];
  const assistanceTypes=['Medicine support','Food assistance','Transportation','Other support'];
  const editModal=$('request-edit-modal'),deleteModal=$('request-delete-modal');
  let csrfToken='',requestsByReference=new Map(),editingRequest=null,deletingRequest=null;
  let editTrigger=null,deleteTrigger=null;

  async function api(url,options={}){
    if(location.protocol==='file:')throw Error('Open this page from your deployed e-Gabay website, not directly from a local file.');
    const response=await fetch(url,{credentials:'same-origin',...options});
    let data;
    try{data=await response.json();}catch{throw Error('The profile API returned an invalid response. Check the Vercel API deployment.');}
    if(response.status===401){location.href='login.html?next=profile.html';throw Error('Please log in first.');}
    if(!response.ok||!data.success)throw Error(data.message||'Request failed.');
    return data;
  }
  function showProfile(profile){
    $('profile-display-name').textContent=value(profile.full_name);
    $('profile-display-role').textContent=roleLabels[profile.role]||'e-Gabay account';
    $('view-email').textContent=value(profile.email);
    $('view-contact').textContent=value(profile.contact_number);
    $('view-birth-date').textContent=formatDate(profile.birth_date);
    $('view-age').textContent=profile.age==null?'Not provided':`${profile.age} years`;
    $('view-sex').textContent=value(profile.sex);
    $('view-address').textContent=value(profile.address_line);
    $('view-municipality').textContent=value(profile.municipality);
    $('view-barangay').textContent=value(profile.barangay);
    $('view-pwd-id').textContent=value(profile.pwd_id_number);
    $('view-disability').textContent=value(profile.disability_type);
    $('view-id-expiry').textContent=formatDate(profile.id_valid_until);
    const initials=value(profile.full_name).split(/\s+/).slice(0,2).map(part=>part.charAt(0)).join('').toUpperCase();
    const avatar=$('profile-avatar'),photo=$('profile-photo');
    avatar.textContent=initials||'EG';
    if(profile.profile_picture_url){
      photo.src=profile.profile_picture_url;
      photo.hidden=false;
      avatar.hidden=true;
    }
  }
  function actionMarkup(request){
    if(request.status!=='Received'||!['assistance','pwd_id'].includes(request.request_category))return '<span class="request-history-locked">Locked after review</span>';
    const reference=escape(request.reference_code);
    return `<div class="request-history-actions"><button class="btn btn-outline-primary btn-sm" type="button" data-request-action="edit" data-reference="${reference}" aria-label="Edit request ${reference}">Edit</button><button class="btn btn-outline-danger btn-sm" type="button" data-request-action="delete" data-reference="${reference}" aria-label="Delete request ${reference}">Delete</button></div>`;
  }
  async function loadHistory(){
    const history=await api('api/my_history.php');
    requestsByReference=new Map(history.requests.map(request=>[request.reference_code,request]));
    $('profile-requests').innerHTML=history.requests.map(request=>`<tr><td>${escape(request.reference_code)}</td><td>${escape(request.request_type)}</td><td>${escape(request.status)}</td><td>${escape(request.submitted_at)}</td><td>${actionMarkup(request)}</td></tr>`).join('')||'<tr><td colspan="5">No requests submitted yet.</td></tr>';
  }
  function openEdit(request,trigger){
    editingRequest=request;
    editTrigger=trigger;
    $('request-edit-title').textContent=`Edit request ${request.reference_code}`;
    $('request-edit-feedback').textContent='';
    const fields=$('request-edit-fields');
    const name=`<div class="col-12"><label class="form-label" for="request-edit-name">Applicant / patient name</label><input class="form-control" id="request-edit-name" name="applicant_name" maxlength="150" required value="${escape(request.applicant_name)}"></div>`;
    if(request.request_category==='assistance'){
      const options=assistanceTypes.map(type=>`<option value="${escape(type)}"${type===request.assistance_type?' selected':''}>${escape(type)}</option>`).join('');
      fields.innerHTML=`${name}<div class="col-md-6"><label class="form-label" for="request-edit-type">Type of assistance</label><select class="form-select" id="request-edit-type" name="assistance_type" required>${options}</select></div><div class="col-md-6"><label class="form-label" for="request-edit-location">Municipality / barangay</label><input class="form-control" id="request-edit-location" name="location" maxlength="255" required value="${escape(request.location_text)}"></div><div class="col-12"><label class="form-label" for="request-edit-details">How can we help?</label><textarea class="form-control" id="request-edit-details" name="details" rows="4" maxlength="10000" required>${escape(request.assistance_details)}</textarea></div>`;
    }else{
      const options=municipalities.map(municipality=>`<option value="${escape(municipality)}"${municipality===request.municipality?' selected':''}>${escape(municipality)}</option>`).join('');
      fields.innerHTML=`${name}<div class="col-12"><label class="form-label" for="request-edit-municipality">Municipality</label><select class="form-select" id="request-edit-municipality" name="municipality" required><option value="">Choose municipality</option>${options}</select><div class="form-text">The application type and submitted files will stay unchanged.</div></div>`;
    }
    editModal.hidden=false;
    $('request-edit-name').focus();
  }
  function closeEdit(restoreFocus=true){
    editModal.hidden=true;
    editingRequest=null;
    if(restoreFocus&&editTrigger?.isConnected)editTrigger.focus();
    editTrigger=null;
  }
  function openDelete(request,trigger){
    deletingRequest=request;
    deleteTrigger=trigger;
    $('request-delete-message').textContent=`Delete ${request.reference_code}? This permanently removes the request and any files submitted with it.`;
    $('request-delete-feedback').textContent='';
    deleteModal.hidden=false;
    $('request-delete-cancel').focus();
  }
  function closeDelete(restoreFocus=true){
    deleteModal.hidden=true;
    deletingRequest=null;
    if(restoreFocus&&deleteTrigger?.isConnected)deleteTrigger.focus();
    deleteTrigger=null;
  }
  function trapDialogFocus(modal,event,close){
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab')return;
    const focusable=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')];
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  async function load(){
    if(location.protocol==='file:'){
      throw Error('Open this page through the deployed website URL.');
      return;
    }
    const session=await api('api/session.php');
    csrfToken=session.csrf_token||'';
    const portal=portalByRole[session.user.role]||'pwd.html';
    $('back-portal').href=portal;
    $('profile-home').href=portal;
    showProfile((await api('api/profile.php')).profile);
    if(['pwd','caregiver'].includes(session.user.role)){
      $('profile-history-section').hidden=false;
      await loadHistory();
    }
  }
  $('profile-requests').addEventListener('click',event=>{
    const button=event.target.closest('[data-request-action]');
    if(!button)return;
    const request=requestsByReference.get(button.dataset.reference);
    if(!request||request.status!=='Received')return;
    if(button.dataset.requestAction==='edit')openEdit(request,button);
    if(button.dataset.requestAction==='delete')openDelete(request,button);
  });
  $('request-edit-cancel').addEventListener('click',()=>closeEdit());
  editModal.addEventListener('click',event=>{if(event.target===editModal)closeEdit();});
  editModal.addEventListener('keydown',event=>trapDialogFocus(editModal,event,closeEdit));
  $('request-edit-form').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!editingRequest)return;
    const form=new FormData(event.currentTarget);
    const payload={action:'edit',reference:editingRequest.reference_code,applicant_name:form.get('applicant_name')};
    if(editingRequest.request_category==='assistance'){
      payload.assistance_type=form.get('assistance_type');
      payload.location=form.get('location');
      payload.details=form.get('details');
    }else payload.municipality=form.get('municipality');
    const save=$('request-edit-save');
    save.disabled=true;
    $('request-edit-feedback').textContent='';
    try{
      const data=await api('api/my_request.php',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(payload)});
      closeEdit(false);
      $('profile-feedback').textContent=data.message;
      try{await loadHistory();$('profile-requests').focus();}
      catch(error){$('profile-feedback').textContent=`${data.message} Request history could not be refreshed: ${error.message}`;}
    }catch(error){$('request-edit-feedback').textContent=error.message;}
    finally{save.disabled=false;}
  });
  $('request-delete-cancel').addEventListener('click',()=>closeDelete());
  deleteModal.addEventListener('click',event=>{if(event.target===deleteModal)closeDelete();});
  deleteModal.addEventListener('keydown',event=>trapDialogFocus(deleteModal,event,closeDelete));
  $('request-delete-confirm').addEventListener('click',async()=>{
    if(!deletingRequest)return;
    const button=$('request-delete-confirm');
    button.disabled=true;
    $('request-delete-feedback').textContent='';
    try{
      const data=await api('api/my_request.php',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({action:'delete',reference:deletingRequest.reference_code})});
      closeDelete(false);
      $('profile-feedback').textContent=data.message;
      try{await loadHistory();$('profile-requests').focus();}
      catch(error){$('profile-feedback').textContent=`${data.message} Request history could not be refreshed: ${error.message}`;}
    }catch(error){$('request-delete-feedback').textContent=error.message;}
    finally{button.disabled=false;}
  });
  load().catch(err=>{
    $('profile-display-name').textContent='Profile could not be loaded';
    $('profile-feedback').textContent=err.message;
  });
})();
