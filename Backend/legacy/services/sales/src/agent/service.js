import { createAgentStore } from './store.js';
import { createEventService } from './events.js';
import { createLeaseService } from './leases.js';
import { createAgentRunner } from './runner.js';

export function createAgentService({transaction,model,modelId,timeoutMs,generate,checkpointer}) {
  const store=createAgentStore({transaction}),events=createEventService(store),leases=createLeaseService({transaction});
  const runner=createAgentRunner({transaction,leases,model,modelId,timeoutMs,generate,checkpointer});
  async function processOne(ids) {
    const event=await leases.claim(ids);
    return event?runner.run(event):null;
  }
  return {state:store.state,message:events.enqueue,
    resume:(token,ids,body)=>events.enqueue(token,ids,body,{resume:true}),
    onReturns:events.onReturns,onDelivery:events.onDelivery,onRetry:events.onRetry,processOne,leases};
}

export function startAgentWorker(agent,{intervalMs=1000,onError=()=>{}}={}) {
  let stopped=false,timer,active;
  async function tick() {
    try {active=agent.processOne();await active;}
    catch(error) {onError({code:error.code||'WORKER_ERROR'});}
    finally {active=null;if(!stopped)timer=setTimeout(tick,intervalMs);}
  }
  timer=setTimeout(tick,0);
  return {async stop(){stopped=true;clearTimeout(timer);if(active)await active;}};
}
