export function joinProxyPath(proxyUrl: string, suffix: string) {
  const segment = String(suffix || '').replace(/^\/+/, '')
  const raw = String(proxyUrl || '').trim()
  try {
    const url = new URL(raw)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${segment}`
    return url.href
  } catch {
    const base = raw.replace(/\/+$/, '')
    return segment ? `${base}/${segment}` : base
  }
}
