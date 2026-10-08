import React,{useEffect,useRef,useState} from 'react';
import {Check,Minus,RefreshCw,Upload} from 'lucide-react';
import {requestCase,casePath} from './live-case-api.js';
import './result-review.css';
const fieldNames={status:'处理结果',returnCode:'返回码',transactionAccountId:'交易账户',fundCode:'基金代码',shareClass:'份额类别',confirmedAmount:'确认金额',confirmedVolume:'确认份额',taAccountId:'TA账户',branchCode:'分支',totalVolume:'总份额',availableVolume:'可用份额',frozenVolume:'冻结份额',snapshotDate:'持仓日期'};
const checkLabel=c=>c.field==='status'?({'01':'开户结果','03':'申购结果'}[c.source?.fileType]??fieldNames.status):(fieldNames[c.field]??'预期结果');
const show=value=>({CONFIRMED:'成功确认',FAILED:'失败',PASS:'通过',FAIL:'未通过',REVIEW:'待核对',WAITING:'等待回传',MATCH:'一致',DIFFERENT:'不一致',UNCLEAR:'待补充'}[value]??value??'—');
const clean=value=>String(value??'').replaceAll('CONFIRMED','成功确认').replaceAll('FAILED','失败');
export function ResultReview({chatId,caseId,onChanged,onDirtyChange,readOnly}){
 const path=casePath(chatId,caseId),generation=useRef(0),fileInput=useRef(null),fileRead=useRef(0);
 const [review,setReview]=useState(null),[lockedPlan,setLockedPlan]=useState(null),[businessOutput,setBusinessOutput]=useState(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reason,setReason]=useState(''),[content,setContent]=useState(''),[sourceKind,setSourceKind]=useState('USER_RESULT'),[verdict,setVerdict]=useState('PASS');
 useEffect(()=>{const current=++generation.current;setReview(null);setLockedPlan(null);setBusinessOutput(null);setContent('');setReason('');setError('');
  Promise.all([requestCase(path+'/result-review'),requestCase(path+'/plan'),requestCase(path+'/result-review/business-output')]).then(([r,p,b])=>{if(current!==generation.current)return;setReview(r);setLockedPlan(p);setBusinessOutput(b.businessOutput);setContent(b.businessOutput?.content??'');setSourceKind(b.businessOutput?.sourceKind??'USER_RESULT');}).catch(e=>{if(current===generation.current)setError(e.message);});
  return()=>{generation.current++;};
 },[path]);
 const run=async(action)=>{const current=generation.current;setBusy(true);setError('');let failure=null;
  try{await action();}catch(e){failure=e;}
  if(current!==generation.current)return;
  try{const [r,b]=await Promise.all([requestCase(path+'/result-review'),requestCase(path+'/result-review/business-output')]);if(current!==generation.current)return;setReview(r);setBusinessOutput(b.businessOutput);
   if(!failure){try{const w=await requestCase(path+'/workflow');await requestCase(path+'/workflow/resume',{eventId:crypto.randomUUID(),expectedStage:w.stage});}catch(e){failure=new Error('结果已保存，流程状态暂未刷新。请重新打开查看。');}}
   if(current===generation.current)await onChanged(()=>current===generation.current);
  }catch(e){failure??=e;}finally{if(current===generation.current){setBusy(false);if(failure)setError(failure.message);}}
 };
 const suggestion=review?.suggestion,plan=review?.snapshot?.plan??lockedPlan?.proposal;
 const checks=suggestion?.checks??[],business=plan?.contract?.businessExpectations??[],businessChecks=suggestion?.businessChecks??[];
 const unsaved=content!==(businessOutput?.content??'')||sourceKind!==(businessOutput?.sourceKind??'USER_RESULT');
 const reviewedOutput=review?.snapshot?.businessOutput;
 const currentOutput=!business.length||(reviewedOutput?.id===businessOutput?.id&&reviewedOutput?.sha256===businessOutput?.sha256&&reviewedOutput?.sourceKind===businessOutput?.sourceKind);
 useEffect(()=>{if(['PASS','FAIL'].includes(suggestion?.outcome))setVerdict(suggestion.outcome);},[review?.reviewId]);
 useEffect(()=>{onDirtyChange?.(unsaved);return()=>onDirtyChange?.(false);},[unsaved,onDirtyChange]);
 const canConfirm=['PASS','FAIL'].includes(suggestion?.outcome)&&!review?.finalVerdict&&!readOnly&&!unsaved&&currentOutput;
 const readFile=async file=>{if(!file)return;const current=generation.current,read=++fileRead.current;setError('');if(file.size>128000){setError('请选择较小的文本文件，或粘贴相关结果片段');return;}try{const text=await file.text();if(current!==generation.current||read!==fileRead.current)return;if(text.length>32000||text.includes('\u0000'))throw new Error('请选择不超过32000字的文本结果');setContent(text);}catch(e){if(current===generation.current&&read===fileRead.current)setError(e.message);}if(fileInput.current)fileInput.current.value='';};
 return <div className="cw-review-result" aria-busy={busy}>
  <div className="cw-review-result-actions"><strong>{review?.finalVerdict?'已确认'+show(review.finalVerdict):suggestion?({PASS:'核对一致',FAIL:'存在差异',REVIEW:'待核对',WAITING:'等待回传'}[suggestion.outcome]??'待核对'):'核对实际结果'}</strong><button type="button" className="cw-exchange-button" disabled={busy||readOnly||unsaved} onClick={()=>run(()=>requestCase(path+'/result-review/evaluate',{}))}><RefreshCw size={14}/>{busy?'核对中…':'核对结果'}</button></div>
  {checks.length>0&&<div className="cw-review-groups">{(plan?.scenarios??[]).map((scenario,index)=><section key={index}><h3>{scenario.title}</h3><div className="cw-review-check-table" tabIndex={0} aria-label={`${scenario.title}的结果对照`}><table><thead><tr><th>核对内容</th><th>预期</th><th>实际</th><th>结果</th></tr></thead><tbody>{checks.filter(c=>c.scenarioIndex===index).map((c,i)=><tr key={i}><td>{checkLabel(c)}</td><td>{show(c.expectedValue)}</td><td>{show(c.actualValue)}</td><td><span className={c.matched?'is-matched':''}>{c.matched?<Check size={14}/>:<Minus size={14}/>} {c.matched?'一致':'不一致'}</span></td></tr>)}</tbody></table></div></section>)}</div>}
  {business.length>0&&<section className="cw-review-business"><h3>业务结果</h3><div>{business.map((item,i)=>{const check=businessChecks.find(c=>c.scenarioIndex===item.scenarioIndex&&c.expectedQuote===item.expectedQuote);return <details key={i}><summary>{plan?.scenarios?.[item.scenarioIndex]?.title??'业务预期'}{check&&<span className="cw-review-business-status">{show(check.verdict)}</span>}</summary><p>{clean(item.expectedQuote??item.expected??item.description)}</p>{check&&<div className="cw-review-business-check"><blockquote>{check.resultQuote}</blockquote><p>{check.explanation}</p></div>}</details>;})}</div>
   <div className="cw-review-output"><label htmlFor="cw-result-source">结果来源</label><select id="cw-result-source" value={sourceKind} onChange={e=>setSourceKind(e.target.value)} disabled={busy||readOnly||!!review?.finalVerdict}><option value="USER_RESULT">实际业务输出</option><option value="SYNTHETIC_TEST">合成演练输出</option></select>
    {sourceKind==='SYNTHETIC_TEST'&&<p role="status">用于演练，不代表真实业务验证。</p>}
    <label htmlFor="cw-result-content">补充实际结果</label><textarea id="cw-result-content" value={content} onChange={e=>{fileRead.current++;setContent(e.target.value);}} rows={7} maxLength={32000} disabled={busy||readOnly||!!review?.finalVerdict} placeholder="粘贴相关业务输出或日志"/>
    {!readOnly&&!review?.finalVerdict&&<><input ref={fileInput} type="file" accept=".txt,.json,.csv,.log,.md,text/plain,application/json,text/csv" hidden onChange={e=>readFile(e.target.files?.[0])}/><button className="cw-review-upload" type="button" disabled={busy} onClick={()=>fileInput.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)readFile(e.dataTransfer.files?.[0]);}}><Upload size={16}/>拖入文本文件，或点击选择</button><button className="cw-primary-button" type="button" disabled={busy||!content.trim()||!unsaved||!lockedPlan?.versionNumber} onClick={()=>run(async()=>{await requestCase(path+'/result-review/business-output',{requestId:crypto.randomUUID(),planVersion:lockedPlan.versionNumber,sourceKind,content});await requestCase(path+'/result-review/evaluate',{});})}>保存并核对</button></>}
   </div>
  </section>}
  {suggestion?.pending?.length>0&&<p>还有文件回传尚未完成，请先在文件交换中接收并确认。</p>}
  {suggestion?.issues?.length>0&&business.length>0&&<p role="status">尚无法确认全部业务结果，请展开查看并补充对应输出后重新核对。</p>}
  {suggestion?.issues?.length>0&&!business.length&&<p role="status">当前证据尚不足以确定结论，请核对预期与实际结果。</p>}
  {canConfirm&&<footer><fieldset className="cw-review-verdict"><legend>核对结论</legend>{[['PASS','通过'],['FAIL','未通过']].map(([value,label])=><label key={value}><input type="radio" name="result-verdict" value={value} checked={verdict===value} onChange={()=>setVerdict(value)} disabled={busy}/>{label}</label>)}</fieldset><label htmlFor="cw-review-reason">核对说明</label><textarea id="cw-review-reason" rows={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="填写本次核对说明"/><button type="button" className="cw-primary-button" disabled={busy||!reason.trim()} onClick={()=>run(()=>requestCase(path+'/result-review/confirm',{reviewId:review.reviewId,verdict,reason}))}>确认{show(verdict)}</button></footer>}
  {review?.finalVerdict&&review.reason&&<p>{review.reason}</p>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
