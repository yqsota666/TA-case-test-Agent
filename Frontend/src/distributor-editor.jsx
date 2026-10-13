import React,{useEffect,useRef,useState} from 'react';
import {requestCase} from './live-case-api.js';
import {X} from './ui-icons.jsx';
import {editableDeliveryProfile} from './distributor-format.js';
import {DistributorFormatFields} from './distributor-format-fields.jsx';

const fields=[['channel_name','销售商名称',120],['distributor_code','销售商代码',9],['ta_code','TA 代码',9],['ta_environment','环境',80]];
export function DistributorEditor({row,onClose,onSaved}){
 const dialog=useRef(null),opener=useRef(document.activeElement);
 const [value,setValue]=useState(row?Object.fromEntries([...fields.map(([key])=>[key,row[key]]),['protocol_version',row.protocol_version]]):{channel_name:'',distributor_code:'',ta_code:'',ta_environment:'LOCAL',protocol_version:'22'});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [profile,setProfile]=useState(row?.delivery_profile?editableDeliveryProfile(row.delivery_profile):null),[formatLoading,setFormatLoading]=useState(false),[formatError,setFormatError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{dialog.current.showModal();return()=>opener.current?.focus();},[]);
 useEffect(()=>{
  if(row)return;
  setProfile(null);setFormatError('');
  if(!/^[0-9A-Za-z]{1,9}$/.test(value.distributor_code)||!/^[0-9A-Za-z]{1,9}$/.test(value.ta_code)){setFormatLoading(false);return;}
  let active=true;setFormatLoading(true);
  const timer=setTimeout(()=>requestCase('/data/distributors/default-profile?'+new URLSearchParams({distributorCode:value.distributor_code,taCode:value.ta_code,protocolVersion:value.protocol_version})).then(data=>{if(active){setProfile(editableDeliveryProfile(data.profile));setFormatLoading(false);}}).catch(failure=>{if(active){setFormatError(failure.message);setFormatLoading(false);}}),250);
  return()=>{active=false;clearTimeout(timer);};
 },[row,value.distributor_code,value.ta_code,value.protocol_version,retry]);
 function close(){if(busy)return;dialog.current.close();onClose();}
 async function save(event){
  event.preventDefault();if(busy||!profile||formatLoading)return;setBusy(true);setError('');
  try{await requestCase('/data/distributors'+(row?'/'+row.id:''),value);dialog.current.close();onSaved();}
  catch(failure){setError(failure.message);setBusy(false);}
 }
 return <dialog ref={dialog} className="gc-detail gc-distributor-editor" aria-labelledby="gc-distributor-title" onCancel={event=>{event.preventDefault();close();}} onClick={event=>{if(event.target===dialog.current)close();}}>
  <header><h2 id="gc-distributor-title">{row?'编辑销售商':'新增销售商'}</h2><button type="button" aria-label="关闭销售商配置" disabled={busy} onClick={close}><X size={18}/></button></header>
  <form onSubmit={save}>
   {fields.map(([key,label,maxLength])=><label key={key}><span>{label}</span><input value={value[key]} required maxLength={maxLength} pattern={key.endsWith('_code')?'[0-9A-Za-z]{1,9}':undefined} disabled={busy||Boolean(row&&key!=='channel_name')} onChange={event=>setValue(previous=>({...previous,[key]:event.target.value}))}/></label>)}
   <label><span>文件格式</span><select value={value.protocol_version} disabled={busy||Boolean(row)} onChange={event=>setValue(previous=>({...previous,protocol_version:event.target.value}))}><option value="22">TA 2.2</option><option value="21">TA 2.1</option></select></label>
   {row&&<p className="gc-config-note">代码、TA、文件格式和环境保存后固定。如需更换，请新增配置。</p>}
   {profile?<DistributorFormatFields profile={profile} value={value}/>:<p className="gc-config-note" role="status">{formatLoading?'正在读取默认文件格式…':formatError||'填写销售商和 TA 代码后加载文件格式。'}{formatError&&<button type="button" onClick={()=>setRetry(t=>t+1)}>重试</button>}</p>}
   {error&&<p className="gc-config-error" role="alert">{error}</p>}
   <footer><button type="button" disabled={busy} onClick={close}>取消</button><button type="submit" disabled={busy||formatLoading||!profile}>{busy?'正在保存…':'保存'}</button></footer>
  </form>
 </dialog>;
}
