export async function handleGlobalDataCatalog(request,response,token,catalog,body){
 const url=new URL(request.url,'http://localhost');
 const match=/^\/api\/data\/tables\/([a-z]+)(\/search)?$/.exec(url.pathname);
 if(!match||!(request.method==='GET'&&!match[2]||request.method==='POST'&&match[2]))return false;
 const input=body===undefined?Object.fromEntries(url.searchParams):body;
 const value=await catalog.listTable(token,{...input,table:match[1]});
 response.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(value));return true;
}
