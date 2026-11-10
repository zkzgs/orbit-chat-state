// Orbit API Proxy - Cloudflare Worker 版本 (独立文件, 不影响 proxy-server.js)
// 部署后前端「代理地址」填: https://<你的worker>.workers.dev/<PROXY_KEY>
// 请求路径: /<PROXY_KEY>/health  与  /<PROXY_KEY>/proxy (目标地址放在 X-Orbit-Target-Url 请求头)
// 密钥通过 Worker Secret 环境变量 PROXY_KEY 配置, 不写死在代码里; 不限制来源 IP / Origin / 目标域名

const targetHeader = 'x-orbit-target-url';
const blockedRequestHeaders = new Set([
  'host', 'connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade',
  'origin', 'referer', 'content-length', targetHeader
]);
const blockedResponseHeaders = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
  'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers',
  'access-control-expose-headers', 'access-control-allow-credentials', 'access-control-max-age',
  'content-length', 'content-encoding'
]);

function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i % (x.length || 1)] || 0) ^ (y[i % (y.length || 1)] || 0);
  return diff === 0 && x.length > 0;
}

function corsHeaders(request, headers = new Headers()) {
  headers.set('Access-Control-Allow-Origin', request.headers.get('origin') || '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', request.headers.get('access-control-request-headers') || 'Authorization, Content-Type, X-Orbit-Target-Url');
  headers.set('Access-Control-Expose-Headers', '*');
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('Vary', 'Origin');
  return headers;
}

function json(request, status, payload) {
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), { status, headers });
}

// 密钥错误时一律返回空 404, 不暴露这是代理服务
const notFound = () => new Response('Not Found', { status: 404 });

async function forward(request) {
  let target;
  try {
    const value = request.headers.get(targetHeader);
    if (!value) throw new Error('缺少目标接口地址');
    target = new URL(value);
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('目标接口只支持 HTTP 或 HTTPS');
  } catch (error) {
    return json(request, 400, { error: { message: error.message || '目标接口地址无效' } });
  }

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const key = name.toLowerCase();
    if (blockedRequestHeaders.has(key) || key.startsWith('sec-') || key.startsWith('cf-') || key.startsWith('x-forwarded-') || key === 'x-real-ip') continue;
    headers.set(name, value);
  }

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  let upstream;
  try {
    upstream = await fetch(target.href, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: 'follow'
    });
  } catch (error) {
    return json(request, 502, { error: { message: error.message || '上游请求失败' } });
  }

  const responseHeaders = new Headers();
  for (const [name, value] of upstream.headers) {
    if (!blockedResponseHeaders.has(name.toLowerCase())) responseHeaders.append(name, value);
  }
  corsHeaders(request, responseHeaders);
  // 直接透传响应流, 不缓冲, 保证 SSE / 流式输出
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

export default {
  async fetch(request, env) {
    const secret = String(env.PROXY_KEY || '');
    if (!secret) return notFound();
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || !timingSafeEqual(decodeURIComponent(parts[0]), secret)) return notFound();
    const route = parts[1];
    if (route !== 'health' && route !== 'proxy') return notFound();

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (route === 'health') {
      if (request.method !== 'GET') return notFound();
      return json(request, 200, { ok: true, service: 'orbit-api-proxy', version: 1, runtime: 'cloudflare-worker' });
    }
    return forward(request);
  }
};
