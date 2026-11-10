import { ref } from 'vue'

export const PROXY_URL_HISTORY_KEY = 'orbit-proxy-url-history-v1'
export const PROXY_URL_HISTORY_LIMIT = 10
const LEGACY_PRESET_DISMISSED_KEY = 'orbit-proxy-url-preset-dismissed-v1'
export const DEFAULT_PROXY_URL_HISTORY = [
  'http://127.0.0.1:8787',
  'https://orbit-proxy.zgs2020893278.workers.dev/7f2d9a4c81e0b563fa7290cd418be35',
]

export const proxyUrlHistory = ref<string[]>(readHistory())

function normalize(value: string) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
}

function defaultHistory() {
  return DEFAULT_PROXY_URL_HISTORY.map(normalize)
}

function forgetLegacyDismissedKey() {
  try {
    localStorage.removeItem(LEGACY_PRESET_DISMISSED_KEY)
  } catch {
    /* ignore */
  }
}

function readHistory(): string[] {
  forgetLegacyDismissedKey()
  try {
    const raw = localStorage.getItem(PROXY_URL_HISTORY_KEY)
    if (raw == null) return defaultHistory()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaultHistory()
    const seen = new Set<string>()
    const history: string[] = []
    for (const item of parsed) {
      const url = normalize(String(item || ''))
      if (!url || seen.has(url)) continue
      seen.add(url)
      history.push(url)
      if (history.length >= PROXY_URL_HISTORY_LIMIT) break
    }
    return history
  } catch {
    return defaultHistory()
  }
}

function persist(history: string[]) {
  const next = history.slice(0, PROXY_URL_HISTORY_LIMIT)
  proxyUrlHistory.value = next
  try {
    localStorage.setItem(PROXY_URL_HISTORY_KEY, JSON.stringify(next))
  } catch {
    /* 浏览器禁止本地存储时仍更新当前页面中的列表 */
  }
  return next
}

export function loadProxyUrlHistory(): string[] {
  const history = readHistory()
  proxyUrlHistory.value = history
  return history
}

export function rememberProxyUrl(value: string): string[] {
  const url = normalize(value)
  const history = proxyUrlHistory.value.filter((item) => item !== url)
  if (url) history.unshift(url)
  return persist(history)
}

export function forgetProxyUrl(value: string): string[] {
  return persist(
    proxyUrlHistory.value.filter((item) => item !== normalize(value)),
  )
}

export function clearProxyUrlHistory() {
  try {
    localStorage.removeItem(PROXY_URL_HISTORY_KEY)
    localStorage.removeItem(LEGACY_PRESET_DISMISSED_KEY)
  } catch {
    /* ignore */
  }
  proxyUrlHistory.value = defaultHistory()
}
