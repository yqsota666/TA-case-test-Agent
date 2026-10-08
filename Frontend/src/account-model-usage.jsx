import React,{useEffect,useState} from 'react';
import {requestCase} from './live-case-api.js';
export function AccountModelUsage({userId}) {
 const [usage,setUsage]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let active=true;setLoading(true);setError('');requestCase('/account/usage').then(v=>{if(active)setUsage(v);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[userId,refresh]);
 const remaining=usage&&!usage.unlimited?Math.max(0,Math.min(100,usage.remainingTokens/usage.dailyTokens*100)):null;
 const label=remaining===0?'今日额度已用尽':remaining<=20?'剩余额度较少':'剩余额度充足';
 return <section className="account-page-section account-model-usage" aria-labelledby="account-model-title">
  <div className="account-usage-heading"><h2 id="account-model-title">AI 使用额度</h2><button className="account-page-text" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>刷新</button></div>
  {error&&<p role="alert">{error}</p>}
  {loading?<p role="status">正在读取额度…</p>:usage&&<>
   <div className="account-quota-meter">
    <div className="account-quota-caption"><span>{usage.unlimited?'演示账户':'每日额度'}</span><span>{usage.unlimited?'无限额度':label}</span></div>
    <div className="account-quota-track" {...(usage.unlimited?{'aria-hidden':true}:{role:'progressbar','aria-label':'每日剩余额度','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':remaining,'aria-valuetext':label})}>
     <span className="account-quota-fill" style={{width:usage.unlimited?'100%':`${remaining}%`}}/>
    </div>
    <p>{usage.unlimited?'不限每日使用量': '每日北京时间零点恢复'}</p>
   </div>
   {usage.reservedTokens>0&&<p className="account-usage-note" role="status">有请求正在处理，已暂时预留相应额度。</p>}
   {usage.uncertainTokens>0&&<p className="account-usage-note">部分调用用量待核实，暂按预留额计入额度。</p>}
  </>}
 </section>;
}
