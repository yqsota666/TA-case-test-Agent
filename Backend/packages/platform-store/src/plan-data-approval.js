import {isDeepStrictEqual} from 'node:util';
import {planBusinessInputs} from '../../platform-protocol/src/plan-business-inputs.js';

const preparation = plan => plan?.contract ? {
  ...planBusinessInputs(plan),
  contract:Object.fromEntries(Object.entries(plan.contract).filter(([key])=>!['expectations','businessExpectations','missing'].includes(key))),
} : null;

export function samePlanPreparation(previous,next) {
  const before=preparation(previous),after=preparation(next);
  return Boolean(before && after && isDeepStrictEqual(before,after));
}

const decimal=value=>typeof value==='string' && /^\d+(?:\.\d+)?$/.test(value) ? value.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'') : null;
const rowsEqual=(actual,expected,compare)=>Array.isArray(actual)&&Array.isArray(expected)&&actual.length===expected.length&&actual.every((row,i)=>compare(row,expected[i]));
export function preparedDataMatches(data,specification) {
  if(!specification || !data || specification.missing?.length)return false;
  const numberEqual=(a,b)=>decimal(a)!==null&&decimal(a)===decimal(b);
  return rowsEqual(data.customers,specification.customers,(a,b)=>a.name===b.name&&a.investor_type===b.investorType&&numberEqual(a.simulated_balance,b.simulatedBalance)) &&
    rowsEqual(data.accounts,specification.accounts,(a,b)=>String(a.customer_id)===String(data.customers[b.customerIndex]?.id)&&a.branch_code===b.branchCode&&/^\d{1,17}$/.test(a.account_no)) &&
    new Set(data.accounts.map(a=>a.account_no)).size===data.accounts.length &&
    rowsEqual(data.funds,specification.funds,(a,b)=>a.fund_code===b.fundCode&&a.fund_name===b.fundName&&a.share_class===b.shareClass&&numberEqual(a.nav,b.nav)) &&
    rowsEqual(data.holdings,specification.holdings,(a,b)=>String(a.account_id)===String(data.accounts[b.accountIndex]?.id)&&a.fund_code===specification.funds[b.fundIndex]?.fundCode&&a.share_class===specification.funds[b.fundIndex]?.shareClass&&numberEqual(a.total_volume,b.totalVolume));
}

export async function carryPlanDataApproval(db,keys,previousVersion,nextVersion,proposal) {
  if(!previousVersion || proposal.openQuestions.length || proposal.contract?.missing.length || proposal.contract?.dataSpecification.missing.length || !proposal.contract)return;
  const [[prior]]=await db.execute(`SELECT v.plan_json,c.actor_user_id,c.confirmed_at FROM case_sop_versions v
    JOIN case_plan_section_confirmations c ON c.workspace_id=v.workspace_id AND c.chat_id=v.chat_id AND c.case_id=v.case_id AND c.version_number=v.version_number AND c.section='DATA'
    WHERE v.workspace_id=? AND v.chat_id=? AND v.case_id=? AND v.version_number=? FOR UPDATE`,[...keys,previousVersion]);
  if(!prior?.plan_json || !samePlanPreparation(typeof prior.plan_json==='string'?JSON.parse(prior.plan_json):prior.plan_json,proposal))return;
  await db.execute(`INSERT INTO case_plan_section_confirmations (workspace_id,chat_id,case_id,version_number,section,actor_user_id,confirmed_at)
    VALUES (?,?,?,?,'DATA',?,?)`,[...keys,nextVersion,prior.actor_user_id,prior.confirmed_at]);
}
