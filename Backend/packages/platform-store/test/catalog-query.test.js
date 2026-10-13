import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCatalogQuery,dataQueryFields,fileQueryFields} from '../src/catalog-query.js';
const fields=dataQueryFields('applications',new Set(['business_date','created_at','record_json','status']));
const filter=(field,operator,value)=>({filters:{combinator:'and',rules:[{field,operator,value}]}});
test('invalid fields, operators, enums, dates, decimals and excessive conditions fail closed',()=>{
  for(const input of [filter('sql','eq','x'),filter('status','contains','READY'),filter('status','eq','UNKNOWN'),filter('business_date','eq','2026-02-30'),filter('ApplicationAmount','eq','1e3'),filter('ApplicationAmount','eq','0.123456789'),filter('ApplicationAmount','eq',0.1),filter('ApplicationAmount','between',['10','2']),{filters:'invalid'},{filters:'x'.repeat(12001)},{filters:{combinator:'or',rules:[{combinator:'and',rules:[]}]}},{filters:{combinator:'and',rules:Array(41).fill({field:'status',operator:'eq',value:'READY'})}},{sort:[{field:'status',direction:'DROP'}]}])assert.throws(()=>compileCatalogQuery(input,fields),{code:'INVALID_CATALOG_QUERY'});
});
test('SQL values remain bound, literal wildcard characters are escaped, and collection rules cannot escape scope',()=>{
  const value="%_' OR 1=1";
  const query=compileCatalogQuery(filter('CertificateNo','contains',value),fields);
  assert.ok(!query.sql.includes(value));assert.equal(query.values[0],"%\\%\\_' OR 1=1%");
  const files=compileCatalogQuery(filter('caseId','in',['case-a','case-b']),fileQueryFields());
  assert.match(files.sql,/JSON_CONTAINS/);assert.deepEqual(files.values,['case-a','case-b']);
  assert.throws(()=>compileCatalogQuery({sort:[{field:'caseId',direction:'asc'}]},fileQueryFields()),{code:'INVALID_CATALOG_QUERY'});
});
test('query metadata follows actual source fields and remains available without records',()=>{
  const draft=dataQueryFields('holdings',new Set(['total_volume','fund_code']));
  assert.ok(!draft.some(f=>f.key==='available_volume'));assert.equal(draft.find(f=>f.key==='fund_code').type,'text');
  assert.ok(fields.some(f=>f.key==='ApplicationAmount'&&f.type==='decimal'));
});
test('calendar day filters follow the viewer timezone, including daylight saving boundaries',()=>{
  const input=filter('created_at','eq','2026-03-08');
  assert.deepEqual(compileCatalogQuery({...input,timeZone:'America/New_York'},fields).values,['2026-03-08 05:00:00','2026-03-09 04:00:00']);
  assert.deepEqual(compileCatalogQuery({...input,timeZone:'Asia/Shanghai'},fields).values,['2026-03-07 16:00:00','2026-03-08 16:00:00']);
  assert.throws(()=>compileCatalogQuery({...input,timeZone:'unknown'},fields),{code:'INVALID_CATALOG_QUERY'});
});
