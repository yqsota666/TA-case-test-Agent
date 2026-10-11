import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogFixture} from './catalog-query-fixture.js';
const rule=(field,operator,value)=>({field,operator,value});
const group=(...rules)=>({combinator:'and',rules});

test('MySQL catalog conditions, decimal/date boundaries, pagination, provenance and workspace isolation',{skip:process.env.CASE_CATALOG_MYSQL!=='1'},async()=>{
  const f=await catalogFixture();
  try {
    const read=(table,input={})=>f.data.listTable(f.token,{table,...input});
    for(const table of ['customers','accounts','funds','holdings','applications','distributors'])for(const source of ['draft','formal']) {
      const result=await read(table,{source});assert.ok(result.queryFields.length);assert.ok(result.columns.length);assert.ok(!result.columns.some(c=>c.key==='_rowKey'));
    }
    const page1=await read('customers',{sort:[{field:'simulated_balance',direction:'asc'}]});
    const page2=await read('customers',{sort:[{field:'simulated_balance',direction:'asc'}],offset:100});
    assert.equal(page1.total,125);assert.equal(page2.rows.length,25);assert.equal(page2.rows[0].simulated_balance,'100.01');
    assert.equal(new Set([...page1.rows,...page2.rows].map(row=>row._rowKey)).size,125);
    assert.equal((await read('customers',{q:'%_'})).total,1);
    assert.equal((await read('customers',{filters:group(rule('simulated_balance','eq','0'))})).total,1);
    assert.equal((await read('customers',{filters:group(rule('simulated_balance','empty'))})).total,0);
    const decimals=await read('applications',{filters:group(rule('ApplicationAmount','between',['10.00','100.00'])),sort:[{field:'ApplicationAmount',direction:'asc'}]});
    assert.deepEqual(decimals.rows.map(row=>row.ApplicationAmount),['10.01','100.00']);
    assert.equal((await read('applications',{filters:group(rule('created_at','eq','2026-08-17'))})).total,2);
    assert.equal((await read('applications',{filters:group(rule('created_at','gt','2026-08-17'))})).total,1);
    assert.equal((await read('applications',{filters:group(rule('business_date','between',['2026-08-17','2026-08-17']))})).total,3);
    assert.equal((await read('applications',{filters:group(rule('TransactionAccountID','eq','00000000000000001'))})).total,2);
    assert.equal((await read('applications',{filters:group(rule('CertificateNo','empty'))})).total,2);
    assert.equal((await read('applications',{filters:group(rule('CertificateNo','notEmpty'))})).total,1);
    assert.equal((await read('applications',{filters:group({combinator:'or',rules:[rule('ApplicationAmount','lt','10'),rule('ApplicationAmount','gt','99')]},rule('DistributorCode','eq','009'))})).total,2);
    const candidates=await read('customers',{optionsField:'project'});assert.equal(candidates.options[0].count,125);
    for(const item of f.cases) {
      const files=await f.files.listFiles(f.token,{filters:group(rule('caseId','eq',item.publicId),rule('direction','eq','OUTBOUND'))});
      assert.equal(files.total,1);assert.equal(files.files[0].fileName,'OFD_QUERY.TXT');
      assert.ok(files.files[0].caseTitle.includes('合成查询1')&&files.files[0].caseTitle.includes('合成查询2'));
    }
    const returns=await f.files.listFiles(f.token,{filters:group(rule('direction','eq','INBOUND'),rule('distributorCode','eq','009'),rule('businessDate','eq','2026-08-18'))});
    assert.equal(returns.total,1);assert.equal(returns.files[0].channelName,'合成通道');
    assert.equal((await f.files.listFiles(f.token,{filters:group(rule('caseTitle','eq','合成查询1'))})).total,2);
    assert.equal((await f.files.listFiles(f.token,{filters:group(rule('caseTitle','notContains','查询1'))})).total,0);
    const fileOptions=await f.files.listFiles(f.token,{optionsField:'caseTitle'});
    assert.deepEqual(fileOptions.options.map(option=>option.count),[2,1]);
    assert.equal((await f.data.listTable(f.foreign,{table:'customers'})).total,0);
    assert.equal((await f.files.listFiles(f.foreign,{filters:group({combinator:'or',rules:f.cases.map(item=>rule('caseId','eq',item.publicId))})})).total,0);
    await f.db.execute("UPDATE applications SET record_json=JSON_SET(record_json,'$.ApplicationAmount','99999999999999.99') WHERE workspace_id=(SELECT workspace_id FROM cases WHERE public_id=?) AND app_no='QUERY2'",[f.cases[0].publicId]);
    assert.equal((await read('applications',{filters:group(rule('ApplicationAmount','eq','99999999999999.98'))})).total,0);
    assert.equal((await read('applications',{filters:group(rule('ApplicationAmount','eq','99999999999999.99'))})).total,1);
  }finally{await f.close();}
});
