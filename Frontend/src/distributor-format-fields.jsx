import React from 'react';
import {deliveryFilePreview,deliveryFormatSummary,protocolVersionLabel} from './distributor-format.js';

export function DistributorFormatFields({profile,value}){
 return <section className="gc-delivery-fields" aria-label="版本对应格式">
  <p className="gc-config-note">TA {protocolVersionLabel(value.protocol_version)} → {deliveryFormatSummary(profile)}</p>
  <details className="gc-delivery-preview"><summary>查看文件名示例</summary><ul>{deliveryFilePreview(value,profile).map(({type,fileName})=><li key={type}>{fileName}</li>)}</ul></details>
  <p className="gc-config-note">字段、文件头和编码按协议版本统一映射。已确认的销售商交付差异单独保留。</p>
 </section>;
}
