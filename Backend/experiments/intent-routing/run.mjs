import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {route} from './router.mjs';
import {cases} from './cases.mjs';
import {discussionAction} from '../../../Frontend/src/discussion-actions.js';

const output=fileURLToPath(new URL('../../../.context/intent-routing/',import.meta.url));
mkdirSync(output,{recursive:true});
const apiKey=execFileSync('security',['find-generic-password','-s','codex.sophnet.ta-case-test-agent','-a','api-key','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
if(!apiKey)throw new Error('KEYCHAIN_UNAVAILABLE');
const recovering=process.env.EXPERIMENT_RETRY_ERRORS==='1';
const rows=recovering?JSON.parse(readFileSync(output+'routing-results.json','utf8')).rows:[];
const repeats=Number(process.env.EXPERIMENT_REPEATS||2);
const selected=process.env.EXPERIMENT_IDS?cases.filter(c=>process.env.EXPERIMENT_IDS.split(',').includes(c.id)):cases;
const methods=(process.env.EXPERIMENT_METHODS||'json,tools').split(',');
for(const c of recovering?[]:selected){
  const action=discussionAction({text:c.input.userInput,waiting:c.input.allowedActions,messages:c.input.history.map(t=>({role:t.role,text:t.content}))});
  rows.push({id:c.id,method:'baseline',repeat:0,expected:c.expected,actual:action,passed:action===c.expected,category:c.category,input:c.input});
}
const latestBefore=[...new Map(rows.map(r=>[`${r.id}:${r.method}:${r.repeat}`,r])).values()];
const jobs=recovering?latestBefore.filter(r=>r.error==='PROVIDER_HTTP_429').map(r=>({c:cases.find(c=>c.id===r.id),method:r.method,repeat:r.repeat,attempt:(r.attempt||1)+1})):Array.from({length:repeats},(_,repeat)=>selected.flatMap(c=>methods.map(method=>({c,method,repeat:repeat+1,attempt:1})))).flat();
let next=0;
async function worker(){
  while(next<jobs.length){
    const {c,method,repeat,attempt}=jobs[next++];
    const row={id:c.id,method,repeat,attempt,expected:c.expected,category:c.category,input:c.input};
    try{Object.assign(row,await route({method,input:c.input,apiKey}));row.actual=row.decision.intent;row.passed=row.actual===c.expected;}
    catch(error){row.error=error.message;row.passed=false;}
    rows.push(row);
    writeFileSync(output+'routing-results.json',JSON.stringify({model:'DeepSeek-V4-Pro-0813',base:'29c37109',temperature:0,thinking:'disabled',repeats,rows},null,2));
    console.log(JSON.stringify({id:c.id,method,repeat,actual:row.actual,passed:row.passed,error:row.error,latencyMs:row.latencyMs}));
  }
}
await Promise.all(Array.from({length:3},worker));
const latest=[...new Map(rows.map(r=>[`${r.id}:${r.method}:${r.repeat}`,r])).values()];
for(const method of ['baseline',...methods]){
  const subset=latest.filter(r=>r.method===method),times=subset.map(r=>r.latencyMs).filter(Number.isFinite).sort((a,b)=>a-b);
  console.log(JSON.stringify({method,total:subset.length,passed:subset.filter(r=>r.passed).length,falsePositive:subset.filter(r=>r.expected==='DISCUSS'&&r.actual==='PROPOSE_PLAN').length,errors:subset.filter(r=>r.error).length,medianMs:times[Math.floor(times.length/2)],p95Ms:times[Math.min(times.length-1,Math.floor(times.length*.95))]}));
}
