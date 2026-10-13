import test from 'node:test';
import assert from 'node:assert/strict';
import {localWorkspaceInitializer} from '../src/local-workspace-profile.js';
test('local exchange defaults cannot run against a remote host or other database',()=>{
 assert.equal(localWorkspaceInitializer({host:'db.example',database:'ta_case_agent_local'}),undefined);
 assert.equal(localWorkspaceInitializer({host:'localhost',database:'production'}),undefined);
});
test('isolated local demo needs explicit matching configuration; remote host remains disabled',()=>{
 const options={localDatabase:'ta_case_agent_chain'};
 assert.equal(localWorkspaceInitializer({host:'localhost',database:'ta_case_agent_chain'},{localDatabase:'ta_case_agent_local'}),undefined);
 assert.equal(typeof localWorkspaceInitializer({host:'localhost',database:'ta_case_agent_chain'},options),'function');
 assert.equal(typeof localWorkspaceInitializer({host:'::1',database:'ta_case_agent_chain'},options),'function');
 assert.equal(localWorkspaceInitializer({host:'::1',database:'production'},options),undefined);
 assert.equal(localWorkspaceInitializer({host:'db.example',database:'ta_case_agent_chain'},options),undefined);
 assert.equal(localWorkspaceInitializer({host:'localhost',database:'other'},options),undefined);
});
test('only the unique configured local protocol profile is installed at the new workspace',async()=>{
 const writes=[];const profile={channel_name:'本地TA',ta_environment:'LOCAL',ta_code:'27',distributor_code:'306',protocol_version:'22'};
 await localWorkspaceInitializer({host:'127.0.0.1',database:'ta_case_agent_local'})({execute:async(sql,values)=>{if(sql.startsWith('SELECT'))return [[profile]];writes.push(values);return [{insertId:8}];}},45);
 assert.deepEqual(writes,[[45,'本地TA','LOCAL','27','306','22']]);
 for(const profiles of [[],[profile,{...profile,ta_code:'28'}]]){
   let reads=0;
   await localWorkspaceInitializer({host:'localhost',database:'ta_case_agent_local'})({execute:async sql=>{assert.ok(sql.startsWith('SELECT'));reads++;return [profiles];}},45);
   assert.equal(reads,1);
 }
});
