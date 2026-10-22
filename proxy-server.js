'use strict';

const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { execFileSync } = require('node:child_process');

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

function getUpstreamProxy() {
  let value = process.env.ORBIT_UPSTREAM_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!value && process.platform === 'win32') {
    let systemProxy = '';
    try {
      systemProxy = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$settings = Get-ItemProperty -LiteralPath 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Internet Settings'; if ($settings.ProxyEnable -eq 1) { $settings.ProxyServer }"], { encoding: 'utf8', windowsHide: true }).trim();
    } catch {
      // 读取系统代理只是便利功能, 失败时保持直连, 不影响代理服务启动
    }
    if (systemProxy.includes('=')) {
      const entries = systemProxy.split(';');
      systemProxy = (entries.find((item) => item.startsWith('https=')) || entries.find((item) => item.startsWith('http=')) || '').replace(/^https?=/, '');
    }
    value = systemProxy;
  }
  if (!value) return null;
  const proxy = new URL(value.includes('://') ? value : `http://${value}`);
  if (!['http:', 'https:'].includes(proxy.protocol)) throw new Error('上游代理只支持 HTTP 或 HTTPS');
  return proxy;
}

function createUpstreamAgent(proxy) {
  const agent = new https.Agent();
  // Node 的 HTTPS 请求需要显式建立隧道, 才会使用系统网络代理
  agent.createConnection = (options, callback) => {
    const authority = `${options.host}:${options.port}`;
    const headers = { Host: authority };
    if (proxy.username || proxy.password) headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`;
    const transport = proxy.protocol === 'https:' ? https : http;
    const connectRequest = transport.request(proxy, { method: 'CONNECT', path: authority, headers });
    connectRequest.on('connect', (upstreamResponse, socket, head) => {
      if (upstreamResponse.statusCode !== 200) {
        socket.destroy();
        callback(new Error(`上游代理连接失败: HTTP ${upstreamResponse.statusCode}`));
        return;
      }
      if (head.length) socket.unshift(head);
      callback(null, tls.connect({ ...options, socket, servername: options.servername || options.host }));
    });
    connectRequest.setTimeout(30 * 1000, () => connectRequest.destroy(new Error('连接上游代理超时')));
    connectRequest.on('error', callback);
    connectRequest.end();
  };
  return agent;
}

const upstreamProxy = getUpstreamProxy();
const upstreamAgent = upstreamProxy ? createUpstreamAgent(upstreamProxy) : undefined;

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
    headers: getForwardHeaders(request.headers),
    agent: target.protocol === 'https:' ? upstreamAgent : undefined
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
  console.log(upstreamProxy ? `HTTPS upstream proxy: ${upstreamProxy.origin}` : 'HTTPS upstream: direct');
  console.log('Keep this window open while using the proxy. Press Ctrl+C to stop.');
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : error.message);
  process.exit(1);
});
