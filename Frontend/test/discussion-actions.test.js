import assert from 'node:assert/strict';
import test from 'node:test';
import {discussionAction} from '../src/discussion-actions.js';
const messages=[{role:'user',text:'需求'},{role:'assistant',text:'讨论问题'},{role:'user',text:'已补充'},{role:'assistant',text:'下一步：你回复“继续”，我进入方案节点。'}];
const decide=(text,extra={})=>discussionAction({text,waiting:['DISCUSS','PROPOSE_PLAN'],messages,...extra});
test('explicit proposal requests route to plan only when the workflow allows it',()=>{
  for(const text of ['请整理方案','生成测试方案。','帮我生成plan'])assert.equal(decide(text),'PROPOSE_PLAN');
  assert.equal(decide('请整理方案',{waiting:['PLAN_CONFIRM','DISCUSS']}),'DISCUSS');
  assert.equal(decide('请整理方案',{messages:messages.slice(0,2)}),'DISCUSS');
});
test('a continuation follows an explicit plan invitation, not an ordinary discussion',()=>{
  assert.equal(decide('继续'),'PROPOSE_PLAN');
  assert.equal(decide('继续',{messages:[...messages.slice(0,-1),{role:'assistant',text:'下一步：请继续补充需求'}]}),'DISCUSS');
  for(const text of ['继续讨论','不要生成方案','如何生成方案？','他说“生成方案”','确认同步'])assert.equal(decide(text),'DISCUSS');
});
