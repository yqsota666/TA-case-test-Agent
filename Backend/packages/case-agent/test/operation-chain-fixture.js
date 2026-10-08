export function operationPlan({accounts=2,rounds=2}={}) {
  const step=(stepId,fileType,roundId,dependsOn=[])=>({stepId,fileType,roundId,direction:['01','03'].includes(fileType)?'SEND':'RECEIVE',businessTime:{kind:'DATE',value:'20261008'},required:true,dependsOn});
  const steps=[step('open','01','opening'),step('opened','02','opening',[{stepId:'open',condition:'SENT'}])];
  const applications=Array.from({length:accounts},(_,i)=>({key:`open_${i}`,stepId:'open',businessCode:'001',accountIndex:i,transactionAccountId:null,fundIndex:null,
    fields:{CertificateType:'0',CertificateNo:`SYNTHETIC${i}`,TransactionTime:'090000'},dependsOn:[]}));
  for(let round=0;round<rounds;round++){
    const id=`trade_${round}`,receipt=`returned_${round}`;
    steps.push(step(id,'03',id,[{stepId:'opened',condition:'PARSED'},...(round?[{stepId:`returned_${round-1}`,condition:'PARSED'}]:[])]),step(receipt,'04',id,[{stepId:id,condition:'SENT'}]));
    for(let i=0;i<accounts;i++)applications.push({key:`trade_${round}_${i}`,stepId:id,businessCode:round===rounds-1 && rounds>1?'024':'022',accountIndex:i,transactionAccountId:null,fundIndex:0,
      fields:round===rounds-1 && rounds>1?{ApplicationVol:'10.00',ChargeType:'0',LargeRedemptionFlag:'0',TransactionTime:'110000'}:{ApplicationAmount:'100.00',CurrencyType:'156',ChargeType:'0',TransactionTime:'100000'},
      dependsOn:[{applicationKey:`open_${i}`,condition:'CONFIRMED'},...(round?[{applicationKey:`trade_${round-1}_${i}`,condition:'CONFIRMED'}]:[])]});
  }
  const scenarios=applications.map(a=>({title:`合成操作 ${a.key}`,setup:'合成演练条件',action:a.businessCode==='001'?'开户':a.businessCode==='024'?'赎回10份':'申购100元',expected:'状态为CONFIRMED（成功确认）',evidence:'对应申请的TA回传'}));
  return {objective:'合成验收：多账户按依赖执行',preconditions:['所有金额、时间和数据为合成验收条件'],openQuestions:[],scenarios,exchangePlan:{status:'READY',steps,openQuestions:[]},
    contract:{version:3,protocolVersion:'22',dataSpecification:{customers:Array.from({length:accounts},(_,i)=>({name:`合成客户${i+1}`,investorType:'1',simulatedBalance:'1000.00'})),accounts:Array.from({length:accounts},(_,i)=>({customerIndex:i,branchCode:'306'})),funds:[{fundCode:'000001',fundName:'合成基金',shareClass:'0',nav:'1.00000000'}],holdings:[],missing:[]},assumptions:['合成验收'],applications,missing:[],businessExpectations:[],
      expectations:applications.map((a,scenarioIndex)=>({scenarioIndex,expectedQuote:scenarios[scenarioIndex].expected,source:'APPLICATION_CONFIRMATION',selector:{applicationKey:a.key,accountIndex:a.accountIndex,transactionAccountId:null,channelId:null,fundCode:a.fundIndex===null?null:'000001',shareClass:a.fundIndex===null?null:'0',fileType:a.businessCode==='001'?'01':'03',businessDate:'20261008'},field:'status',operator:'eq',expectedValue:'CONFIRMED'}))}};
}
