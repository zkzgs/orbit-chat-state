'use strict';

const http = require('node:http');
const https = require('node:https');

const host = '127.0.0.1';
const port = Number(process.env.ORBIT_PROXY_PORT || process.argv[2] || 8787);
const requestTimeout = 10 * 60 * 1000;
const targetHeader = 'x-orbit-target-url';
const blockedRequestHeaders = new Set([
  'host',
  'connection',
  'proxy-connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'origin',
  'referer',
  targetHeader
]);
const blockedResponseHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers'
]);

function isAllowedOrigin(origin) {
  if (!origin || origin === 'null') return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  } catch (error) {
    return false;
  }
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  response.setHeader('Access-Control-Allow-Origin', origin || '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] || 'Authorization, Content-Type, X-Orbit-Target-Url');
  response.setHeader('Access-Control-Expose-Headers', '*');
  response.setHeader('Vary', 'Origin');
}

function sendJson(request, response, status, payload) {
  setCorsHeaders(request, response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function getTargetUrl(request) {
  const value = request.headers[targetHeader];
  if (!value || Array.isArray(value)) throw new Error('缺少目标接口地址');
  const target = new URL(value);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('目标接口只支持 HTTP 或 HTTPS');
  return target;
}

function getForwardHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blockedRequestHeaders.has(name) && !name.startsWith('sec-')));
}

function forwardRequest(request, response) {
  let target;
  try {
    target = getTargetUrl(request);
  } catch (error) {
    sendJson(request, response, 400, { error: { message: error.message } });
    return;
  }

  const transport = target.protocol === 'https:' ? https : http;
  const startedAt = Date.now();
  const upstreamRequest = transport.request(target, {
    method: request.method,
    headers: getForwardHeaders(request.headers)
  }, (upstreamResponse) => {
    Object.entries(upstreamResponse.headers).forEach(([name, value]) => {
      if (!blockedResponseHeaders.has(name) && value !== undefined) response.setHeader(name, value);
    });
    setCorsHeaders(request, response);
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.statusMessage || '');
    upstreamResponse.pipe(response);
    upstreamResponse.on('end', () => {
      console.log(`${request.method} ${target.origin}${target.pathname} -> ${upstreamResponse.statusCode} (${Date.now() - startedAt}ms)`);
    });
  });

  upstreamRequest.setTimeout(requestTimeout, () => upstreamRequest.destroy(new Error('上游请求超时')));
  upstreamRequest.on('error', (error) => {
    if (response.headersSent) response.destroy(error);
    else sendJson(request, response, 502, { error: { message: error.message || '上游请求失败' } });
  });
  request.on('aborted', () => upstreamRequest.destroy());
  request.pipe(upstreamRequest);
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Invalid proxy port');
  process.exit(1);
}

const server = http.createServer((request, response) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    sendJson(request, response, 403, { error: { message: '只允许本机页面访问代理' } });
    return;
  }
  if (request.method === 'OPTIONS') {
    setCorsHeaders(request, response);
    response.writeHead(204);
    response.end();
    return;
  }
  const pathname = new URL(request.url, `http://${host}:${port}`).pathname;
  if (request.method === 'GET' && pathname === '/health') {
    sendJson(request, response, 200, { ok: true, service: 'orbit-api-proxy', version: 1 });
    return;
  }
  if (pathname === '/proxy') {
    forwardRequest(request, response);
    return;
  }
  sendJson(request, response, 404, { error: { message: '未找到代理路由' } });
});

server.requestTimeout = 0;
server.headersTimeout = 60 * 1000;
server.listen(port, host, () => {
  console.log(`Orbit API Proxy: http://${host}:${port}`);
  console.log('Keep this window open while using the proxy. Press Ctrl+C to stop.');
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : error.message);
  process.exit(1);
});
