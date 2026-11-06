import type { ImageConfig } from '../types/models'
import { imageSize } from './image-options'

export function sizeToRatio(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/i)
  return match ? simplifyRatio(Number(match[1]), Number(match[2])) : ''
}

function simplifyRatio(width: number, height: number) {
  const gcd = (left: number, right: number): number =>
    right ? gcd(right, left % right) : left
  const divisor = gcd(width, height) || 1
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}

export function actualRatio(width: number, height: number) {
  const raw = simplifyRatio(width, height)
  const numeric = width / height
  const nearest = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9']
    .map((value) => {
      const [w, h] = value.split(':').map(Number)
      return { value, distance: Math.abs(numeric - w / h) }
    })
    .sort((left, right) => left.distance - right.distance)[0]
  if (nearest.value === raw) return raw
  if (nearest.distance / numeric < 0.012) return `${raw} ≈ ${nearest.value}`
  return `${raw} ≈ ${numeric.toFixed(2)}:1`
}

export function formatImageConfig(
  config: Partial<ImageConfig>,
  prompt: string,
) {
  const backgroundDelivery =
    config.backgroundMode === 'parameter'
      ? config.background && config.background !== 'auto'
        ? '发送 background 参数'
        : '未发送 background 参数'
      : config.background === 'transparent'
        ? '追加透明背景提示词'
        : '未追加背景提示词'
  const entries = [
    ['原始提示词', prompt || '未记录'],
    ['实际发送提示词', config.submittedPrompt || prompt || '未记录'],
    ['模型', config.model || '未知'],
    ['尺寸模式', config.sizeMode || 'auto'],
    ['分辨率', config.resolution || 'auto'],
    ['比例', config.ratio || 'auto'],
    ['请求尺寸', config.size || imageSize(config as ImageConfig)],
    ['宽高', `${config.width || '-'} × ${config.height || '-'}`],
    ['质量', config.quality || 'auto'],
    ['思考', config.reasoningEffort || 'auto'],
    ['格式（output_format）', config.format || 'png'],
    [
      '压缩（output_compression）',
      ['jpeg', 'webp'].includes(config.format || '')
        ? `${config.compression ?? 0}%`
        : `${config.compression ?? 0}%（${(config.format || 'png').toUpperCase()} 不发送）`,
    ],
    ['透明度选项', config.background || 'auto'],
    ['背景发送方式', backgroundDelivery],
    ['审核', config.moderation || 'auto'],
    [
      '参考图压缩',
      config.compressReferences
        ? `开启（目标 ${config.referenceCompressionLimitMb || 1}MB, 保持原分辨率）`
        : '关闭',
    ],
    ['数量', config.count || 1],
    [
      '数量方式',
      config.countMode === 'parallel'
        ? '并发请求（每次 n=1）'
        : '单次请求（n=数量）',
    ],
  ]
  return entries.map(([label, value]) => `${label}: ${value}`).join(' · ')
}
