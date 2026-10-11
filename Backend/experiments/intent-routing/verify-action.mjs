import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createSophnetCompletion} from '../../packages/case-agent/src/sophnet.js';
import {decideDiscussionAction} from '../../packages/case-agent/src/discussion-action.js';
import {cases} from './cases.mjs';
const apiKey=execFileSync('security',['find-generic-password','-s','codex.sophnet.ta-case-test-agent','-a','api-key','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const complete=createSophnetCompletion({apiKey,maxTokens:512});
const rows=[];
for(const c of cases){
 const start=Date.now(),row={id:c.id,expected:c.expectedIntent??c.expected,input:c.input};
 try{row.decision=await decideDiscussionAction(complete,{...c.input,turns:c.input.history,pendingNextAction:null});row.passed=row.decision.intent===row.expected;}catch(error){row.error={code:error.code,message:error.message};row.passed=false;}
 row.ms=Date.now()-start;rows.push(row);writeFileSync(new URL('../../../.context/intent-routing/implementation-actions.json',import.meta.url),JSON.stringify(rows,null,2));console.log(JSON.stringify({id:row.id,expected:row.expected,actual:row.decision?.intent,passed:row.passed,error:row.error}));
}
