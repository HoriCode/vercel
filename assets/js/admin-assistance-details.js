(() => {
  const $=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const labels={
    assistance_pwd_id:'PWD ID',
    assistance_disability_photo:'Photo of disability',
    assistance_medical_certificate:'Updated medical certificate from a qualified specialist'
  };
  const reference=new URLSearchParams(location.search).get('reference')?.trim()||'';
  const feedback=$('assistance-details-feedback');
  const requestContent=$('assistance-request-content');
  const documentContent=$('assistance-document-content');
  $('assistance-reference').textContent=reference||'Not provided';

  function displayDate(value){
    if(!value)return 'Not provided';
    const date=new Date(String(value).replace(' ','T'));
    return Number.isNaN(date.getTime())?String(value):date.toLocaleString();
  }

  function renderRequest(request){
    const submitter=request.submitted_by==='pwd'?'PWD':request.submitted_by==='caregiver'?'Caregiver':'User';
    requestContent.innerHTML=`<div class="assistance-details-grid">
      <div class="assistance-details-item"><span>Applicant</span><strong>${escapeHtml(request.applicant||'Not provided')}</strong></div>
      <div class="assistance-details-item"><span>Submitted by</span><strong>${submitter}</strong></div>
      <div class="assistance-details-item"><span>Assistance type</span><strong>${escapeHtml(request.type||'Not provided')}</strong></div>
      <div class="assistance-details-item"><span>Location</span><strong>${escapeHtml(request.location||'Not provided')}</strong></div>
      <div class="assistance-details-item"><span>Status</span><strong>${escapeHtml(request.status||'Not provided')}</strong></div>
      <div class="assistance-details-item"><span>Submitted</span><strong>${escapeHtml(displayDate(request.submitted_at))}</strong></div>
    </div>
    <section class="assistance-submitted-message" aria-labelledby="submitted-message-heading">
      <h3 id="submitted-message-heading">What they wrote</h3>
      <p>${escapeHtml(request.details||'No written message was provided.')}</p>
    </section>`;
  }

  function renderDocuments(documents){
    if(!documents.length){
      documentContent.innerHTML='<p class="application-document-unavailable">No files were submitted with this assistance request.</p>';
      return;
    }
    const cards=documents.map(document=>{
      const documentId=Number(document.document_id);
      if(!Number.isSafeInteger(documentId)||documentId<1)return '';
      const label=labels[document.document_type]||document.document_type||'Assistance document';
      const fileName=document.original_file_name||'Uploaded file';
      const url=`api/document_download.php?id=${encodeURIComponent(documentId)}&mode=view`;
      const preview=document.mime_type==='image/jpeg'||document.mime_type==='image/png'
        ?`<img class="application-document-image" src="${url}" alt="${escapeHtml(label)} preview: ${escapeHtml(fileName)}">`
        :document.mime_type==='application/pdf'
          ?`<iframe class="application-document-pdf" src="${url}" title="${escapeHtml(label)}: ${escapeHtml(fileName)}"></iframe>`
          :'<p class="application-document-unavailable">Preview is unavailable for this file type.</p>';
      return `<article class="application-document-card"><div class="application-document-meta"><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(fileName)}${document.uploaded_at?` · Uploaded ${escapeHtml(displayDate(document.uploaded_at))}`:''}</span></div><a class="btn btn-outline-primary btn-sm" href="${url}" target="_blank" rel="noopener">Open file</a></div>${preview}</article>`;
    }).join('');
    documentContent.innerHTML=cards||'<p class="application-document-unavailable">No supported documents were found.</p>';
    documentContent.querySelectorAll('.application-document-image').forEach(image=>image.addEventListener('error',()=>{
      const fallback=document.createElement('p');
      fallback.className='application-document-unavailable';
      fallback.textContent='The image could not be loaded. Use Open file to retry or check that the upload is still available.';
      image.replaceWith(fallback);
    }));
  }

  async function loadRequest(){
    if(!reference){
      feedback.textContent='An assistance request reference is required to view submitted details.';
      return;
    }
    try{
      const response=await fetch(`api/admin_assistance_details.php?reference=${encodeURIComponent(reference)}`,{credentials:'same-origin',headers:{Accept:'application/json'}});
      let data={};
      try{data=await response.json();}catch{}
      if(response.status===401){
        location.assign('login.html');
        return;
      }
      if(!response.ok||!data.success)throw new Error(data.message||'Could not load assistance request details.');
      renderRequest(data.request);
      renderDocuments(Array.isArray(data.documents)?data.documents:[]);
      feedback.textContent='Request details and submitted files are ready to review.';
    }catch(error){
      feedback.textContent=error.message;
    }
  }

  loadRequest();
})();
