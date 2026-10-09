import React from 'react';
import {deliveryFilePreview} from './distributor-format.js';

export function DistributorFormatFields({profile,onChange,value,disabled}){
 const change=(key,next)=>onChange({...profile,[key]:next});
 const suffix=(kind,next)=>change('indexSuffixes',{...profile.indexSuffixes,[kind]:next});
 return <fieldset className="gc-delivery-fields" disabled={disabled}><legend>文件格式</legend>
  <div className="gc-delivery-checks">
   {[['aml','反洗钱配套文件（OFX、X1、X3）'],['includeEmptyR1','R1 文件（无申报记录时保留空文件）'],['dataSequence','文件名包含序号（_001）'],['trailingCrlf','文件末尾保留 CRLF 换行']].map(([key,label])=><label key={key} className="gc-delivery-check"><input type="checkbox" checked={profile[key]} disabled={disabled||(['aml','includeEmptyR1'].includes(key)&&value.protocol_version!=='22')} onChange={event=>change(key,event.target.checked)}/><span>{label}</span></label>)}
  </div>
  <div className="gc-delivery-grid">
   <label><span>OFI 索引后缀</span><input value={profile.indexSuffixes.OFI} maxLength={17} pattern="(-[A-Za-z0-9]{1,16})?" placeholder="无后缀" onChange={event=>suffix('OFI',event.target.value)}/></label>
   <label><span>OFX 索引后缀</span><input value={profile.indexSuffixes.OFX} disabled={disabled||!profile.aml} maxLength={17} pattern="(-[A-Za-z0-9]{1,16})?" placeholder="无后缀" onChange={event=>suffix('OFX',event.target.value)}/></label>
   <label><span>解压目录</span><select value={profile.directoryLayout} onChange={event=>change('directoryLayout',event.target.value)}><option value="distributor/date">销售商代码 / 业务日期</option><option value="date">业务日期</option><option value="flat">无子目录</option></select></label>
   <label><span>字段名大小写</span><select value={profile.fieldNamesCase} onChange={event=>change('fieldNamesCase',event.target.value)}><option value="canonical">协议字典大小写</option><option value="upper">全部大写</option></select></label>
   <label><span>文件头汇总号</span><input type="number" min="1" max="999" step="1" required value={profile.summaryNo} onChange={event=>change('summaryNo',event.target.value===''?'':Number(event.target.value))}/></label>
   <label><span>文件头发送方</span><input value={profile.sender} maxLength={8} pattern="[A-Za-z0-9 ]{0,8}" onChange={event=>change('sender',event.target.value)}/></label>
   <label><span>文件头接收方</span><input value={profile.recipient} maxLength={8} pattern="[A-Za-z0-9 ]{0,8}" onChange={event=>change('recipient',event.target.value)}/></label>
  </div>
  <details className="gc-delivery-preview"><summary>开户＋交易文件名示例</summary><ul>{deliveryFilePreview(value,profile).map(({type,fileName})=><li key={type}>{fileName}</li>)}</ul></details>
  <p className="gc-config-note">保存后用于后续生成。已生成的 ZIP 保留原件。字段定义由所选协议版本确定。</p>
 </fieldset>;
}
