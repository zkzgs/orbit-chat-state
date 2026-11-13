export function applyTheme(theme: 'dark' | 'light' | 'system') {
  const light =
    theme === 'light' ||
    (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches)
  document.documentElement.dataset.theme = light ? 'light' : 'dark'
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', light ? '#f5f7fa' : '#101827')
  try {
    localStorage.setItem('orbit-theme-v1', theme)
  } catch {}
}
