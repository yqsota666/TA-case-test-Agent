import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
const port=Number(process.env.FRONTEND_PORT||5194);
const api=process.env.CASE_API_TARGET||'http://127.0.0.1:3103';
export default defineConfig({plugins:[react()],server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/live-api':{target:api,changeOrigin:true,rewrite:path=>path.replace(/^\/live-api/,'/api'),configure(proxy){proxy.on('proxyReq',(request,incoming)=>{if([`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(incoming.headers.origin))request.setHeader('origin',api);});}}}}});
