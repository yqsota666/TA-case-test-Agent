export function plannedHoldingsSteps(plan) {
  return (plan?.proposal?.exchangePlan?.steps??[]).filter(step=>step.direction==='RECEIVE'&&step.fileType==='05');
}
export function holdingsParseForStep(data,step) {
  return (data?.parses??[]).filter(parse=>(parse.receipts??[]).some(receipt=>receipt.stepId===step.stepId&&String(receipt.planVersion)===String(data.planVersion))).at(-1);
}
export function holdingsReviewRows(entry,holdings=[]) {
  return (entry?.parsed?.files??[]).filter(file=>file.fileType==='05').flatMap(file=>(file.records??[]).map((record,index)=>{
    const current=holdings.find(row=>String(row.channelId)===String(entry.channelId)&&row.transactionAccountId===record.TransactionAccountID&&row.taAccountId===record.TAAccountID&&row.fundCode===record.FundCode&&row.shareClass===record.ShareClass);
    const applied=entry.applied?.results?.find(row=>row.fileName===file.fileName&&row.recordIndex===index);
    return {record,current,index,fileName:file.fileName,applied,label:applied?({SYNCED:'已同步',UNCHANGED:'余额未变化',DETAIL_ONLY:'份额明细',FUND_SUMMARY_ONLY:'基金汇总'}[applied.status]??'未同步'):record.DetailFlag==='0'?'待确认同步':record.DetailFlag==='1'?'份额明细，不更新账户余额':'基金汇总，不更新账户余额'};
  }));
}
