document.getElementById('login-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button'),error=document.getElementById('login-error');button.disabled=true;error.textContent='';
  try{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value})});const result=await response.json();if(!response.ok)throw new Error(result.error);document.getElementById('password').value='';location.replace('/');}
  catch(problem){error.textContent=problem.message||'Sign-in failed.';button.disabled=false;}
});
