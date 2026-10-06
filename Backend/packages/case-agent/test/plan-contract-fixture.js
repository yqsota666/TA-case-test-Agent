export function planContract(plan) {
 return {version:1,protocolVersion:'22',dataSpecification:{customers:[{name:'合成用户',investorType:'1',simulatedBalance:'1000.00'}],accounts:[],funds:[{fundCode:'000001',fundName:'合成基金',shareClass:'0',nav:'1.00000000'}],holdings:[],missing:[]},
 assumptions:['合成测试，仅以TA回传为准'],missing:[],
 applications:(plan.exchangePlan?.steps??[]).filter(s=>s.direction==='SEND').map(s=>({key:s.stepId,stepId:s.stepId,businessCode:s.fileType==='01'?'001':'022',accountIndex:null,transactionAccountId:'90000000000000001',fundIndex:s.fileType==='01'?null:0,fields:s.fileType==='01'?{CertificateType:'0',CertificateNo:'SYNTHETIC000001',TransactionTime:'120000'}:{ApplicationAmount:'100.00',CurrencyType:'156',ChargeType:'0',TransactionTime:'120000'}})),
 expectations:plan.scenarios.map((s,i)=>({scenarioIndex:i,expectedQuote:s.expected,source:'APPLICATION_CONFIRMATION',selector:{accountIndex:null,transactionAccountId:'90000000000000001',channelId:null,fundCode:null,shareClass:null,fileType:'03',businessDate:'20261006'},field:'status',operator:'eq',expectedValue:'CONFIRMED'}))};
}
