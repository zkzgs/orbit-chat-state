const requestErrorLogKey = 'orbit-request-errors-v1'
const requestErrors = []

const proxyErrorStages = new Set(['entry', 'gateway', 'gateway-proxy', 'upstream-connection', 'upstream-response'])

function proxyRequestId(response, proxied) {
  const value = proxied && response?.headers.get('x-orbit-request-id')
  return value && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
    ? value : undefined
}

function recordError(stage, status, kind, detail = '', requestId = undefined) {
  const code = String(detail).match(/\b(?:ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b/i)?.[0]?.toUpperCase()
    || (/socket hang up/i.test(detail) ? 'SOCKET_HANG_UP' : undefined)
  const entry = { time: new Date().toISOString(), stage, status, kind, code, requestId }
  requestErrors.push(entry)
  if (requestErrors.length > 100) requestErrors.shift()
  try {
    const stored = JSON.parse(localStorage.getItem(requestErrorLogKey) || '[]')
    localStorage.setItem(requestErrorLogKey, JSON.stringify([...(Array.isArray(stored) ? stored : []), entry].slice(-100)))
  } catch {}
}

export function exportRequestErrors() {
  let entries = requestErrors
  try {
    const stored = JSON.parse(localStorage.getItem(requestErrorLogKey) || 'null')
    if (Array.isArray(stored)) entries = stored.slice(-100)
  } catch {}
  const url = URL.createObjectURL(new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'orbit-error-log.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function isHtmlResponse(response, raw = '') {
  return /\btext\/html\b/i.test(response.headers.get('content-type') || '') ||
    /^\s*<(?:!doctype\b|!--|[a-z][\w:-]*[\s/>])/i.test(raw)
}

export function requestErrorMessage(response, raw, proxied, detail = '') {
  const html = isHtmlResponse(response, raw) || isHtmlResponse(response, detail)
  const status = `HTTP ${response.status}`
  const stage = proxied && response.headers.get('x-orbit-proxy-stage')
  const requestId = proxyRequestId(response, proxied)
  const suffix = requestId ? `（请求编号：${requestId}）` : ''
  const source = stage === 'upstream-connection' ? '代理转发失败'
    : stage === 'upstream-response' ? '上游接口'
    : proxied ? '代理链路（来源未确认）' : '接口'
  const recordedStage = proxyErrorStages.has(stage) ? stage : proxied ? 'proxy-unknown' : 'direct'
  recordError(recordedStage, response.status, html ? 'html-response' : 'http-error', detail || raw, requestId)
  if (stage === 'entry' || stage === 'gateway' || stage === 'gateway-proxy') {
    const hints = { 403: '代理入口拒绝访问，请检查站点或接口是否放行', 404: '未找到代理接口，请检查代理地址', 429: '代理入口限流，请稍后再试' }
    const hint = hints[response.status] || '代理网关转发失败'
    return `${hint}（${status}）${suffix}`
  }
  if (response.status === 524) return `${source}返回 HTTP 524：等待源站响应超时${suffix}`
  if (response.status === 504) return `${source}返回 HTTP 504：网关等待响应超时${suffix}`
  if (stage === 'upstream-response' && [401, 403].includes(response.status))
    return `上游接口返回 ${status}：请检查接口密钥和访问权限${suffix}`
  if (html) return `${source}返回了 HTML 页面（${status}），未收到接口数据${suffix}`
  const message = String(detail || raw || '').trim().slice(0, 300)
  if (stage === 'upstream-connection')
    return `代理转发失败（${status}）${message ? `：${message}` : ''}${suffix}`
  if (stage === 'upstream-response')
    return `上游接口返回 ${status}${message ? `：${message}` : ''}${suffix}`
  if (proxied)
    return `代理链路返回 ${status}（来源未确认）${message ? `：${message}` : ''}${suffix}`
  return message || `接口返回 ${response.status}`
}

export async function readRequestError(response, proxied) {
  const raw = await readApiText(response, proxied)
  let detail = ''
  try {
    const payload = JSON.parse(raw)
    detail = payload?.error?.message || payload?.message || ''
  } catch {}
  return requestErrorMessage(response, raw, proxied, detail)
}

/** @param {Response} [response] */
export function requestNetworkError(proxied, reading = false, response) {
  const requestId = proxyRequestId(response, proxied)
  recordError(proxied ? 'proxy-unknown' : 'direct', response?.status ?? null, reading ? 'response-interrupted' : 'no-response', '', requestId)
  const suffix = requestId ? `（请求编号：${requestId}）` : ''
  return new Error(reading
    ? proxied ? `代理链路响应中断，无法确认断开位置${suffix}` : '接口响应中断'
    : proxied ? '请求未收到代理响应，请检查代理连通性和跨域设置' : '网络请求失败, 请检查接口地址和跨域设置')
}

export async function readApiText(response, proxied) {
  try {
    return await response.text()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw requestNetworkError(proxied, true, response)
  }
}

export async function readApiJson(response, proxied) {
  if (!response.ok) throw new Error(await readRequestError(response, proxied))
  const raw = await readApiText(response, proxied)
  if (isHtmlResponse(response, raw))
    throw new Error(requestErrorMessage(response, raw, proxied))
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(requestErrorMessage(response, '', proxied, '接口未返回 JSON'))
  }
}

/** @param {Response} [response] */
export async function readApiChunk(reader, proxied, response) {
  try {
    return await reader.read()
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw requestNetworkError(proxied, true, response)
  }
}
