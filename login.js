(async()=>{
  const form=document.getElementById('form');
  const title=document.getElementById('title');
  const subtitle=document.getElementById('subtitle');
  const confirmRow=document.getElementById('confirm-row');
  const errorEl=document.getElementById('error');
  const submitBtn=document.getElementById('submit-btn');
  const passwordInput=document.getElementById('password');

  // Already logged in?
  try{
    const me=await fetch('/api/auth/me');
    if(me.ok){const p=new URLSearchParams(window.location.search);const r=p.get('redirect');window.location.href=(r&&r.startsWith('/'))?r:'/';return;}
  }catch{}

  // Setup mode?
  let setupMode=false;
  try{
    const r=await fetch('/api/auth/setup-required');
    const d=await r.json();
    if(d.setupRequired){
      setupMode=true;
      title.textContent='Create Admin Account';
      subtitle.textContent='First-time setup \u2014 create your admin user';
      confirmRow.style.display='block';
      submitBtn.textContent='Create Account';
      passwordInput.autocomplete='new-password';
      passwordInput.minLength=8;
      document.getElementById('confirm').minLength=8;
    }
  }catch{}

  function showError(msg){
    errorEl.textContent=msg;
    errorEl.style.display='block';
  }

  function resetBtn(){
    submitBtn.disabled=false;
    submitBtn.classList.remove('loading');
    submitBtn.textContent=setupMode?'Create Account':'Login';
  }

  form.addEventListener('submit',async(e)=>{
    e.preventDefault();
    errorEl.style.display='none';
    const username=document.getElementById('username').value.trim();
    const password=document.getElementById('password').value;

    if(!username||!password){showError('Please fill in all fields.');return;}

    if(setupMode){
      const confirm=document.getElementById('confirm').value;
      if(password!==confirm){showError('Passwords do not match.');return;}
      if(password.length<8){showError('Password must be at least 8 characters.');return;}
    }

    submitBtn.disabled=true;
    submitBtn.classList.add('loading');
    submitBtn.textContent=setupMode?'Creating...':'Logging in...';

    try{
      const endpoint=setupMode?'/api/auth/setup':'/api/auth/login';
      const r=await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username,password})
      });
      const d=await r.json();
      if(!r.ok){
        showError(d.error||'Login failed');
        resetBtn();
        return;
      }
      // Verify session was actually established before redirecting
      try{
        const verify=await fetch('/api/auth/me');
        if(!verify.ok){
          showError('Login succeeded but the session could not be established. Make sure cookies are enabled.');
          resetBtn();
          return;
        }
      }catch{
        showError('Could not verify session. Please try again.');
        resetBtn();
        return;
      }
      const rp=new URLSearchParams(window.location.search);const rd=rp.get('redirect');window.location.href=(rd&&rd.startsWith('/'))?rd:'/';
    }catch(err){
      showError('Connection error \u2014 is the server running?');
      resetBtn();
    }
  });
})();
