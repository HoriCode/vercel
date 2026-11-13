(() => {
  const $=s=>document.querySelector(s);
  const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let sessionUser=null, csrfToken='';
  let pendingAssistanceForm=null;
  const assistanceModal=$('#assistance-confirm-modal');
  const assistanceCancel=$('#assistance-confirm-cancel');
  const assistanceContinue=$('#assistance-confirm-continue');

  async function api(url,options={}){
    const res=await fetch(url,{credentials:'same-origin',...options});
    let data={}; try{data=await res.json();}catch{}
    if(res.status===401){window.location.assign('login.html');throw new Error('Please log in first.');}
    if(!res.ok||data.success===false)throw new Error(data.message||'Request failed.');
    return data;
  }
  function expectedRoles(){
    if(document.body.classList.contains('staff-page'))return ['staff','admin'];
    if(document.body.classList.contains('caregiver-page'))return ['caregiver'];
    if(document.body.classList.contains('pwd-user-page'))return ['pwd'];
    return ['pwd','caregiver']; // application forms can be used by PWD or caregiver
  }
  async function loadSession(){
    const data=await api('api/session.php'); sessionUser=data.user; csrfToken=data.csrf_token||'';
    const portalHome={pwd:'pwd.html',caregiver:'caregiver.html',staff:'admin.html',admin:'admin.html'}[sessionUser.role]||'pwd.html';
    document.querySelectorAll('.brand-lockup').forEach(brand=>brand.href=portalHome);
    if(!expectedRoles().includes(sessionUser.role)){window.location.assign(sessionUser.role==='caregiver'?'caregiver.html':(['staff','admin'].includes(sessionUser.role)?'admin.html':'pwd.html')); return;}
    const pwdName=$('#pwd-account-name'); if(pwdName)pwdName.textContent=sessionUser.full_name||'PWD User';
    const caregiverContext=$('#caregiver-context'); if(caregiverContext&&data.user.patient_name)caregiverContext.textContent=`Submitting on behalf of ${data.user.patient_name}, with their consent.`;
    const name=$('#request-name'); if(name){ if(sessionUser.role==='pwd')name.value=sessionUser.full_name||''; else if(data.user.patient_name)name.value=data.user.patient_name; }
    const appName=$('#id-applicant-name'); if(appName&&sessionUser.role==='pwd')appName.value=sessionUser.full_name||'';
  }

  // Switch account modal now logs out before returning to login.
  const switchModal=$('#switch-account-modal'), switchCancel=$('#switch-account-cancel'), switchConfirm=$('#switch-account-confirm');
  document.querySelectorAll('.portal-nav-links a[href="login.html"]').forEach(link=>link.addEventListener('click',e=>{if(!switchModal)return;e.preventDefault();switchModal.hidden=false;switchCancel?.focus();}));
  switchCancel?.addEventListener('click',()=>{switchModal.hidden=true;});
  switchConfirm?.addEventListener('click',async()=>{try{await fetch('api/logout.php',{method:'POST',credentials:'same-origin'});}finally{window.location.assign('login.html');}});
  switchModal?.addEventListener('click',e=>{if(e.target===switchModal)switchModal.hidden=true;});

  function statusClass(status){if(status==='Received')return'status-received';if(status==='Update available')return'status-update';if(status==='Closed'||status==='Rejected')return'status-closed';return'status-review';}
  function renderTracking(request){
    const result=$('#tracking-result'), empty=$('#tracker-empty'); if(!result||!empty)return;
    const stage=request.status==='Received'?1:request.status==='Under review'?2:request.status==='Update available'?3:4;
    result.innerHTML=`<div class="tracked-request"><div><span class="request-ref">${escapeHtml(request.id)}</span><span class="request-type">${escapeHtml(request.type)} · ${escapeHtml(request.municipality)}</span></div><span class="status-badge ${statusClass(request.status)}"><i></i> ${escapeHtml(request.status)}</span></div><div class="request-progress">${[1,2,3,4].map(s=>`<span${s<=stage?' class="progress-done"':''}></span>`).join('')}</div><div class="tracking-step-labels"><span>Received</span><span>In review</span><span>Update</span><span>Closed</span></div>${request.explanation?`<p class="status-explanation">${escapeHtml(request.explanation)}</p>`:''}`;
    result.hidden=false; empty.hidden=true;
  }
  $('#tracking-form')?.addEventListener('submit',async e=>{
    e.preventDefault(); const input=$('#tracking-id'); const ref=input.value.trim().toUpperCase();
    try{const data=await api(`api/track.php?reference=${encodeURIComponent(ref)}`);renderTracking(data.request);input.setAttribute('aria-invalid','false');}
    catch(err){$('#tracking-result').hidden=true;$('#tracker-empty').hidden=false;input.setAttribute('aria-invalid','true');$('#tracking-help').textContent=err.message;}
  });

  // Upload documents one at a time: Vercel Functions reject request bodies above 4.5 MB.
  // Only server-authorized private Blob objects are accepted in the final request.
  function fileAsBase64(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror=()=>reject(new Error('Could not read '+file.name));
      reader.readAsDataURL(file);
    });
  }
  async function uploadedDocuments(form,feedback){
    const inputs=[...form.querySelectorAll('input[type="file"]')].filter(input=>!input.closest('.document-field')?.hidden&&!input.closest('[hidden]'));
    const files=[];
    for(const input of inputs){
      for(const file of input.files||[]){
        if(file.size>2*1024*1024)throw new Error(`${file.name} is too large. Maximum 2 MB per file.`);
        files.push({field:input.name,file});
      }
    }
    if(!files.length)throw new Error('Please attach the required documents.');
    const uploaded=[];
    for(let i=0;i<files.length;i++){
      const {field,file}=files[i];
      feedback.textContent=`Uploading document ${i+1} of ${files.length}: ${file.name}`;
      const data=await api('api/document_upload.php',{
        method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},
        body:JSON.stringify({field,filename:file.name,mime:file.type,base64:await fileAsBase64(file)})
      });
      uploaded.push({field,token:data.token});
    }
    return uploaded;
  }
  function textFormFields(form){
    const data={};for(const [key,value] of new FormData(form))if(typeof value==='string')data[key]=value;
    return data;
  }
  async function submitAssistanceRequest(form){
    const feedback=$('#form-feedback'), submitButton=form.querySelector('[type="submit"]');
    submitButton.disabled=true;
    try{
      const documents=await uploadedDocuments(form,feedback);
      feedback.textContent='Saving your assistance request…';
      const data=await api('api/assistance_create.php',{
        method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},
        body:JSON.stringify({...textFormFields(form),consent:'1',documents})
      });
      feedback.textContent=`Request reference ${data.request.id} created. Use this ID to check its status.`;
      form.reset(); renderTracking(data.request); if($('#tracking-id'))$('#tracking-id').value=data.request.id;
      if(sessionUser?.role==='pwd')$('#request-name').value=sessionUser.full_name||'';
    }catch(err){feedback.textContent=err.message;feedback.style.color='#a34e43';}
    finally{submitButton.disabled=false;submitButton.focus();}
  }
  function closeAssistanceModal(){
    if(!assistanceModal)return;
    const form=pendingAssistanceForm;
    pendingAssistanceForm=null;
    assistanceModal.hidden=true;
    form?.querySelector('[type="submit"]')?.focus();
  }
  $('#assistance-form')?.addEventListener('submit',e=>{
    e.preventDefault();
    const form=e.currentTarget, feedback=$('#form-feedback');
    feedback.textContent='';
    if(!form.reportValidity())return;
    if(!assistanceModal||!assistanceCancel||!assistanceContinue){
      feedback.textContent='Request confirmation is unavailable. Refresh the page and try again.';
      return;
    }
    pendingAssistanceForm=form;
    assistanceModal.hidden=false;
    assistanceCancel.focus();
  });
  assistanceCancel?.addEventListener('click',closeAssistanceModal);
  assistanceContinue?.addEventListener('click',async()=>{
    const form=pendingAssistanceForm;
    if(!form)return;
    pendingAssistanceForm=null;
    assistanceModal.hidden=true;
    await submitAssistanceRequest(form);
  });
  assistanceModal?.addEventListener('click',event=>{if(event.target===assistanceModal)closeAssistanceModal();});
  assistanceModal?.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closeAssistanceModal();return;}
    if(event.key==='Tab'&&assistanceCancel&&assistanceContinue){
      if(event.shiftKey&&document.activeElement===assistanceCancel){event.preventDefault();assistanceContinue.focus();}
      else if(!event.shiftKey&&document.activeElement===assistanceContinue){event.preventDefault();assistanceCancel.focus();}
    }
  });

  const idForm=$('#id-application-form'), appType=$('#id-application-type'), docSection=$('#id-document-fields'), oldLost=$('#old-pwd-id-lost');
  function updateDocs(){
    if(!appType||!docSection)return; const type=appType.value; docSection.hidden=false;
    docSection.querySelectorAll('.document-field').forEach(field=>{
      const groups=(field.dataset.documentGroups||'').split(' '); const affidavit=groups.includes('renewal-lost')||groups.includes('replacement');
      const show=!type||(affidavit?(type==='replacement'||(type==='renewal'&&oldLost?.checked)):groups.includes(type)); field.hidden=!show;
      const oldUpload=field.querySelector('#old-pwd-id-upload'); if(oldUpload)oldUpload.hidden=type==='renewal'&&Boolean(oldLost?.checked);
      const input=field.querySelector('input[type="file"]'); if(input)input.required=show&&input.id!=='document-birth-marriage'&&input.id!=='document-whole-body'&&(input.id!=='document-affidavit-loss'||type==='replacement'||(type==='renewal'&&oldLost?.checked))&&(input.id!=='document-old-pwd-id'||type!=='renewal'||!oldLost?.checked);
    });
  }
  oldLost?.addEventListener('change',updateDocs); updateDocs();
  idForm?.addEventListener('submit',async e=>{
    e.preventDefault(); const feedback=$('#id-form-feedback'); feedback.textContent=''; if(!idForm.reportValidity())return;
    const button=idForm.querySelector('[type="submit"]');button.disabled=true;
    try{
      const documents=await uploadedDocuments(idForm,feedback);
      feedback.textContent='Saving your PWD ID application…';
      const data=await api('api/id_application_create.php',{
        method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},
        body:JSON.stringify({...textFormFields(idForm),consent_confirmed:'1',old_pwd_id_lost:oldLost?.checked?'1':'0',documents})
      });
      feedback.textContent=`PWD ID inquiry reference ${data.request.id} created.`; idForm.reset(); updateDocs();
      // Give the user the reference on the same page; tracker is on the portal pages.
    }catch(err){feedback.textContent=err.message;feedback.style.color='#a34e43';}
    finally{button.disabled=false;}
  });

  const categoryLabels={assistance:'Assistance',programs:'Community programs',general:'General information'};
  const categoryClasses={assistance:'coral',programs:'sage',general:'gold'};
  function renderAnnouncements(items){
    const list=$('#announcement-list'), empty=$('#announcement-empty'); if(list)list.replaceChildren();
    const canDelete=Boolean($('#admin-announcements')&&['staff','admin'].includes(sessionUser?.role));
    items.forEach(a=>{if(!list)return;const col=document.createElement('div');col.className='col-md-6 col-lg-4 announcement-card user-announcement';col.dataset.category=a.category;col.innerHTML=`<article class="update-card"><div class="update-card-top"><span class="update-category ${categoryClasses[a.category]||'gold'}">${escapeHtml(categoryLabels[a.category]||a.category)}</span><span class="update-icon" aria-hidden="true">${a.category==='assistance'?'✚':a.category==='programs'?'✳':'i'}</span></div><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.details)}</p><div class="update-meta"><span>${escapeHtml(a.date||'')}</span><span>${escapeHtml(a.location||'')}</span></div>${canDelete?`<div class="mt-3 text-end"><button class="btn btn-outline-danger btn-sm" type="button" data-delete-announcement="${escapeHtml(a.id)}" aria-label="Delete announcement: ${escapeHtml(a.title)}">Delete</button></div>`:''}</article>`;list.append(col);});
    if(empty)empty.hidden=items.length>0; if($('#notice-count'))$('#notice-count').textContent=String(items.length);
  }
  async function loadAnnouncements(){try{const data=await api('api/announcements.php');renderAnnouncements(data.items);}catch(err){if($('#announcement-empty')){$('#announcement-empty').hidden=false;$('#announcement-empty').textContent=err.message;}else if($('#admin-feedback'))$('#admin-feedback').textContent=err.message;}}
  $('#announcement-list')?.addEventListener('click',async event=>{
    const button=event.target.closest('[data-delete-announcement]');
    if(!button||!['staff','admin'].includes(sessionUser?.role))return;
    const title=button.closest('.update-card')?.querySelector('h3')?.textContent.trim()||'this announcement';
    if(!window.confirm(`Delete "${title}"? This action cannot be undone.`))return;
    button.disabled=true;
    try{
      const data=await api('api/announcement_delete.php',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({id:button.dataset.deleteAnnouncement})});
      if($('#admin-feedback'))$('#admin-feedback').textContent=data.message;
      await loadAnnouncements();
    }catch(error){
      if($('#admin-feedback'))$('#admin-feedback').textContent=error.message;
      button.disabled=false;
    }
  });
  $('#announcement-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget,feedback=$('#announcement-feedback');if(!form.reportValidity())return;const fd=new FormData(form);
    try{const data=await api('api/announcement_create.php',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(Object.fromEntries(fd.entries()))});feedback.textContent=data.message;form.reset();await loadAnnouncements();}catch(err){feedback.textContent=err.message;}
  });

  function requestRow(r){
    const category=document.body.dataset.requestCategory;
    const filesButton=category==='pwd_id'
      ?`<a class="btn btn-outline-primary btn-sm" href="${escapeHtml(`admin-id-documents.html?reference=${encodeURIComponent(r.id)}`)}" target="_blank" rel="noopener">View submitted requirements</a>`
      :category==='assistance'
        ?`<a class="btn btn-outline-primary btn-sm" href="${escapeHtml(`admin-assistance-details.html?reference=${encodeURIComponent(r.id)}`)}" target="_blank" rel="noopener">Review submitted form</a>`
        :'';
    const requestNote=category==='assistance'
      ?`<details class="admin-request-note"><summary>Read submitted message</summary><div><span class="admin-request-note-meta">${escapeHtml(r.applicant||'Applicant')} · Submitted by ${r.submitted_by==='pwd'?'PWD':r.submitted_by==='caregiver'?'caregiver':'user'}${r.location?` · ${escapeHtml(r.location)}`:''}</span><p>${escapeHtml(r.details||'No message was provided.')}</p></div></details>`
      :'';
    return `<tr data-id="${escapeHtml(r.id)}"><td><strong>${escapeHtml(r.id)}</strong></td><td>${escapeHtml(r.type)}${requestNote}</td><td>${escapeHtml(r.municipality)}</td><td><span class="status-badge ${statusClass(r.status)}"><i></i> ${escapeHtml(r.status)}</span></td><td><div class="admin-request-actions">${filesButton}<select class="form-select form-select-sm status-select" aria-label="Update status for ${escapeHtml(r.id)}">${['Received','Under review','Update available','Approved','Rejected','Closed'].map(s=>`<option${s===r.status?' selected':''}>${s}</option>`).join('')}</select></div></td></tr>`;
  }
  let requestLoadVersion=0;
  async function loadAdminRequests(){
    const tbody=$('#admin-requests')||$('#admin-id-requests'),idApplicationCount=$('#id-application-count'),assistanceRequestCount=$('#assistance-request-count'),pendingApplicationCount=$('#pending-application-count'),resultsSummary=$('#request-results-summary');
    if(!tbody&&!idApplicationCount&&!assistanceRequestCount&&!pendingApplicationCount)return;
    const loadVersion=++requestLoadVersion;
    const category=document.body.dataset.requestCategory;
    const params=new URLSearchParams();
    if(category)params.set('category',category);
    const filterForm=$('#request-filter-form');
    if(filterForm){
      ['q','status','municipality'].forEach(name=>{
        const value=String(new FormData(filterForm).get(name)||'').trim();
        if(value)params.set(name,value);
      });
    }
    const endpoint=`api/admin_requests.php${params.toString()?`?${params}`:''}`;
    try{
      const data=await api(endpoint);
      if(loadVersion!==requestLoadVersion)return;
      if(tbody)tbody.innerHTML=data.requests.map(requestRow).join('')||'<tr><td colspan="5">No requests found.</td></tr>';
      if(idApplicationCount)idApplicationCount.textContent=String(data.counts.id_applications);
      if(assistanceRequestCount)assistanceRequestCount.textContent=String(data.counts.assistance_requests);
      if(pendingApplicationCount)pendingApplicationCount.textContent=String(data.counts.pending_applications);
      if(resultsSummary){
        const total=Number(data.total_requests)||0,shown=data.requests.length;
        resultsSummary.textContent=total>shown
          ?`Showing ${shown} of ${total} matching requests. Refine your search to see other results.`
          :`${total} matching request${total===1?'':'s'}.`;
      }
    }catch(err){if(loadVersion===requestLoadVersion&&$('#admin-feedback'))$('#admin-feedback').textContent=err.message;}
  }
  const requestFilterForm=$('#request-filter-form');
  requestFilterForm?.addEventListener('submit',event=>{event.preventDefault();loadAdminRequests();});
  requestFilterForm?.addEventListener('reset',()=>window.setTimeout(loadAdminRequests,0));
  let pending=null; const confirmModal=$('#status-confirm-modal'),statusReason=$('#status-confirm-reason'),statusReasonLabel=$('.status-confirm-reason-label'),statusReasonHint=$('#status-confirm-reason-hint'),statusConfirmError=$('#status-confirm-error');
  function configureStatusReason(status){
    const required=['Approved','Rejected'].includes(status);
    if(statusReason){statusReason.value='';statusReason.required=required;statusReason.setAttribute('aria-required',String(required));}
    if(statusReasonLabel)statusReasonLabel.textContent=required?`Reason for ${status==='Approved'?'approval':'rejection'} (required)`:'Reason (optional)';
    if(statusReasonHint)statusReasonHint.textContent=required?'The requester will see this reason in their notification.':'A reason is optional for this status update.';
    if(statusConfirmError){statusConfirmError.hidden=true;statusConfirmError.textContent='';}
  }
  function closeStatusConfirm(){
    if(confirmModal)confirmModal.hidden=true;
    if(statusReason){statusReason.value='';statusReason.required=false;statusReason.setAttribute('aria-required','false');}
    if(statusConfirmError){statusConfirmError.hidden=true;statusConfirmError.textContent='';}
    pending=null;
  }
  const handleRequestStatusChange=e=>{
    if(!e.target.matches('.status-select'))return;
    const select=e.target,row=select.closest('tr'),original=row.children[3].textContent.trim(),next=select.value;
    select.value=original;
    pending={select,row,reference:row.dataset.id,status:next,original};
    if($('#status-confirm-message'))$('#status-confirm-message').textContent=`Change ${row.dataset.id} from "${original}" to "${next}"?`;
    configureStatusReason(next);
    if(confirmModal){
      confirmModal.hidden=false;
      if(['Approved','Rejected'].includes(next))statusReason?.focus();
      else $('#status-confirm-cancel')?.focus();
    }
  };
  document.querySelectorAll('#admin-requests, #admin-id-requests').forEach(tbody=>tbody.addEventListener('change',handleRequestStatusChange));
  $('#status-confirm-cancel')?.addEventListener('click',closeStatusConfirm);
  $('#status-confirm-apply')?.addEventListener('click',async()=>{
    if(!pending)return;
    const reason=String(statusReason?.value||'').trim(),requiresReason=['Approved','Rejected'].includes(pending.status);
    if(requiresReason&&!reason){
      if(statusConfirmError){statusConfirmError.textContent='Enter a reason before approving or rejecting this request.';statusConfirmError.hidden=false;}
      statusReason?.focus();
      return;
    }
    const applyButton=$('#status-confirm-apply');
    if(applyButton)applyButton.disabled=true;
    try{
      const data=await api('api/request_status.php',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({reference:pending.reference,status:pending.status,reason})});
      if($('#admin-feedback'))$('#admin-feedback').textContent=data.message;
      await loadAdminRequests();
    }catch(err){if($('#admin-feedback'))$('#admin-feedback').textContent=err.message;}
    finally{closeStatusConfirm();if(applyButton)applyButton.disabled=false;}
  });

  document.querySelectorAll('.filter-pill').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.filter-pill').forEach(p=>{const selected=p===button;p.classList.toggle('active',selected);p.setAttribute('aria-pressed',String(selected));});document.querySelectorAll('.announcement-card').forEach(card=>card.hidden=button.dataset.filter!=='all'&&card.dataset.category!==button.dataset.filter);}));

  // Move the notification panel outside the horizontally scrolling navigation.
  // On phones its old parent clipped the panel, making it appear empty/invisible.
  const notificationPanel=$('#notification-panel');
  const notificationToggle=$('#notification-toggle');
  if(notificationPanel&&notificationToggle){
    document.body.appendChild(notificationPanel);
    notificationPanel.classList.add('notification-panel-portal');
    notificationPanel.hidden=true;
  }
  function positionNotificationPanel(){
    if(!notificationPanel||!notificationToggle||notificationPanel.hidden)return;
    const r=notificationToggle.getBoundingClientRect();
    const mobile=window.innerWidth<600;
    const width=Math.min(360,window.innerWidth-24);
    notificationPanel.style.width=width+'px';
    notificationPanel.style.top=Math.max(8,Math.min(r.bottom+8,window.innerHeight-110))+'px';
    notificationPanel.style.left=(mobile?Math.max(12,(window.innerWidth-width)/2):Math.max(12,Math.min(r.right-width,window.innerWidth-width-12)))+'px';
  }
  function closeNotifications(){
    if(!notificationPanel)return;
    notificationPanel.hidden=true;
    notificationToggle?.setAttribute('aria-expanded','false');
  }
  async function loadNotifications(){
    const items=$('#notification-items'),count=$('#notification-count');if(!items||!count)return;
    const feedback=$('#notification-feedback');
    if(feedback)feedback.textContent='';
    try{
      const data=await api('api/notifications.php');
      items.replaceChildren();
      data.items.forEach(n=>{
        const el=document.createElement('article');
        el.className=`notification-item${Number(n.read)?'':' is-unread'}`;
        el.innerHTML=`<p class="notification-title">${escapeHtml(n.title)}</p>${n.message?`<p class="notification-message">${escapeHtml(n.message)}</p>`:''}<time>${escapeHtml(n.createdAt ? new Date(String(n.createdAt).replace(' ','T')).toLocaleString() : '')}</time>`;
        items.append(el);
      });
      if(!data.items.length)items.innerHTML='<p class="notification-empty">No notifications yet. New announcements and request updates will appear here.</p>';
      const unread=data.items.filter(n=>!Number(n.read)).length;
      count.textContent=unread>99?'99+':String(unread);count.hidden=unread===0;
      if(notificationToggle)notificationToggle.setAttribute('aria-label',unread?`Notifications, ${unread} unread`:'Notifications');
    }catch(err){
      items.innerHTML='<p class="notification-empty">Could not load notifications. Try again.</p>';
      if(feedback)feedback.textContent=err.message;
    }
  }
  notificationToggle?.addEventListener('click',async()=>{
    if(!notificationPanel)return;
    if(!notificationPanel.hidden){closeNotifications();return;}
    notificationPanel.hidden=false;
    notificationToggle.setAttribute('aria-expanded','true');
    positionNotificationPanel();
    await loadNotifications();
    positionNotificationPanel();
    try{
      const result=await fetch('api/notifications_read.php',{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':csrfToken}});
      if(result.ok){$('#notification-count').hidden=true;notificationPanel.querySelectorAll('.is-unread').forEach(el=>el.classList.remove('is-unread'));}
    }catch{/* notifications still remain visible if read tracking fails */}
  });
  $('#notification-close')?.addEventListener('click',closeNotifications);
  document.addEventListener('click',event=>{
    if(notificationPanel&&!notificationPanel.hidden&&!notificationPanel.contains(event.target)&&!notificationToggle?.contains(event.target))closeNotifications();
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeNotifications();});
  window.addEventListener('resize',positionNotificationPanel);
  window.addEventListener('scroll',positionNotificationPanel,true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&sessionUser)loadNotifications();});

  (async()=>{
    try{await loadSession(); await loadAnnouncements(); await loadNotifications(); await loadAdminRequests();}
    catch(err){/* api() handles redirect for unauthenticated sessions */}
  })();
})();
