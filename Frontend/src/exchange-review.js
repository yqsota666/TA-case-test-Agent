export function exchangeReviewRows(result,requests,confirmations,parseId) {
  const bySerial=new Map(requests.map(row=>[row.AppSheetSerialNo,row]));
  return (result?.files??[]).flatMap(file=>file.records??[]).map((record,index)=>{
    const request=bySerial.get(record.AppSheetSerialNo);
    const matched=Boolean(request && request.TransactionAccountID===record.TransactionAccountID &&
      (!request.FundCode || request.FundCode===record.FundCode) &&
      (!request.ShareClass || request.ShareClass===record.ShareClass));
    const applied=confirmations.some(row=>String(row.parseId)===String(parseId)&&Number(row.recordIndex)===index);
    return {record,request,index,matched,applied};
  });
}
