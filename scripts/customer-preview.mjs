import http from 'node:http';
import {createReadStream, promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../customer-app/build/web/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'};
http.createServer(async(request,response)=>{
  const pathname=new URL(request.url||'/','http://127.0.0.1:3004').pathname;
  if(pathname.startsWith('/api/')) {
    const upstream=http.request({hostname:'127.0.0.1',port:8002,path:request.url,method:request.method,headers:{...request.headers,host:'127.0.0.1:8002'}},result=>{
      response.writeHead(result.statusCode||502,result.headers);result.pipe(response);
    });
    upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502,{'content-type':'text/plain'});response.end('API unavailable');});
    request.pipe(upstream);return;
  }
  try {
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));
    if(file!==path.resolve(root)&&!file.startsWith(path.resolve(root)+path.sep))throw new Error('Invalid path');
    const stat=await fs.stat(file).catch(()=>null);
    const selected=stat?.isFile()?file:path.join(root,'index.html');
    await fs.access(selected);
    response.writeHead(200,{'content-type':types[path.extname(selected)]||'application/octet-stream','cache-control':'no-store'});
    createReadStream(selected).on('error',()=>response.destroy()).pipe(response);
  } catch {
    response.writeHead(404,{'content-type':'text/plain; charset=utf-8'});response.end('Customer assets unavailable');
  }
}).listen(3004,'127.0.0.1',()=>console.log('Customer preview http://127.0.0.1:3004/ (existing web assets, API proxy :8002)'));
