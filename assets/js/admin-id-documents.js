(() => {
  const $=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const labels={application_form:'Application Form',medical_certificate:'Medical Certificate',barangay_certificate:'Barangay Certificate',valid_id:'Valid ID',birth_or_marriage_certificate:'Birth / Marriage Certificate',id_photo:'ID Photo',whole_body_photo:'Whole Body Photo',old_pwd_id:'Previous PWD ID',affidavit_of_loss:'Affidavit of Loss'};
  const reference=new URLSearchParams(location.search).get('reference')?.trim()||'';
  const feedback=$('application-documents-feedback');
  const content=$('application-documents-content');
  $('application-reference').textContent=reference||'Not provided';

  function uploadedAt(value){
    if(!value)return '';
    const date=new Date(String(value).replace(' ','T'));
    return Number.isNaN(date.getTime())?String(value):date.toLocaleString();
  }

  async function loadDocuments(){
    if(!reference){
      feedback.textContent='An application reference is required to view submitted requirements.';
      return;
    }
    try{
      const response=await fetch(`api/admin_id_documents.php?reference=${encodeURIComponent(reference)}`,{credentials:'same-origin',headers:{Accept:'application/json'}});
      let data={};
      try{data=await response.json();}catch{}
      if(response.status===401){
        location.assign('login.html');
        return;
      }
      if(!response.ok||!data.success)throw new Error(data.message||'Could not load submitted requirements.');
      const documents=Array.isArray(data.documents)?data.documents:[];
      if(!documents.length){
        feedback.textContent='No files were submitted with this application.';
        return;
      }
      const cards=documents.map(document=>{
        const documentId=Number(document.document_id);
        if(!Number.isSafeInteger(documentId)||documentId<1)return '';
        const label=labels[document.document_type]||document.document_type||'Application document';
        const fileName=document.original_file_name||'Uploaded file';
        const url=`api/document_download.php?id=${encodeURIComponent(documentId)}&mode=view`;
        const preview=document.mime_type==='image/jpeg'||document.mime_type==='image/png'
          ?`<img class="application-document-image" src="${url}" alt="${escapeHtml(label)} preview: ${escapeHtml(fileName)}">`
          :document.mime_type==='application/pdf'
            ?`<iframe class="application-document-pdf" src="${url}" title="${escapeHtml(label)}: ${escapeHtml(fileName)}"></iframe>`
            :'<p class="application-document-unavailable">Preview is unavailable for this file type.</p>';
        return `<article class="application-document-card"><div class="application-document-meta"><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(fileName)}${document.uploaded_at?` · Uploaded ${escapeHtml(uploadedAt(document.uploaded_at))}`:''}</span></div><a class="btn btn-outline-primary btn-sm" href="${url}" target="_blank" rel="noopener">Open file</a></div>${preview}</article>`;
      }).join('');
      if(!cards){
        feedback.textContent='No supported documents were found for this application.';
        return;
      }
      feedback.textContent=`${documents.length} submitted file${documents.length===1?'':'s'}.`;
      content.innerHTML=cards;
      content.querySelectorAll('.application-document-image').forEach(image=>image.addEventListener('error',()=>{
        const fallback=document.createElement('p');
        fallback.className='application-document-unavailable';
        fallback.textContent='The image could not be loaded. Use Open file to retry or check that the upload is still available.';
        image.replaceWith(fallback);
      }));
    }catch(error){
      feedback.textContent=error.message;
    }
  }

  loadDocuments();
})();
