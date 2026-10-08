
export function recordColumns(columns=[]) {
 const primary=['InvestorName','customer_name','name','TransactionAccountID','account_no','fund_name','fund_code','file_type','status'];
 const tail=['project','caseTitle'];
 const rank=k=>primary.includes(k)?primary.indexOf(k):tail.includes(k)?100+tail.indexOf(k):50;
 return [...columns].sort((a,b)=>rank(a.key)-rank(b.key)).map(c=>({...c,width:/证件号码|账号|申请.*编|时间/.test(c.label)?210:/证件类型/.test(c.label)?180:/名称|户名|项目|Case/.test(c.label)?170:/代码|类别|标志|类型/.test(c.label)?100:140,numeric:/余额|金额|份额$|净值/.test(c.label)&&!/类别/.test(c.label)}));
}
