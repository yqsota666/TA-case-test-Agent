import React,{useEffect,useState} from 'react';
import {requestCase} from './live-case-api.js';
const number=n=>Number(n).toLocaleString('zh-CN');
const purposeNames={discussion:'需求讨论',plan:'整理方案',data:'准备数据',review:'草稿审阅',result:'结果核对','business-output':'业务材料'};
export function AccountModelUsage({userId}) {
 const [usage,setUsage]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let active=true;setLoading(true);setError('');requestCase('/account/usage').then(v=>{if(active)setUsage(v);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[userId,refresh]);
 return <section className="account-page-section account-model-usage" aria-labelledby="account-model-title">
  <div className="account-usage-heading"><h2 id="account-model-title">AI 使用额度</h2><button className="account-page-text" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>刷新</button></div>
  {error&&<p role="alert">{error}</p>}
  {loading?<p role="status">正在读取额度…</p>:usage&&<>
   <dl><div><dt>每日额度</dt><dd>{usage.unlimited?'无限额度（演示账户）':`${number(usage.dailyTokens)} token`}</dd></div><div><dt>今日已用</dt><dd>{number(usage.usedTokens)} token</dd></div><div><dt>处理中预留</dt><dd>{number(usage.reservedTokens)} token</dd></div>{usage.uncertainTokens>0&&<div><dt>待核实消耗</dt><dd>{number(usage.uncertainTokens)} token</dd></div>}<div><dt>剩余额度</dt><dd>{usage.unlimited?'无限额度':`${number(usage.remainingTokens)} token`}</dd></div>{!usage.unlimited&&<div><dt>恢复时间</dt><dd>{new Date(usage.resetAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）</dd></div>}</dl>
   <p className="account-usage-note">文字审核、图片解析、AI 回答和重试均计入消耗。{usage.unlimited?'演示账户不扣减可用额度，仍记录实际用量。':'额度按输入和输出 token 累计；平台总额度不足时也可能暂停调用。'}{usage.uncertainTokens>0?'部分调用尚未取得实际用量，暂按预留额计入，需管理员核实。':''}</p>
   <details><summary>今日调用明细（最近 50 次）</summary>{usage.records.length?<div className="account-usage-table"><table><thead><tr><th>时间</th><th>用途 / 模型</th><th>消耗 token</th></tr></thead><tbody>{usage.records.map((r,i)=><tr key={i}><td>{new Date(r.created_at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</td><td>{purposeNames[r.purpose]||'AI 处理'}<small>{r.model}</small></td><td>{r.status==='SETTLED'?number(r.charged_tokens):`${number(r.status==='RESERVED'?r.reserved_tokens:r.charged_tokens)}（${r.status==='RESERVED'?'预留':'待核实'}）`}</td></tr>)}</tbody></table></div>:<p>今日暂无 AI 调用。</p>}</details>
  </>}
 </section>;
}
