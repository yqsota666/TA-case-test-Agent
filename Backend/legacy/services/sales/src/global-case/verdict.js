const normalized=value=>value==null?'':String(value);
const isoDate=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const decimal=value=>{
  const [whole,fraction='']=normalized(value).split('.');
  return `${BigInt(whole||'0')}.${fraction.padEnd(2,'0').slice(0,2)}`;
};

// A business FAILURE can satisfy a negative test. Verdicts compare the frozen
// SOP to persisted TA evidence; model explanations cannot rewrite expectations.
export function evaluateSop(sop,applications,confirmations,snapshots=[]) {
  const apps=new Map(applications.map(row=>[row.action_key,row]));
  const actualByApp=new Map();
  for(const row of confirmations){
    const key=String(row.application_id);
    if(!actualByApp.has(key)||BigInt(row.id)>BigInt(actualByApp.get(key).id))actualByApp.set(key,row);
  }
  const actions=[];
  let failed=false,review=false,waiting=false;
  for(const action of sop.actions){
    const app=apps.get(action.id);
    if(!app){actions.push({actionId:action.id,status:'WAITING_APPLICATION'});waiting=true;continue;}
    const actual=actualByApp.get(String(app.id));
    if(!actual){actions.push({actionId:action.id,status:'WAITING_RETURN',appNo:app.app_no});waiting=true;continue;}
    if(actual.match_reason||actual.match_status==='CONFLICT'||actual.outcome==='REVIEW'){
      actions.push({actionId:action.id,status:'REVIEW',appNo:app.app_no,reason:actual.match_reason||'回传归属或内容需要核对'});
      review=true;continue;
    }
    if(actual.outcome==='PARTIAL'||(actual.outcome==='SUCCESS'&&actual.business_finish_flag!=null&&actual.business_finish_flag!=='1')){
      actions.push({actionId:action.id,status:'WAITING_RETURN',appNo:app.app_no});waiting=true;continue;
    }
    const mismatches=[];
    if(actual.outcome!==action.expected.outcome)mismatches.push({field:'outcome',expected:action.expected.outcome,actual:actual.outcome});
    if(action.expected.returnCodes.length&&!action.expected.returnCodes.includes(actual.return_code))
      mismatches.push({field:'ReturnCode',expected:action.expected.returnCodes,actual:actual.return_code});
    const record=typeof actual.record_json==='string'?JSON.parse(actual.record_json):actual.record_json??{};
    for(const [name,expected]of Object.entries(action.expected.fields??{}))
      if(normalized(record[name])!==expected)mismatches.push({field:name,expected,actual:record[name]??null});
    if(action.evidence05){
      const matched=snapshots.filter(s=>String(s.trading_account_id)===String(action.tradingAccountId)
        &&s.fund_code===action.evidence05.fundCode&&s.share_class===action.evidence05.shareClass
        &&isoDate(s.snapshot_date)>=isoDate(actual.confirmation_date))
        .sort((a,b)=>BigInt(a.id)<BigInt(b.id)?1:-1)[0];
      if(!matched&&!mismatches.length){actions.push({actionId:action.id,status:'WAITING_05',appNo:app.app_no,confirmationId:String(actual.id)});waiting=true;continue;}
      if(matched&&decimal(matched.total_volume)!==decimal(action.evidence05.totalVolume))
        mismatches.push({field:'05.TotalVolOfDistributorInTA',expected:action.evidence05.totalVolume,actual:String(matched.total_volume)});
    }
    const status=mismatches.length?'FAIL':'PASS';
    actions.push({actionId:action.id,status,appNo:app.app_no,confirmationId:String(actual.id),
      businessOutcome:actual.outcome,returnCode:actual.return_code,...(mismatches.length?{mismatches}:{})});
    if(mismatches.length)failed=true;
  }
  return {verdict:review?'REVIEW':failed?'FAIL':waiting?'WAITING':'PASS',actions};
}
