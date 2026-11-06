import http from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ApiError, requestPlan } from './llm.mjs';
import { publicConfig } from './config.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const JSON_LIMIT = 64 * 1024;
function json(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let length = 0;
    const chunks = [];
    const cleanup = () => { clearTimeout(timer); req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAbort); };
    const fail = (error) => { cleanup(); req.resume(); reject(error); };
    const onError = () => fail(new ApiError(400, 'INVALID_BODY', '读取请求失败。'));
    const onAbort = () => fail(new ApiError(499, 'CANCELLED', '请求已取消。'));
    const onData = (chunk) => {
      length += chunk.length;
      if (length > JSON_LIMIT) { fail(new ApiError(413, 'BODY_TOO_LARGE', '请求内容过大。')); return; }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError(400, 'INVALID_JSON', '请求不是有效 JSON。')); }
    };
    const timer = setTimeout(() => fail(new ApiError(408, 'BODY_TIMEOUT', '读取请求超时。')), 10000);
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAbort);
  });
}

export function createApp({ root, config, isDist = false, fetchImpl = fetch }) {
  const directory = path.resolve(root, isDist ? 'dist' : '.');
  let pending = false;
  const server = http.createServer(async (req, res) => {
    try {
      const allowedHosts = ['localhost', '127.0.0.1', '[::1]'].map((host) => `${host}:${req.socket.localPort}`);
      if (!allowedHosts.includes(req.headers.host)) throw new ApiError(403, 'BAD_HOST', '仅支持通过本机地址访问。');
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.startsWith('/api/')) {
        // Prevent another website from spending the locally configured API key.
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) throw new ApiError(403, 'CROSS_ORIGIN', '不允许跨站点调用。');
        if (pathname === '/api/config' && req.method === 'GET') { json(res, 200, publicConfig(config)); return; }
        if (pathname !== '/api/chat') { json(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } }); return; }
        if (req.method !== 'POST') { json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请使用 POST 请求。' } }); return; }
        if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'CONTENT_TYPE', '请求必须使用 application/json。');
        if (!config.configured) throw new ApiError(503, 'NOT_CONFIGURED', config.reason);
        if (pending) throw new ApiError(429, 'BUSY', 'MILO 正在处理一条消息，请稍后再试。');
        pending = true;
        const controller = new AbortController();
        const onClose = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', onClose);
        try {
          const body = await readJson(req);
          const plan = await requestPlan(body, config, { fetchImpl, signal: controller.signal });
          json(res, 200, plan);
        } finally { pending = false; res.off('close', onClose); }
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      if (!['/', '/index.html', '/favicon.svg'].includes(pathname) && !pathname.startsWith('/src/')) { res.writeHead(404).end('Not found'); return; }
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      let filename = path.resolve(directory, relative);
      if (!isDist && relative === 'favicon.svg') filename = path.join(directory, 'public', relative);
      if (!filename.startsWith(directory + path.sep) || relative.split(/[\\/]/).some((part) => part.startsWith('.'))) { res.writeHead(403).end(); return; }
      const info = await stat(filename);
      if (!info.isFile()) { res.writeHead(404).end(); return; }
      const contents = req.method === 'HEAD' ? undefined : await readFile(filename);
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(contents);
    } catch (error) {
      if (error instanceof ApiError) json(res, error.status, { error: { code: error.code, message: error.message } });
      else if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 400).end('Request failed');
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
