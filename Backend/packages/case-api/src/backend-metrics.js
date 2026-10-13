import {MeterProvider,PeriodicExportingMetricReader,AggregationType,InstrumentType} from '@opentelemetry/sdk-metrics';
import {OTLPMetricExporter} from '@opentelemetry/exporter-metrics-otlp-http';
import {resourceFromAttributes} from '@opentelemetry/resources';
import {requestObservationContext} from '../../case-agent/src/observability.js';

let active;
const methods=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const routes=new Set([
  '/api/chats','/api/chats/:id/cases','/api/chats/:id/lifecycle',
  ...['close','retest','new-run'].map(action=>`/api/chats/:id/lifecycle/${action}`),
  ...['discussion','discussion/cancel','plan','plan/data','plan/content','plan/confirm','data','data/execute','data/review','data/confirm','application-preparation','applications','ta-bindings','exchange-plan/confirm','return-confirmation','return-confirmation/delivery','return-confirmation/apply','return-confirmation/account','workflow','workflow/resume','result-review','result-review/evaluate','result-review/confirm','result-review/business-output','ta-receipts','ta-receipts/parse','holdings-return','return-parsing'].map(action=>`/api/chats/:id/cases/:id/${action}`),
  ...['files','files/:id','batches','batches/:id/generate'].map(action=>`/api/chats/:id/${action}`),
  ...['me','login','logout','register','demo','password','avatar'].map(action=>`/api/auth/${action}`),
  '/api/account/model-usage','/api/exchange/channels',
  '/api/exchange/channels/:id/ta-reset','/api/exchange/channels/:id/ta-reset/confirm',
]);
const errorCategory=code=>{
  if(['UNAUTHENTICATED','FORBIDDEN'].includes(code))return 'auth';
  if(['MODEL_BUDGET_EXHAUSTED','MODEL_RUN_LIMIT'].includes(code))return 'budget';
  if(['WORKFLOW_BUSY','REVIEW_SUPERSEDED','DATA_EDIT_CONFLICT','BUSINESS_OUTPUT_CONFLICT'].includes(code))return 'conflict';
  if(['MODEL_OUTPUT_FORMAT','MODEL_EMPTY_OUTPUT','INVALID_PLAN_CONTRACT'].includes(code))return 'model_output';
  if(['TA_ACCOUNT_CONFLICT','DATA_EDIT_CONSTRAINT','DATA_EXCHANGE_REQUIRED'].includes(code))return 'data_consistency';
  return 'other';
};

export function metricRequestAttributes(request){
  const route=requestObservationContext(request).metadata.route;
  return {method:methods.has(request.method)?request.method:'OTHER',route:routes.has(route)?route:'/other'};
}

export function createBackendMetrics({reader,exporter,environment='local',instance='local-api',interval=60000}={}){
  const upload={success:0,failure:0,lastSuccess:0};
  if(!reader){
    const guarded=new Proxy(exporter,{get(target,key){
      if(key==='export')return (data,callback)=>target.export(data,result=>{
        if(result.code===0){upload.success++;upload.lastSuccess=Date.now()/1000;}
        else upload.failure++;
        callback(result.code===0?result:{code:result.code,error:new Error('METRICS_EXPORT_FAILED')});
      });
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    reader=new PeriodicExportingMetricReader({exporter:guarded,exportIntervalMillis:interval,exportTimeoutMillis:3000});
  }
  const provider=new MeterProvider({resource:resourceFromAttributes({'service.name':'ta-case-api','service.instance.id':instance,'deployment.environment.name':environment}),readers:[reader],
    views:[{instrumentType:InstrumentType.HISTOGRAM,aggregation:{type:AggregationType.EXPLICIT_BUCKET_HISTOGRAM,options:{boundaries:[.01,.05,.1,.5,1,5,30,120]}},aggregationCardinalityLimit:100},
      {instrumentType:InstrumentType.COUNTER,aggregationCardinalityLimit:300}]});
  const meter=provider.getMeter('ta-case-backend');
  const requests=meter.createCounter('case_http_requests');
  const duration=meter.createHistogram('case_http_duration',{unit:'s'});
  const aborted=meter.createCounter('case_http_aborted');
  const failures=meter.createCounter('case_http_failures');
  const transactions=meter.createCounter('case_db_transactions');
  const dbDuration=meter.createHistogram('case_db_transaction_duration',{unit:'s'});
  const acquire=meter.createHistogram('case_db_acquire_duration',{unit:'s'});
  const dbErrors=meter.createCounter('case_db_errors');
  let inFlight=0;
  meter.createObservableGauge('case_http_in_flight').addCallback(result=>result.observe(inFlight));
  meter.createObservableGauge('case_process_memory',{unit:'By'}).addCallback(result=>{
    const memory=process.memoryUsage();for(const type of ['rss','heapUsed','heapTotal'])result.observe(memory[type],{type});
  });
  meter.createObservableGauge('case_process_uptime',{unit:'s'}).addCallback(result=>result.observe(process.uptime()));
  meter.createObservableCounter('case_process_cpu',{unit:'s'}).addCallback(result=>{
    const cpu=process.cpuUsage();for(const type of ['user','system'])result.observe(cpu[type]/1e6,{type});
  });
  meter.createObservableCounter('case_metrics_exports').addCallback(result=>{
    result.observe(upload.success,{outcome:'success'});result.observe(upload.failure,{outcome:'failure'});
  });
  meter.createObservableGauge('case_metrics_last_success',{unit:'s'}).addCallback(result=>result.observe(upload.lastSuccess));
  return {
    provider,
    http(request,response){
      const attributes=metricRequestAttributes(request),start=performance.now();inFlight++;
      let done=false;
      const finish=()=>{
        if(done)return;done=true;inFlight--;
        response.off('finish',finish);response.off('close',finish);
        if(!response.writableFinished){aborted.add(1,attributes);return;}
        const statusClass=`${Math.floor(response.statusCode/100)}xx`;
        requests.add(1,{...attributes,status_class:statusClass});
        duration.record((performance.now()-start)/1000,attributes);
        if(response.statusCode>=400)failures.add(1,{...attributes,status_class:statusClass,category:errorCategory(response.observationError)});
      };
      response.once('finish',finish);response.once('close',finish);
    },
    acquire(seconds){acquire.record(seconds);},
    transaction(outcome,seconds){transactions.add(1,{outcome});dbDuration.record(seconds,{outcome});},
    dbError(stage){dbErrors.add(1,{stage});},
    shutdown:()=>provider.shutdown(),
  };
}

export function initializeBackendMetrics(env=process.env){
  if(active||env.CASE_METRICS_ENABLED!=='1')return;
  let url;
  try{url=new URL(env.CASE_METRICS_ENDPOINT);}catch{throw new Error('METRICS_CONFIGURATION_REQUIRED');}
  if(url.protocol!=='https:'||!url.hostname.endsWith('.grafana.net')||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/v1/metrics')||!/^Basic [A-Za-z0-9+/]+=*$/.test(env.CASE_METRICS_AUTHORIZATION??''))throw new Error('METRICS_CONFIGURATION_INVALID');
  active=createBackendMetrics({exporter:new OTLPMetricExporter({url:url.toString(),headers:{Authorization:env.CASE_METRICS_AUTHORIZATION},timeoutMillis:2000}),environment:env.CASE_METRICS_ENVIRONMENT||'local',instance:env.CASE_METRICS_INSTANCE||'local-api'});
}

export function observeHttpMetrics(request,response,action){active?.http(request,response);return action();}
export async function shutdownBackendMetrics(){await active?.shutdown();active=undefined;}

export function createMeasuredTransaction(pool,{metrics=()=>active}={}){
  return async action=>{
    const start=performance.now();let connection;
    try{connection=await pool.getConnection();}
    catch(error){metrics()?.dbError('acquire');throw error;}
    finally{metrics()?.acquire((performance.now()-start)/1000);}
    try{
      await connection.beginTransaction();const result=await action(connection);await connection.commit();
      metrics()?.transaction('committed',(performance.now()-start)/1000);return result;
    }catch(error){
      metrics()?.transaction('failed',(performance.now()-start)/1000);
      try{await connection.rollback();}
      catch{metrics()?.dbError('rollback');console.error('数据库回滚失败');}
      throw error;
    }finally{connection.release();}
  };
}
