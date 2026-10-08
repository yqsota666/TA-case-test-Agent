import test from 'node:test';
import assert from 'node:assert/strict';
import {quotedInput} from '../src/assistant-ui/quoted-input.js';
test('a follow-up quotes assistant context separately from user instruction',()=>{
  assert.equal(quotedInput('  补充  ',''),'补充');
  const input=quotedInput('请改为另一条件','原条件\n原预期');
  assert.match(input,/并非用户新增规则/);assert.match(input,/> 原条件\n> 原预期/);assert.match(input,/我的补充问题：\n请改为另一条件$/);
});
test('quotes cannot send alone or bypass the discussion input limit',()=>{
  assert.throws(()=>quotedInput(' ','背景'),/补充/);
  assert.throws(()=>quotedInput('问题','长'.repeat(4000)),/4000/);
});
