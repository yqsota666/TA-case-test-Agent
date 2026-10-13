export function showExchangeEntry(plan,generatedData) {
  return plan?.status==='LOCKED'&&generatedData?.reviewStatus==='CONFIRMED'&&
    Boolean(plan.proposal?.contract)&&plan.proposal?.exchangePlan?.status==='READY';
}
