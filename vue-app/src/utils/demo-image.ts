import { escapeHtml } from './markdown'
export function createDemoImage(
  prompt: string,
  index: number,
  width: number,
  height: number,
) {
  const palettes = [
    ['#111b38', '#74d4cb'],
    ['#273222', '#e6f36b'],
    ['#38213c', '#efa9cc'],
  ]
  const [base, accent] = palettes[index % palettes.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${base}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/><circle cx="750" cy="280" r="170" fill="${accent}" opacity=".5"/><path d="M0 800 260 420 540 800 760 500 1024 800V1024H0Z" fill="${base}" opacity=".65"/><text x="64" y="890" font-size="32" fill="white">${escapeHtml(prompt.slice(0, 24))}</text><text x="64" y="950" font-size="20" fill="white" opacity=".6">ORBIT · ${index + 1}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
