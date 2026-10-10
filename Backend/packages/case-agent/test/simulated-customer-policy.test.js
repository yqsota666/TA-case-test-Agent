import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseDataSpecification, DataEditSchema} from '../src/data-generation.js';
import {compileApplicationIntents} from '../src/application-preparation.js';
import {isPersonalName} from '../src/simulated-customer-policy.js';
import {buildDataFile, parseDataFile, parseIndexFile} from '../../platform-protocol/src/codec.js';
import {buildDeliveryPackage} from '../../platform-protocol/src/delivery-package.js';

test('bad model labels become distinct personal names before review, valid names and institutions survive', () => {
  const names = ['模拟客户/广发227', '模拟客户A', '陈思远', '测试甲'];
  const specification = {customers: names.map(name => ({name, investorType:'1', simulatedBalance:'1000.00'})),
    accounts:[], funds:[], holdings:[], missing:[]};
  specification.customers.push({name:'广发模拟机构/227', investorType:'0', simulatedBalance:'1000.00'});
  const parsed = parseDataSpecification(JSON.stringify(specification));
  assert.ok(parsed.customers.slice(0,4).every(c => isPersonalName(c.name)));
  assert.equal(new Set(parsed.customers.slice(0,4).map(c => c.name)).size,4);
  assert.equal(parsed.customers[2].name,'陈思远');
  assert.equal(parsed.customers[4].name,'广发模拟机构/227');
  assert.deepEqual(parseDataSpecification(JSON.stringify(parsed)),parsed);
  const many=parseDataSpecification(JSON.stringify({...specification,customers:Array.from({length:50},()=>specification.customers[0])}));
  assert.equal(new Set(many.customers.map(c=>c.name)).size,50);
});

test('manual edits reject labels and malformed personal names', () => {
  const edit = name => ({revision:0,changes:{customers:[{id:null,name,investorType:'1',simulatedBalance:'1000.00',branchCode:'227'}],accounts:[],funds:[],holdings:[]}});
  for (const name of ['模拟客户_227','张三','张三李四','陈/思远','广发甲']) assert.equal(DataEditSchema.safeParse(edit(name)).success,false);
  assert.equal(DataEditSchema.safeParse(edit('林雨桐')).success,true);
});

for (const code of ['227','305','926','005']) test(`${code}: selected channel owns 01/03/X1 branch codes and the new-account link`, () => {
  const data={customers:[{id:'1',name:'陈思远',investor_type:'1'}],
    accounts:[{id:'2',customer_id:'1',account_no:'SYNACCOUNT1',branch_code:'305001'}],
    funds:[{id:'3',fund_code:'000001',share_class:'0'}],holdings:[]};
  const opening={key:'open',fileType:'01',businessCode:'001',accountId:'2',fundId:null,targetFundId:null,businessDate:'20260817',
    fields:{CertificateType:'0',CertificateNo:'SYNID1',TransactionTime:'090000'}};
  const trade={...opening,key:'buy',fileType:'03',businessCode:'022',fundId:'3',
    fields:{TransactionTime:'100000',ApplicationAmount:'1000.00',CurrencyType:'156',ChargeType:'0'}};
  const channel={id:'7',distributorCode:code,taCode:'27',protocolVersion:'22'};
  const result=compileApplicationIntents({intents:[opening,trade],data,channel,bindings:[],casePublicId:'case',unassignedTaAccounts:new Set(['2'])});
  assert.deepEqual(result.questions,[]); assert.equal(result.records.length,2);
  assert.equal(result.records[1].record.OriginalAppSheetNo,result.records[0].record.AppSheetSerialNo);
  assert.equal(result.records[1].record.TAAccountID,undefined);
  const source=result.records.map(r=>({fileName:`OFD_${code}_27_20260817_${r.fileType}.TXT`,rawBytes:buildDataFile({creator:code,receiver:'27',date:r.businessDate,version:'22',fileType:r.fileType,records:[r.record]})}));
  const zip=buildDeliveryPackage(source,{dataSequence:false});
  const dir=mkdtempSync(join(tmpdir(),'ta-customer-policy-'));
  try {
    const file=join(dir,zip.fileName);writeFileSync(file,zip.rawBytes);
    const files=JSON.parse(execFileSync('/usr/bin/python3',['-c','import zipfile,sys,json,base64;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))',file],{encoding:'utf8'}));
    const read=type=>Buffer.from(files[`${code}/20260817/OFD_${code}_27_20260817_${type}.TXT`],'base64');
    for (const type of ['01','03','X1']) {
      const record=parseDataFile(read(type)).records[0];
      assert.equal(record.BranchCode,code);assert.equal(record.DistributorCode,code);
      if (type!=='03') assert.equal(record.InvestorName,'陈思远');
    }
    assert.deepEqual(parseIndexFile(Buffer.from(files[`${code}/20260817/OFI_${code}_27_20260817.TXT`],'base64')).fileNames.slice(0,2),source.map(f=>f.fileName));
    assert.equal(data.accounts[0].branch_code,'305001');
  } finally {rmSync(dir,{recursive:true});}
});
