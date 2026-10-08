export function planText(value='') {
  return String(value)
    .replace(/状态(?:为|是)?\s*CONFIRMED\s*[（(]成功确认[）)]/g,'成功')
    .replace(/状态(?:为|是)?\s*FAILED\s*[（(]业务失败[）)]/g,'失败')
    .replace(/\bCONFIRMED\b/g,'确认成功')
    .replace(/\bFAILED\b/g,'失败')
    .replace(/\bSENT\b/g,'已发送')
    .replace(/\bPARSED\b/g,'已解析');
}
export function exchangeStepLabel(step) {
  const labels={'01':'发送开户申请（01）','02':'接收开户结果（02）','03':'发送申购申请（03）','04':'接收申购结果（04）','05':'接收持仓结果（05）'};
  return labels[step.fileType]??`${step.direction==='SEND'?'发送':'接收'}文件（${step.fileType}）`;
}
export function exchangeStepTime(step) {
  const time=step.businessTime;
  if(time?.kind==='DATE'&&/^\d{8}$/.test(time.value))return `${time.value.slice(0,4)}-${time.value.slice(4,6)}-${time.value.slice(6)}`;
  return planText(time?.value??'');
}
