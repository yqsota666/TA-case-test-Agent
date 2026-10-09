import React,{useEffect,useRef,useState} from 'react';
import {ArrowRight,Eye,EyeOff} from './ui-icons.jsx';
import {requestCase} from './live-case-api.js';
import {setAccountStorageOwner} from './account-storage.js';
import './account-gate.css';
import {avatarImage} from './avatar-image.js';
import {AccountPage} from './account-page.jsx';

function AuthForm({onAuthenticated}) {
  const [register,setRegister]=useState(false);
  const [visible,setVisible]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const demo=async()=>{
    if(busy)return;setBusy(true);setError('');
    try {const result=await requestCase('/auth/demo',{});onAuthenticated(result.user,true);}
    catch(error){setError(error.message);}finally{setBusy(false);}
  };
  const submit=async event=>{
    event.preventDefault();if(busy)return;
    const form=new FormData(event.currentTarget);
    const input={email:form.get('email'),password:form.get('password'),...(register?{name:form.get('name')}:{})};
    setBusy(true);setError('');
    try {const result=await requestCase('/auth/'+(register?'register':'login'),input);onAuthenticated(result.user,true);}
    catch(error){setError(error.message);}finally{setBusy(false);}
  };
  return <main className="account-entry">
    <section className="account-sheet" aria-labelledby="account-title">
      <div className="account-brand-row">
        <img className="account-brand" src="/brand/ta-agent-bot-white.png" alt="" onError={event=>{event.currentTarget.hidden=true;}} />
        <div className="account-name">TA Test Agent</div>
      </div>
      <h1 id="account-title">{register?'创建账户':'登录'}</h1>
      <form onSubmit={submit} aria-busy={busy}>
        {register&&<label>姓名<input name="name" autoComplete="name" required maxLength={80} disabled={busy}/></label>}
        <label>邮箱<input name="email" type="email" autoComplete="email" required maxLength={190} disabled={busy}/></label>
        <label>密码<span className="account-password"><input name="password" type={visible?'text':'password'} autoComplete={register?'new-password':'current-password'} required minLength={8} maxLength={128} disabled={busy}/><button type="button" className="account-eye" onClick={()=>setVisible(!visible)} aria-label={visible?'隐藏密码':'显示密码'} disabled={busy}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>
        <p className="account-error" role="alert">{error}</p>
        <button className="account-submit" type="submit" disabled={busy}>{busy?'正在处理…':register?'创建账户':'登录'}{!busy&&<ArrowRight size={18}/>}</button>
      </form>
      <button className="account-switch" disabled={busy} onClick={()=>{setRegister(!register);setError('');}}>{register?'已有账户？登录':'创建账户'}</button>
      {!register&&<button type="button" className="account-demo" onClick={demo} disabled={busy}>模拟账户登录<ArrowRight size={16}/></button>}
    </section>
  </main>;
}
export function AccountGate({children}) {
  const [user,setUser]=useState(null);
  const [checking,setChecking]=useState(true);
  const [unavailable,setUnavailable]=useState('');
  const [busy,setBusy]=useState(false);
  const [accountOpen,setAccountOpen]=useState(()=>new URLSearchParams(location.search).get('page')==='account');
  const [notice,setNotice]=useState('');
  const [passwordOpen,setPasswordOpen]=useState(false);
  const identity=useRef(null);
  const generation=useRef(0);
  const avatarInput=useRef(null);
  const accountControl=useRef(null);
  const openAccount=event=>{
    accountControl.current=event.currentTarget;
    const url=new URL(location.href);url.searchParams.set('page','account');
    history.pushState({...history.state,accountReturn:location.href},'',url);
    setAccountOpen(true);setPasswordOpen(false);setNotice('');
  };
  const closeAccount=()=>{
    if(history.state?.accountReturn){history.back();return;}
    const url=new URL(location.href);url.searchParams.delete('page');history.replaceState(history.state,'',url);
    setAccountOpen(false);setPasswordOpen(false);setNotice('');
    requestAnimationFrame(()=>accountControl.current?.focus());
  };
  useEffect(()=>{
    const navigate=()=>{const open=new URLSearchParams(location.search).get('page')==='account';setAccountOpen(open);setPasswordOpen(false);setNotice('');if(!open)requestAnimationFrame(()=>accountControl.current?.focus());};
    window.addEventListener('popstate',navigate);return()=>window.removeEventListener('popstate',navigate);
  },[]);
  const broadcast=()=>{try{localStorage.setItem('case-account-changed',crypto.randomUUID());}catch{}};
  const authenticated=(value,fresh=false)=>{
    if(fresh)generation.current++;
    const changed=identity.current&&identity.current!==value.id;
    identity.current=value.id;setAccountStorageOwner(value.id);
    if(fresh)broadcast();
    if(fresh||changed){const url=new URL(location.href);for(const key of ['chatId','caseId','draftTable'])url.searchParams.delete(key);history.replaceState(history.state,'',url);}
    setUser(value);setChecking(false);setUnavailable('');
  };
  const check=async()=>{const epoch=++generation.current;if(!identity.current)setChecking(true);setUnavailable('');try{const result=await requestCase('/auth/me');if(epoch===generation.current)authenticated(result.user);}catch(error){if(epoch===generation.current){setUser(null);identity.current=null;setAccountStorageOwner(null);if(error.status!==401)setUnavailable(error.message);}}finally{if(epoch===generation.current)setChecking(false);}};
  useEffect(()=>{
    check();
    const expired=()=>{setUser(null);setAccountStorageOwner(null);check();};
    const switched=event=>{if(event.key==='case-account-changed'){setUser(null);setAccountStorageOwner(null);check();}};
    const focus=()=>check();
    const visibility=()=>{if(document.visibilityState==='visible')check();};
    window.addEventListener('case-session-expired',expired);window.addEventListener('storage',switched);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visibility);
    return()=>{generation.current++;window.removeEventListener('case-session-expired',expired);window.removeEventListener('storage',switched);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  const changePassword=async event=>{
    event.preventDefault();if(busy)return;setBusy(true);setNotice('');
    const form=new FormData(event.currentTarget);
    try {const result=await requestCase('/auth/password',{currentPassword:form.get('currentPassword')||'',newPassword:form.get('newPassword')});setUser(result.user);setPasswordOpen(false);setNotice('密码已设置');broadcast();}
    catch(error){setNotice(error.message);}finally{setBusy(false);}
  };
  const logout=async()=>{setBusy(true);setNotice('');try{await requestCase('/auth/logout',{});generation.current++;setUser(null);identity.current=null;setAccountStorageOwner(null);setAccountOpen(false);setPasswordOpen(false);broadcast();const url=new URL(location.href);for(const key of ['chatId','caseId','draftTable'])url.searchParams.delete(key);if(url.searchParams.get('page')==='account')url.searchParams.delete('page');history.replaceState(null,'',url);}catch(error){setNotice(error.message);}finally{setBusy(false);}};
  const saveAvatar=async file=>{
    if(busy)return;
    const accountId=identity.current;
    setBusy(true);setNotice('');
    try {
      const avatar=file?await avatarImage(file):null;
      if(identity.current!==accountId)return;
      const result=await requestCase('/auth/avatar',{avatar});
      if(identity.current===accountId){generation.current++;setUser(result.user);setNotice(file?'头像已更新':'头像已移除');broadcast();}
    } catch(error){if(identity.current===accountId)setNotice(error.message);}
    finally{setBusy(false);if(avatarInput.current)avatarInput.current.value='';}
  };
  const control=floating=><div className={`account-control${floating?' account-floating':''}`}>
    <button className="account-identity" onClick={openAccount} aria-label="账户设置">
      <span className="account-avatar">{user?.avatar?<img src={user.avatar} alt=""/>:user?.name.slice(0,1)}</span>
      <span className="account-display-name">{user?.name}</span>
    </button>
  </div>;
  if(checking)return <main className="account-entry"><div className="account-loading" role="status">正在连接…</div></main>;
  if(unavailable)return <main className="account-entry"><section className="account-sheet"><p role="alert">{unavailable}</p><button className="account-submit" onClick={check}>重新连接</button></section></main>;
  if(!user)return <><AuthForm onAuthenticated={authenticated}/>{notice&&<div className="account-notice" role="status">{notice}</div>}</>;
  return <><div hidden={accountOpen}><React.Fragment key={user.id}>{React.cloneElement(children,{accountControl:control(false)})}</React.Fragment>{control(true)}</div>
    <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="选择头像图片" onChange={event=>{const file=event.target.files?.[0];if(file)saveAvatar(file);}}/>
    {accountOpen&&<AccountPage key={user.id} user={user} busy={busy} notice={notice} passwordOpen={passwordOpen} onPasswordOpen={()=>{setPasswordOpen(true);setNotice('');}} onPasswordClose={()=>{setPasswordOpen(false);setNotice('');}} onPasswordSubmit={changePassword} onUpload={()=>avatarInput.current?.click()} onRemove={()=>saveAvatar(null)} onLogout={logout} onBack={closeAccount}/>}</>;
}
