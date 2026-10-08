export async function handleGlobalDataCatalog(request,response,token,catalog){
 const url=new URL(request.url,'http://localhost');
 const match=/^\/api\/data\/tables\/([a-z]+)$/.exec(url.pathname);
 if(!match||request.method!=='GET')return false;
 const value=await catalog.listTable(token,{table:match[1],source:url.searchParams.get('source')??undefined,q:url.searchParams.get('q')??undefined,offset:url.searchParams.get('offset')??undefined,limit:url.searchParams.get('limit')??undefined});
 response.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(value));return true;
}
