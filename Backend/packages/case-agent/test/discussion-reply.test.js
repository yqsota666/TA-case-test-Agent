import assert from 'node:assert/strict';
import test from 'node:test';
import {checkDiscussionReply,completeDiscussionReply} from '../src/discussion-reply.js';
test('normal conversation accepts headings, short next steps and preserved comparisons',()=>{
 for(const text of ['下一步：打开方案，检查准备数据。','## 下一步\n- 核对方案\n- 确认准备数据','份额<100时检查边界，金额>=100时继续。']) assert.equal(checkDiscussionReply(text),text);
});
test('persisted proposal can be mentioned without claiming execution',()=>{
 assert.throws(()=>checkDiscussionReply('测试方案已生成，请先审阅准备数据。'),{validationReason:'UNVERIFIED_ACTION'});
 assert.equal(checkDiscussionReply('测试方案已生成，请先审阅准备数据。',{planAvailable:true}),'测试方案已生成，请先审阅准备数据。');
 for(const text of ['方案已执行，结果通过。','我已生成并提交01和03文件。']) assert.throws(()=>checkDiscussionReply(text,{planAvailable:true}),{validationReason:'UNVERIFIED_ACTION'});
});
test('one bounded repair preserves original request and advances only with valid content',async()=>{
 const calls=[];const request={system:'只讨论，不执行。',messages:[{role:'user',content:'下一步是什么？'}]};
 const result=await completeDiscussionReply(async r=>{calls.push(r);return calls.length===1?'我已执行所有测试。':'下一步：先审阅准备数据。';},request);
 assert.equal(result,'下一步：先审阅准备数据。');assert.equal(calls.length,2);assert.deepEqual(calls[1].messages,request.messages);
 let attempts=0;await assert.rejects(completeDiscussionReply(async()=>{attempts++;return '<script>bad</script>';},request),{validationReason:'UNSAFE_MARKUP'});assert.equal(attempts,2);
});
test('provider errors are not silently treated as format errors',async()=>{
 let count=0;await assert.rejects(completeDiscussionReply(async()=>{count++;throw Object.assign(new Error('timeout'),{code:'MODEL_TIMEOUT'});},{system:'test',user:'test'}),{code:'MODEL_TIMEOUT'});assert.equal(count,1);
});

test('empty provider response is repaired once without advancing an empty turn',async()=>{
 let count=0;const reply=await completeDiscussionReply(async()=>{if(++count===1)throw Object.assign(new Error('empty'),{code:'MODEL_EMPTY_OUTPUT'});return '下一步：先检查共同条件。';},{system:'test',user:'test'});
 assert.equal(count,2);assert.equal(reply,'下一步：先检查共同条件。');
});
