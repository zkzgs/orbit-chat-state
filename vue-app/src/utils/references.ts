import type { ReferenceImage } from '../types/models'

export function remapMentions(
  text: string,
  before: ReferenceImage[],
  after: ReferenceImage[],
  kind: 'generation' | 'polish' = 'generation',
) {
  const pattern =
    kind === 'generation' ? /@(图|生成参考图)(\d+)/g : /@(润色参考图)(\d+)/g
  return text.replace(pattern, (_, label: string, value: string) => {
    const image = before[Number(value) - 1]
    const index = after.findIndex((item) => item.id === image?.id)
    return `@${label}${index < 0 ? '?' : index + 1}`
  })
}

export function moveReference(
  images: ReferenceImage[],
  from: number,
  to: number,
) {
  const result = [...images]
  if (from >= 0 && from < result.length && to >= 0 && to < result.length)
    result.splice(to, 0, ...result.splice(from, 1))
  return result
}
