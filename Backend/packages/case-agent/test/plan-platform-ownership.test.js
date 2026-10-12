import test from 'node:test';
import assert from 'node:assert/strict';
import {planPlatformOwnershipIssues} from '../src/plan-platform-ownership.js';

const proposal=action=>({scenarios:[{setup:'准备开户与交易申请',action,expected:'核对确认结果',evidence:'回传文件'}]});
test('TA opening cannot create the platform transaction account, even when a precondition says otherwise',()=>{
  assert.equal(planPlatformOwnershipIssues({...proposal('TA按文件顺序先处理开户申请生成交易账号，再处理交易申请'),preconditions:['平台先生成交易账号']}).length,1);
});
test('platform ownership, negative statements and unrelated business cases remain valid',()=>{
  for(const action of ['平台在构造申请包前生成交易账号；TA处理开户申请并返回TA账号', 'TA处理开户申请，不生成交易账号', 'TA先处理开户申请，使用平台生成交易账号', '比较两种订单状态'])assert.deepEqual(planPlatformOwnershipIssues(proposal(action)),[]);
});
