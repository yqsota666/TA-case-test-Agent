import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/new-api': { target: 'http://127.0.0.1:3102', changeOrigin: true,
    rewrite:path=>path.replace(/^\/new-api/,'/api'),
    configure(proxy) { proxy.on('proxyReq', request=>{
      request.setHeader('origin','http://127.0.0.1:3102');
      if(process.env.CASE_TEST_SESSION)request.setHeader('cookie',`case_session=${process.env.CASE_TEST_SESSION}`);
    }); },
  }, '/api': { target: 'http://127.0.0.1:8084', changeOrigin: true,
    configure(proxy) { proxy.on('proxyReq', request => request.setHeader('origin', 'http://127.0.0.1:8084')); },
  } } },
});
