import { useWorkspaceStore } from '../stores/workspace'
import { joinProxyPath } from '../utils/proxy-url'

interface ProxyConfig {
  proxyEnabled: boolean
  proxyUrl: string
}

export function buildApiEndpoint(input: string, suffix: string) {
  let value = input.trim().replace(/\/$/, '')
  if (!value) return ''
  if (value.endsWith(suffix)) return value
  const knownEndpoint =
    /\/(chat\/completions|images\/generations|images\/edits)$/
  if (knownEndpoint.test(value))
    return `${value.replace(knownEndpoint, '')}${suffix}`
  if (value.endsWith('/v1') || value.endsWith('/api'))
    return `${value}${suffix}`
  if (!/^https?:\/\//i.test(value)) return value
  const url = new URL(value)
  if (url.pathname === '/') {
    url.pathname = `/v1${suffix}`
    return url.href
  }
  return value
}

export function buildModelsEndpoint(input: string) {
  const value = input
    .trim()
    .replace(/\/$/, '')
    .replace(/\/(chat\/completions|images\/generations|models)$/, '')
  if (!value) return ''
  if (!/^https?:\/\//i.test(value)) return `${value}/models`
  const url = new URL(value)
  if (url.pathname === '/') {
    url.pathname = '/v1/models'
    return url.href
  }
  return `${value}/models`
}

export function normalizeProxyUrl(value: string) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
}

export function routeApiRequest(
  endpoint: string,
  options: RequestInit = {},
  proxyConfig: ProxyConfig = useWorkspaceStore().state.settings,
) {
  if (!proxyConfig.proxyEnabled) return { endpoint, options }
  const proxyUrl = normalizeProxyUrl(proxyConfig.proxyUrl)
  if (!proxyUrl) throw new Error('已启用代理, 但代理地址为空')
  const targetUrl = new URL(endpoint).href
  const headers = new Headers(options.headers || {})
  headers.set('X-Orbit-Target-Url', targetUrl)
  return {
    endpoint: joinProxyPath(proxyUrl, 'proxy'),
    options: { ...options, headers },
  }
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {},
  proxyConfig: ProxyConfig = useWorkspaceStore().state.settings,
  onSent?: () => void,
) {
  const request = routeApiRequest(endpoint, options, proxyConfig)
  try {
    const response = fetch(request.endpoint, request.options)
    onSent?.()
    return await response
  } catch (error) {
    if (proxyConfig.proxyEnabled && (error as Error).name !== 'AbortError')
      throw new Error(`无法连接代理 ${normalizeProxyUrl(proxyConfig.proxyUrl)}`)
    throw error
  }
}

export function resourceFetch(source: string, options: RequestInit = {}) {
  return useWorkspaceStore().state.settings.proxyEnabled &&
    /^https?:\/\//i.test(source)
    ? apiFetch(source, options)
    : fetch(source, options)
}
