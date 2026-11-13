import { imageStorage } from '../storage/database'

// 只复制 JSON 数据的结构, 大图片字符串保持共享, 不经序列化复制整库。
function snapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snapshot)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, snapshot(item)]),
    )
  return value
}

async function* jsonChunks(value: unknown): AsyncGenerator<string> {
  const image = value as { type?: string; src?: string } | null
  if (image?.type === 'image' && imageStorage.isSource(image.src))
    value = { ...image, src: await imageStorage.dataUrl(image.src) }
  if (typeof value === 'string') {
    yield '"'
    for (let start = 0; start < value.length; start += 256 * 1024)
      yield JSON.stringify(value.slice(start, start + 256 * 1024)).slice(1, -1)
    yield '"'
  } else if (Array.isArray(value)) {
    yield '['
    for (let i = 0; i < value.length; i++) {
      if (i) yield ','
      yield* jsonChunks(value[i])
    }
    yield ']'
  } else if (value && typeof value === 'object') {
    yield '{'
    let first = true
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      if (!first) yield ','
      first = false
      yield JSON.stringify(key) + ':'
      yield* jsonChunks(item)
    }
    yield '}'
  } else yield JSON.stringify(value) ?? 'null'
}

export async function createJsonBlob(value: unknown): Promise<Blob> {
  const data = snapshot(value)
  const parts: Blob[] = []
  let chunks: string[] = []
  let length = 0
  let lastYield = performance.now()
  for await (const chunk of jsonChunks(data)) {
    chunks.push(chunk)
    length += chunk.length
    if (length >= 1024 * 1024 || performance.now() - lastYield >= 8) {
      parts.push(new Blob(chunks))
      chunks = []
      length = 0
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      lastYield = performance.now()
    }
  }
  if (chunks.length) parts.push(new Blob(chunks))
  return new Blob(parts, { type: 'application/json' })
}
