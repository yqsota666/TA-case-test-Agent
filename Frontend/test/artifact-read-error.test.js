import test from 'node:test';
import assert from 'node:assert/strict';
import {artifactReadError} from '../src/artifact-read-error.js';

test('read failures provide a retry message while preserving business reasons',()=>{
  assert.equal(artifactReadError(new SyntaxError('Unexpected end of JSON input'),'结果'),'结果读取失败，请重新尝试。');
  assert.equal(artifactReadError(new TypeError('Failed to fetch'),'文件'),'文件读取失败，请重新尝试。');
  assert.equal(artifactReadError(new Error('当前账户无权查看该 Case'),'结果'),'当前账户无权查看该 Case');
  assert.equal(artifactReadError(null,'文件'),'文件读取失败，请重新尝试。');
});
