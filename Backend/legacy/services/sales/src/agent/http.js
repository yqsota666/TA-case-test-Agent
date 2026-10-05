export function mountAgentRoutes(app,{agent,token,wrap,base}) {
  app.get(`${base}/agent`,wrap(async(req,res)=>res.json(await agent.state(token(req),req.params))));
  app.post(`${base}/agent/messages`,wrap(async(req,res)=>res.status(202).json(await agent.message(token(req),req.params,req.body))));
  app.post(`${base}/agent/resume`,wrap(async(req,res)=>res.status(202).json(await agent.resume(token(req),req.params,req.body))));
}
