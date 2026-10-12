import test from 'node:test';
import assert from 'node:assert/strict';
import {readHistoricalPlan} from '../src/historical-plan.js';
const scenario=(n)=>`场景 ${n}：情况${n}\n准备：输入${n}\n动作：观察状态\n预期：结果${n}\n证据：记录${n}`;
test('reads persisted labels, multiline values and an arbitrary number of cases',()=>{
 const text=`已有草稿已保存。\n测试目标：比较变化\n准备条件 1：共同条件\n补充条件\n${[1,2,3,4].map(scenario).join('\n')}\n待确认 1：缺少规则\n接收份额对账：20261012（可选）`;
 const result=readHistoricalPlan(text);
 assert.equal(result.proposal.scenarios.length,4);
 assert.deepEqual(result.proposal.preconditions,['共同条件\n补充条件']);
 assert.deepEqual(result.notes,['已有草稿已保存。']);
 assert.deepEqual(result.proposal.openQuestions,['缺少规则']);
 assert.deepEqual(result.schedule,[{action:'接收份额对账',date:'20261012（可选）'}]);
});
test('unrecognized and incomplete historical replies retain the original renderer',()=>{
 for(const text of ['一般讨论','测试目标：只知道目标',`测试目标：目标\n场景 1：不完整\n准备：条件`])assert.equal(readHistoricalPlan(text),null);
});
test('long noncomparison content is preserved and appended raw contract is not shown as a notice',()=>{
 const content='长说明'.repeat(500),text=`测试目标：检查状态\n${scenario(1).replace('输入1',content)}\n请审阅这份草稿。有修改可直接指出；准备数据与预期结果需要分别点击确认。\n准备数据（待确认）：\n{"customers":[]}`;
 const result=readHistoricalPlan(text);
 assert.equal(result.proposal.scenarios[0].setup,content);
 assert.deepEqual(result.notes,[]);
});
