import test from 'node:test';
import assert from 'node:assert/strict';
import {planArtifactMeta} from '../src/chat-artifact-state.js';
test('artifact metadata reflects saved approvals without inventing execution',()=>{
 assert.equal(planArtifactMeta({status:'DRAFT'}),'还需完善条件');
 assert.equal(planArtifactMeta({status:'PENDING_CONFIRMATION',confirmations:[]}),'待确认准备数据');
 assert.equal(planArtifactMeta({status:'PENDING_CONFIRMATION',confirmations:[{section:'DATA'}]}),'待确认预期结果');
 assert.equal(planArtifactMeta({status:'LOCKED'},{stage:'PREPARE_DATA'}),'数据待准备');
 assert.equal(planArtifactMeta({status:'LOCKED'},{stage:'FILE_EXCHANGE'}),'已确认');
});
