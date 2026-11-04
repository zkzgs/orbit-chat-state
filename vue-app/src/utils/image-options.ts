import type { ImageOptions } from '../types/models'

export function normalizeDimensions(width: number, height: number) {
  let w = Math.max(16, Math.round(width / 16) * 16 || 16)
  let h = Math.max(16, Math.round(height / 16) * 16 || 16)
  const edgeScale = Math.min(1, 3840 / Math.max(w, h))
  w = Math.max(16, Math.floor((w * edgeScale) / 16) * 16)
  h = Math.max(16, Math.floor((h * edgeScale) / 16) * 16)
  if (Math.max(w, h) / Math.min(w, h) > 3) {
    if (w > h) h = Math.ceil(w / 3 / 16) * 16
    else w = Math.ceil(h / 3 / 16) * 16
  }
  if (w * h > 8294400) {
    const scale = Math.sqrt(8294400 / (w * h))
    w = Math.floor((w * scale) / 16) * 16
    h = Math.floor((h * scale) / 16) * 16
  } else if (w * h < 655360) {
    const scale = Math.sqrt(655360 / (w * h))
    w = Math.min(3840, Math.ceil((w * scale) / 16) * 16)
    h = Math.min(3840, Math.ceil((h * scale) / 16) * 16)
  }
  return { width: w, height: h }
}
export function imageSize(options: ImageOptions) {
  if (
    options.sizeMode === 'auto' ||
    (options.sizeMode === 'ratio' && options.ratio === 'auto')
  )
    return 'auto'
  let { width, height } = options
  if (options.sizeMode === 'ratio') {
    const [w, h] = options.ratio.split(':').map(Number)
    const base =
      options.resolution === '4K'
        ? 3840
        : options.resolution === '2K'
          ? 2048
          : 1024
    width = w >= h ? base : (base * w) / h
    height = h >= w ? base : (base * h) / w
  }
  const size = normalizeDimensions(width, height)
  return `${size.width}x${size.height}`
}
export function imageSizeLabel(options: ImageOptions) {
  return options.sizeMode === 'auto'
    ? '自动'
    : `${imageSize(options)} · ${options.resolution} · ${options.ratio}`
}
