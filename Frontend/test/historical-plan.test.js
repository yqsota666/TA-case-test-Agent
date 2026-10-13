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

test('history navigation requires an actual later plan message, not just any current plan',async()=>{
 const {historicalPlanStatus}=await import('../src/historical-plan.js');
 const old={id:'old',text:'执行结构尚未通过校验。'},current={id:'new',result:true};
 assert.deepEqual(historicalPlanStatus(old,[old,current]),{failed:true,hasLaterPlan:true});
 assert.deepEqual(historicalPlanStatus(old,[current,old]),{failed:true,hasLaterPlan:false});
 assert.equal(historicalPlanStatus(old,[{id:'reply',text:'已整理'}]).hasLaterPlan,false);
 assert.equal(historicalPlanStatus({id:'draft',draft:true,text:'草稿'},[]).failed,false);
});
test('literal review fields preserve values, conflicts, and unrelated fields without guessed defaults',async()=>{
 const {historicalReviewFacts}=await import('../src/historical-plan.js');
 const facts=historicalReviewFacts('销售商305，基金代码123456，业务日期20261012，申请金额18.25元，申请金额20.00元，净值1.20000000，前收费0，TA账号未知时留空',['【模拟假设】净值1.20000000、前收费0']);
 assert.deepEqual(facts.filter(f=>f.label==='申请金额').map(f=>f.value),['18.25元','20.00元']);
 assert.equal(facts.find(f=>f.label==='净值').simulated,true);
 assert.equal(facts.some(f=>f.label==='TA账号'),false);
 assert.deepEqual(historicalReviewFacts('温度：37度；处理方式：人工复核'),[{label:'温度',value:'37度',simulated:false},{label:'处理方式',value:'人工复核',simulated:false}]);
 assert.deepEqual(historicalReviewFacts('未知净值1.0；例如申请金额10元；不是基金123456'),[]);
 assert.deepEqual(historicalReviewFacts('无可识别字段'),[]);
 assert.ok(historicalReviewFacts('基金123456；处理方式：人工复核').some(f=>f.label==='处理方式'&&f.value==='人工复核'));
});
