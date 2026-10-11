import test from 'node:test';
import assert from 'node:assert/strict';
import {decideDiscussionAction} from '../src/discussion-action.js';
import {createSophnetCompletion} from '../src/sophnet.js';
const context={allowedActions:['DISCUSS'],userInput:'解释一下'};
for(const value of [null,{intent:'PROPOSE_PLAN',needsClarification:false,reason:'越过阶段',nextAction:null},{intent:'DISCUSS',needsClarification:true,reason:'歧义',nextAction:'PROPOSE_PLAN'}])test('malformed or forbidden tool decision is rejected '+JSON.stringify(value),async()=>{
 await assert.rejects(decideDiscussionAction(async()=>({tool_calls:[{function:{name:'route_action',arguments:JSON.stringify(value)}}]}),context),{code:'ACTION_DECISION_INVALID'});
});
test('Sophnet tool response uses quota governance and carries cancellation without requiring text',async()=>{
 let payload,governed;const controller=new AbortController();
 const message={content:null,tool_calls:[{function:{name:'route_action',arguments:'{}'}}]};
 const complete=createSophnetCompletion({client:{chat:{completions:{create:async(body,options)=>{payload=body;assert.equal(options.signal,controller.signal);return {choices:[{message}],usage:{total_tokens:1}};}}}},govern:async input=>{governed=input;return input.invoke();},maxTokens:8192});
 const tools=[{type:'function',function:{name:'route_action',parameters:{type:'object'}}}];
 assert.deepEqual(await complete({system:'route',user:'input',tools,maxTokens:512,signal:controller.signal}),message);
 assert.deepEqual(payload.tools,tools);assert.equal(payload.max_tokens,512);assert.ok(governed.messages.at(-1).content.includes('route_action'));
});
test('a quoted null from the provider is repaired once without accepting malformed parameters',async()=>{
 let calls=0;
 const result=await decideDiscussionAction(async request=>{
  calls++;
  assert.deepEqual(request.toolChoice,{type:'function',function:{name:'route_action'}});
  if(calls===2)assert.equal(JSON.parse(request.user).previousDecision.tool_calls.length,1);
  return {tool_calls:[{function:{name:'route_action',arguments:JSON.stringify({intent:'DISCUSS',needsClarification:false,reason:'讨论调整份额',nextAction:calls===1?'null':null})}}]};
 },context);
 assert.equal(calls,2);assert.equal(result.nextAction,null);assert.equal(result.intent,'DISCUSS');
});
