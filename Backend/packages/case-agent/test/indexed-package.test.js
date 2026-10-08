import test from 'node:test';
import assert from 'node:assert/strict';
import {guardExchangeTimeEvidence} from '../src/plan-proposal.js';
import {definePlanContract} from '../src/plan-contract.js';
import {indexedPlan} from './indexed-package-fixture.js';
import {planContractValidationIssues,validPlanContract} from '../../platform-protocol/src/plan-contract.js';
import {dataExchangeRequirementIssues} from '../../platform-protocol/src/data-exchange-requirements.js';
import {reconcileOperations} from '../src/operation-chain-graph.js';
import {buildApplicationPackage} from '../../platform-protocol/src/application-package.js';
import {buildDataFile,dataFileName} from '../../platform-protocol/src/index.js';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('indexed packages prepare all accounts and variable operations without fabricated receipt events',()=>{
 for(const accounts of [1,2,4])for(const rounds of [1,2,4]){
  const plan=indexedPlan({accounts,rounds});
  assert.equal(validPlanContract(plan.contract,plan),true);
  assert.deepEqual(dataExchangeRequirementIssues(plan),[]);
  const schedule=reconcileOperations({plan,channelId:'7',casePublicId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  assert.equal(schedule.readyKeys.length,accounts*(rounds+1));
  assert.ok(schedule.tasks.every(t=>t.state==='READY'));
 }
});
test('package sequence rejects cycles, cross-account openings, other dates and receipt waits',()=>{
 for(const change of [p=>p.contract.applications[2].dependsOn=[{applicationKey:'open_1',condition:'ORDERED'}],p=>p.contract.applications[0].dependsOn=[{applicationKey:'trade_0_0',condition:'ORDERED'}],p=>p.exchangePlan.steps[1].businessTime.value='20261009',p=>p.exchangePlan.steps[1].dependsOn=[{stepId:'opened',condition:'PARSED'}]]){
  const plan=indexedPlan();change(plan);assert.equal(validPlanContract(plan.contract,plan),false);
 }
});
test('ZIP has ordered OFI and untouched data bytes; dates and checksum mismatches are refused',()=>{
 const options={creator:'306',receiver:'27',date:'20261008',version:'22'};
 const files=['03','01'].map(fileType=>({fileName:dataFileName({...options,fileType}),rawBytes:buildDataFile({...options,fileType,records:[]})}));
 const result=buildApplicationPackage(files);
 const directory=mkdtempSync(join(tmpdir(),'ta-package-'));
 try{
  const path=join(directory,'test.zip');writeFileSync(path,result.rawBytes);
  const check=execFileSync('/usr/bin/python3',['-c',`import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps(z.namelist()));print(z.read(z.namelist()[0]).decode('gb18030'))`,path],{encoding:'utf8'});
  assert.match(check,/OFI_306_27_20261008.TXT/);
  assert.ok(check.indexOf('20261008_01.TXT')<check.indexOf('20261008_03.TXT'));
  for(const file of files){const bytes=execFileSync('/usr/bin/python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',path,file.fileName]);assert.deepEqual(bytes,file.rawBytes);}
 }finally{rmSync(directory,{recursive:true});}
 assert.throws(()=>buildApplicationPackage([{...files[0],sha256:'bad'}]),/校验失败/);
 assert.throws(()=>buildApplicationPackage([{...files[0],fileName:'OFD_999_27_20261008_03.TXT'}]),/文件名/);
 assert.throws(()=>buildApplicationPackage([files[0],{...files[1],fileName:dataFileName({...options,date:'20261009',fileType:'01'}),rawBytes:buildDataFile({...options,date:'20261009',fileType:'01',records:[]})}]),/不同机构/);
});

test('repair diagnostics reject unknown step references without crashing',()=>{
 const p=indexedPlan();p.contract.applications[0].stepId='invented';
 assert.equal(validPlanContract(p.contract,p),false);
 assert.ok(planContractValidationIssues(p.contract,p).some(i=>i.includes('发送步骤')));
});

test('fenced model output still validates content and repairs system fields and step references',async()=>{
 const p=indexedPlan({accounts:1,rounds:1}),{assumptions,applications,expectations,missing}=p.contract;
 const derived={assumptions,applications,expectations,missing},bad=structuredClone(derived);
 bad.applications[1].stepId='unknown';bad.applications[1].fields.ShareClass='0';
 let calls=0,issues;
 const result=await definePlanContract(async request=>{
  if(++calls===1)return '```json\n'+JSON.stringify(bad)+'\n```';
  issues=JSON.parse(request.user).validationIssues;return JSON.stringify(derived);
 },p,[],p.contract.dataSpecification);
 assert.equal(calls,2);assert.ok(issues.some(i=>i.includes('发送步骤')));assert.equal(result.contract.version,4);assert.deepEqual(result.contract.missing,[]);
});

test('original opening references do not cancel agreed application business dates',()=>{
 const p=indexedPlan();const message='01申请业务日期20261008，03申请业务日期20261008，02接收业务日期20261008，04接收业务日期20261008。每笔申请单号独立由系统生成；03用原申请日期和原申请单号引用01。';
 assert.equal(guardExchangeTimeEvidence(p,[message]).exchangePlan.status,'READY');
 assert.equal(guardExchangeTimeEvidence(p,[message,'01时间090000、03时间100000，申请20261008，02/04接收20261008。03用原申请日期和原申请单号引用01。']).exchangePlan.status,'READY');
 assert.equal(guardExchangeTimeEvidence(p,[message,'03业务日期不要用20261008，日期待定']).exchangePlan.status,'UNPLANNED');
});
