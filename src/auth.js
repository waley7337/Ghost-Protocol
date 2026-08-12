import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL='https://lkbdybejiiijocnhwmvm.supabase.co';
const SUPABASE_KEY='REDACTED_SUPABASE_PUBLISHABLE_KEY';
const isElectron=Boolean(window.ghostDesktop);
const REDIRECT_URL=isElectron?'ghost-protocol://auth/callback':`${window.location.origin}${window.location.pathname}`;
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:!isElectron}});
let session=null;
let syncTimer;
let resetMode=false;

const authMarkup=`<div id="auth-gate"><div class="auth-card"><div class="auth-brand">👻 GHOST PROTOCOL</div><div class="auth-sub">// OPERATIVE AUTHENTICATION //</div><div id="auth-login"><button class="auth-btn auth-btn-google" id="auth-google">CONTINUE WITH GOOGLE</button><div class="auth-divider">OR</div><input class="auth-input" id="auth-email" type="email" autocomplete="email" placeholder="OPERATIVE EMAIL"><input class="auth-input" id="auth-password" type="password" autocomplete="current-password" placeholder="PASSWORD"><button class="auth-btn" id="auth-submit">SIGN IN</button><div class="auth-links"><button class="auth-link" id="auth-forgot">Forgot password?</button><button class="auth-link" id="auth-mode">Create account</button></div></div><div id="auth-reset" class="auth-hidden"><input class="auth-input" id="auth-new-password" type="password" autocomplete="new-password" placeholder="NEW PASSWORD"><button class="auth-btn" id="auth-reset-submit">UPDATE PASSWORD</button></div><div class="auth-message" id="auth-message"></div></div></div><div id="auth-profile"><button class="profile-trigger" id="profile-trigger">● OPERATIVE</button><div class="profile-panel auth-hidden" id="profile-panel"><div class="profile-head"><img class="profile-avatar" id="profile-avatar" alt=""><div><div class="profile-name" id="profile-name"></div><div class="profile-email" id="profile-email"></div></div></div><div class="profile-stats" id="profile-stats"></div><button class="auth-btn" id="auth-logout">LOGOUT</button></div></div>`;
document.body.insertAdjacentHTML('beforeend',authMarkup);
const $=id=>document.getElementById(id);

function message(text='',error=false){$('auth-message').textContent=text;$('auth-message').classList.toggle('error',error)}
function friendly(error){const map={'Invalid login credentials':'Incorrect email or password.','User already registered':'An account already exists for this email.','Email not confirmed':'Check your email and confirm your account first.'};return map[error?.message]||error?.message||'Authentication failed. Please try again.'}
function setBusy(busy){document.querySelectorAll('#auth-gate button,#auth-gate input').forEach(el=>el.disabled=busy)}
function showGate(show){$('auth-gate').style.display=show?'flex':'none';$('auth-profile').style.display=show?'none':'block'}
showGate(true);

async function ensureProfile(user){
  const provider=user.app_metadata?.provider||'email';
  const record={id:user.id,name:user.user_metadata?.full_name||user.email?.split('@')[0]||'Operative',email:user.email,avatar_url:user.user_metadata?.avatar_url||null,last_login:new Date().toISOString(),login_provider:provider};
  const {error}=await supabase.from('profiles').upsert(record,{onConflict:'id'});if(error)throw error;
}
async function loadProgress(user){
  const {data,error}=await supabase.from('user_progress').select('progress').eq('user_id',user.id).maybeSingle();if(error)throw error;
  if(data?.progress){window.GhostProgress?.hydrate(data.progress)}else{await saveProgress(window.GhostProgress?.snapshot()||{})}
}
async function saveProgress(progress){if(!session)return;const {error}=await supabase.from('user_progress').upsert({user_id:session.user.id,progress,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(error)throw error}
function updateProfile(){if(!session)return;const u=session.user;const state=window.GhostProgress?.snapshot()||{};const ranks=['CIVILIAN','RECRUIT','SCRIPT KIDDIE','PACKET SNIFFER','PAYLOAD CRAFTER','DESYNC DEMON','HTTP GHOST','SHADOW OPERATIVE','GHOST PROTOCOL'];const cuts=[0,100,300,700,1200,1800,2600,3500,5000];let rank=ranks[0];cuts.forEach((x,i)=>{if((state.xp||0)>=x)rank=ranks[i]});$('profile-name').textContent=u.user_metadata?.full_name||u.email?.split('@')[0]||'Operative';$('profile-email').textContent=u.email||'';$('profile-avatar').src=u.user_metadata?.avatar_url||'assets/icons/png/64x64.png';$('profile-stats').textContent=`RANK: ${rank} · LEVEL: ${cuts.indexOf(cuts.filter(x=>x<=(state.xp||0)).at(-1))+1} · XP: ${state.xp||0}`}

async function acceptCallback(url){try{const parsed=new URL(url);const code=parsed.searchParams.get('code');if(!code)throw new Error(parsed.searchParams.get('error_description')||'Authentication was cancelled.');const {error}=await supabase.auth.exchangeCodeForSession(code);if(error)throw error}catch(error){message(friendly(error),true)}}
if(isElectron)window.ghostDesktop.onAuthCallback(acceptCallback);

$('auth-google').onclick=async()=>{try{setBusy(true);message('Opening secure Google sign-in…');const {data,error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:REDIRECT_URL,skipBrowserRedirect:isElectron}});if(error)throw error;if(isElectron){await window.ghostDesktop.beginOAuth(data.url);setBusy(false)}}catch(error){message(friendly(error),true);setBusy(false)}};
let signUp=false;
$('auth-mode').onclick=()=>{signUp=!signUp;$('auth-submit').textContent=signUp?'CREATE ACCOUNT':'SIGN IN';$('auth-mode').textContent=signUp?'Back to sign in':'Create account';message()};
$('auth-submit').onclick=async()=>{const email=$('auth-email').value.trim(),password=$('auth-password').value;try{setBusy(true);message();const result=signUp?await supabase.auth.signUp({email,password,options:{emailRedirectTo:REDIRECT_URL}}):await supabase.auth.signInWithPassword({email,password});if(result.error)throw result.error;if(signUp&&!result.data.session)message('Check your email to confirm your account.')}catch(error){message(friendly(error),true)}finally{setBusy(false)}};
$('auth-forgot').onclick=async()=>{const email=$('auth-email').value.trim();if(!email)return message('Enter your email address first.',true);try{setBusy(true);const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:REDIRECT_URL});if(error)throw error;message('Password reset email sent.')}catch(error){message(friendly(error),true)}finally{setBusy(false)}};
$('auth-reset-submit').onclick=async()=>{try{setBusy(true);const {error}=await supabase.auth.updateUser({password:$('auth-new-password').value});if(error)throw error;resetMode=false;$('auth-reset').classList.add('auth-hidden');$('auth-login').classList.remove('auth-hidden');message('Password updated successfully.')}catch(error){message(friendly(error),true)}finally{setBusy(false)}};
$('profile-trigger').onclick=()=>$('profile-panel').classList.toggle('auth-hidden');
$('auth-logout').onclick=async()=>{await supabase.auth.signOut()};
window.addEventListener('ghost-progress-changed',event=>{clearTimeout(syncTimer);syncTimer=setTimeout(()=>saveProgress(event.detail).catch(()=>{}),700);updateProfile()});

async function applySession(event,nextSession){
  session=nextSession;
  if(event==='PASSWORD_RECOVERY'){
    resetMode=true;
    $('auth-login').classList.add('auth-hidden');
    $('auth-reset').classList.remove('auth-hidden');
    showGate(true);
    return;
  }
  if(session){
    try{
      await ensureProfile(session.user);
      await loadProgress(session.user);
      updateProfile();
      showGate(false);
      message();
    }catch(error){
      message('Signed in, but progress sync is unavailable.',true);
      showGate(false);
    }
    if(event!=='INITIAL_SESSION'&&window.ghostSplashComplete)window.startGhostProtocol();
  }else{
    showGate(true);
    $('profile-panel').classList.add('auth-hidden');
  }
}

supabase.auth.onAuthStateChange((event,nextSession)=>{
  if(event==='INITIAL_SESSION')return;
  setTimeout(()=>applySession(event,nextSession),0);
});

async function initializeAuthentication(){
  try{
    const {data,error}=await supabase.auth.getSession();
    if(error)throw error;
    if(!data.session){
      showGate(true);
      return false;
    }
    const {data:userData,error:userError}=await supabase.auth.getUser();
    if(userError||!userData.user){
      await supabase.auth.signOut({scope:'local'});
      session=null;
      showGate(true);
      return false;
    }
    await applySession('INITIAL_SESSION',data.session);
    return true;
  }catch(error){
    session=null;
    showGate(true);
    message('Unable to restore your session. Check your connection and sign in again.',true);
    return false;
  }
}

window.ghostAuthReady=initializeAuthentication();
