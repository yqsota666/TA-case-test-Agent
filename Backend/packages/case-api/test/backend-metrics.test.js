import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {OTLPMetricExporter} from '@opentelemetry/exporter-metrics-otlp-http';
import {InMemoryMetricExporter,AggregationTemporality,PeriodicExportingMetricReader} from '@opentelemetry/sdk-metrics';
import {createBackendMetrics,createMeasuredTransaction,metricRequestAttributes,initializeBackendMetrics} from '../src/backend-metrics.js';

function fixture(t){
  const exporter=new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader=new PeriodicExportingMetricReader({exporter,exportIntervalMillis:60000});
  const metrics=createBackendMetrics({reader});t.after(()=>metrics.shutdown());
  const collect=async()=>{
    await metrics.provider.forceFlush();
    return exporter.getMetrics().at(-1).scopeMetrics.flatMap(scope=>scope.metrics);
  };
  return {metrics,collect};
}
const find=(data,name)=>data.find(metric=>metric.descriptor.name===name);
function response(statusCode=200){return Object.assign(new EventEmitter(),{statusCode,writableFinished:false});}

test('success queries count without traces, failures and disconnected clients stay distinct; labels contain no IDs or body',async t=>{
  const {metrics,collect}=fixture(t);
  const id='11111111-1111-1111-1111-111111111111';
  const request={method:'GET',url:`/api/chats/${id}/cases?token=PRIVATE`,headers:{cookie:'PRIVATE'},body:'PRIVATE'};
  for(const code of [200,200,503]){
    const res=response(code);metrics.http(request,res);res.writableFinished=true;res.emit('finish');res.emit('close');
  }
  const disconnected=response();metrics.http(request,disconnected);disconnected.emit('close');
  const data=await collect();
  assert.equal(find(data,'case_http_requests').dataPoints.reduce((sum,p)=>sum+p.value,0),3);
  assert.equal(find(data,'case_http_duration').dataPoints[0].value.count,3);
  assert.equal(find(data,'case_http_failures').dataPoints[0].attributes.status_class,'5xx');
  assert.equal(find(data,'case_http_aborted').dataPoints[0].value,1);
  assert.equal(find(data,'case_http_in_flight').dataPoints[0].value,0);
  assert.ok(!JSON.stringify(data).includes(id));assert.ok(!JSON.stringify(data).includes('PRIVATE'));
  const unknown=Array.from({length:1000},(_,i)=>metricRequestAttributes({method:'CUSTOM'+i,url:'/api/'+i}));
  assert.equal(new Set(unknown.map(JSON.stringify)).size,1);
});

test('transactions preserve results and errors, release connections, and measure acquire/rollback failures',async t=>{
  const {metrics,collect}=fixture(t);let released=0,rollback=0;
  const connection={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rollback++;},release:()=>released++};
  const transact=createMeasuredTransaction({getConnection:async()=>connection},{metrics:()=>metrics});
  assert.equal(await transact(async()=>42),42);
  const original=Object.assign(new Error('PRIVATE'),{code:'ER_LOCK_DEADLOCK'});
  await assert.rejects(transact(async()=>{throw original;}),error=>error===original);
  assert.equal(released,2);assert.equal(rollback,1);
  const unavailable=createMeasuredTransaction({getConnection:async()=>{throw original;}},{metrics:()=>metrics});
  await assert.rejects(unavailable(async()=>42),error=>error===original);
  const data=await collect();
  assert.deepEqual(find(data,'case_db_transactions').dataPoints.map(p=>[p.attributes.outcome,p.value]),[['committed',1],['failed',1]]);
  assert.equal(find(data,'case_db_acquire_duration').dataPoints[0].value.count,3);
  assert.equal(find(data,'case_db_errors').dataPoints[0].attributes.stage,'acquire');
  assert.ok(!JSON.stringify(data).includes('PRIVATE'));
});

test('export failures are isolated and counted; recovered export reports prior failures',async t=>{
  let failed=true;const payloads=[];
  const exporter={export(data,callback){payloads.push(data);callback(failed?{code:1,error:new Error('PRIVATE') }:{code:0});},forceFlush:async()=>{},shutdown:async()=>{}};
  const metrics=createBackendMetrics({exporter});t.after(()=>metrics.shutdown());
  const res=response();metrics.http({method:'GET',url:'/api/chats'},res);res.writableFinished=true;res.emit('finish');
  await metrics.provider.forceFlush().catch(()=>{});failed=false;await metrics.provider.forceFlush();
  const data=payloads.at(-1).scopeMetrics.flatMap(scope=>scope.metrics);
  assert.equal(find(data,'case_http_requests').dataPoints[0].value,1);
  assert.equal(find(data,'case_metrics_exports').dataPoints.find(p=>p.attributes.outcome==='failure').value,1);
});

test('metrics remain opt-in and invalid cloud configuration does not disclose credentials',()=>{
  assert.doesNotThrow(()=>initializeBackendMetrics({}));
  assert.throws(()=>initializeBackendMetrics({CASE_METRICS_ENABLED:'1',CASE_METRICS_ENDPOINT:'http://evil.example/PRIVATE',CASE_METRICS_AUTHORIZATION:'PRIVATE'}),/METRICS_CONFIGURATION_INVALID/);
});

test('real OTLP HTTP export batches requests into cumulative metrics',async t=>{
  const payloads=[];
  const collector=createServer(async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    payloads.push({url:request.url,data:JSON.parse(body)});
    response.setHeader('Content-Type','application/json');response.end('{}');
  });
  await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>collector.close(resolve)));
  const metrics=createBackendMetrics({exporter:new OTLPMetricExporter({url:`http://127.0.0.1:${collector.address().port}/v1/metrics`})});
  t.after(()=>metrics.shutdown());
  for(let i=0;i<3;i++){
    const res=response();metrics.http({method:'GET',url:'/api/chats'},res);res.writableFinished=true;res.emit('finish');
  }
  await metrics.provider.forceFlush();
  assert.equal(payloads.length,1);assert.equal(payloads[0].url,'/v1/metrics');
  const data=payloads[0].data.resourceMetrics[0].scopeMetrics[0].metrics;
  assert.equal(Number(data.find(metric=>metric.name==='case_http_requests').sum.dataPoints[0].asDouble),3);
  assert.equal(data.find(metric=>metric.name==='case_http_duration').unit,'s');
});
