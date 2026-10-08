import React,{useEffect,useRef} from 'react';
import {ArrowLeft,LogOut} from './ui-icons.jsx';
import './account-page.css';

export function AccountPage({user,busy,notice,passwordOpen,onPasswordOpen,onPasswordClose,onPasswordSubmit,onUpload,onRemove,onLogout,onBack}) {
  const title=useRef(null);
  useEffect(()=>{title.current?.focus();},[]);
  return <main className="account-page" aria-labelledby="account-page-title">
    <header className="account-page-header"><button onClick={onBack} aria-label="返回工作台"><ArrowLeft size={19}/><span>返回</span></button></header>
    <div className="account-page-content">
      <h1 ref={title} tabIndex={-1} id="account-page-title">账户设置</h1>
      <section className="account-profile" aria-label="头像">
        <div className="account-profile-avatar">{user.avatar?<img src={user.avatar} alt={`${user.name}的头像`}/>:user.name.slice(0,1)}</div>
        <div className="account-profile-actions">
          <h2>{user.name}</h2>
          <div><button className="account-page-button" disabled={busy} onClick={onUpload}>{busy?'正在保存…':user.avatar?'更换头像':'上传头像'}</button>{user.avatar&&<button className="account-page-text" disabled={busy} onClick={onRemove}>移除</button>}</div>
          <p>支持 JPG、PNG、WebP，最大 5 MB</p>
        </div>
      </section>
      <p className="account-page-notice" role="status">{notice}</p>
      <section className="account-page-section" aria-labelledby="account-info-title">
        <h2 id="account-info-title">个人信息</h2>
        <dl><div><dt>姓名</dt><dd>{user.name}</dd></div><div><dt>邮箱</dt><dd>{user.email}</dd></div></dl>
      </section>
      <section className="account-page-section" aria-labelledby="account-security-title">
        <h2 id="account-security-title">账户安全</h2>
        {!passwordOpen?<div className="account-security-row"><span>登录密码</span><button className="account-page-button" disabled={busy} onClick={onPasswordOpen}>{user.needsPasswordSetup?'设置密码':'修改密码'}</button></div>:
          <form className="account-page-password" onSubmit={onPasswordSubmit}>
            {!user.needsPasswordSetup&&<label>当前密码<input name="currentPassword" type="password" autoComplete="current-password" required disabled={busy} autoFocus/></label>}
            <label>新密码<input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} autoFocus={user.needsPasswordSetup}/></label>
            <div><button className="account-page-button" disabled={busy}>{busy?'正在保存…':'保存密码'}</button><button className="account-page-text" type="button" disabled={busy} onClick={onPasswordClose}>取消</button></div>
          </form>}
      </section>
      <footer><button className="account-page-logout" disabled={busy} onClick={onLogout}><LogOut size={17}/>退出登录</button></footer>
    </div>
  </main>;
}
