class JsonStreamReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private readonly decoder = new TextDecoder()
  private readonly onProgress?: (loaded: number) => void
  private buffer = ''
  private index = 0
  private done = false
  private loaded = 0

  constructor(
    stream: ReadableStream<Uint8Array>,
    onProgress?: (loaded: number) => void,
  ) {
    this.reader = stream.getReader()
    this.onProgress = onProgress
  }

  private async fill() {
    while (this.index >= this.buffer.length && !this.done) {
      const { value, done } = await this.reader.read()
      this.done = done
      this.loaded += value?.byteLength || 0
      this.buffer = this.decoder.decode(value, { stream: !done })
      this.index = 0
      this.onProgress?.(this.loaded)
    }
  }

  async peek() {
    await this.fill()
    return this.index < this.buffer.length ? this.buffer[this.index] : null
  }

  async read() {
    await this.fill()
    if (this.index >= this.buffer.length) return null
    return this.buffer[this.index++]
  }

  async skipWhitespace() {
    while (/\s/.test((await this.peek()) || '\u0000')) await this.read()
  }

  async expect(char: string) {
    await this.skipWhitespace()
    if ((await this.read()) !== char)
      throw new SyntaxError(`JSON 格式错误, 预期 ${char}`)
  }

  async readValue() {
    await this.skipWhitespace()
    const first = await this.read()
    if (!first) throw new SyntaxError('JSON 内容不完整')

    const parts: string[] = [first]
    const finish = () => parts.join('')

    if (first === '"') {
      let escaped = false
      while (true) {
        await this.fill()
        if (this.index >= this.buffer.length)
          throw new SyntaxError('JSON 字符串未结束')
        const start = this.index
        let end = start
        let closed = false
        while (end < this.buffer.length) {
          const char = this.buffer[end++]
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') {
            closed = true
            break
          }
        }
        parts.push(this.buffer.slice(start, end))
        this.index = end
        if (closed) return finish()
      }
    }

    if (first === '{' || first === '[') {
      const stack = [first]
      let inString = false
      let escaped = false
      while (stack.length) {
        await this.fill()
        if (this.index >= this.buffer.length)
          throw new SyntaxError('JSON 内容不完整')
        const start = this.index
        let end = start
        while (end < this.buffer.length && stack.length) {
          const char = this.buffer[end++]
          if (inString) {
            if (escaped) escaped = false
            else if (char === '\\') escaped = true
            else if (char === '"') inString = false
          } else if (char === '"') inString = true
          else if (char === '{' || char === '[') stack.push(char)
          else if (char === '}' || char === ']') stack.pop()
        }
        parts.push(this.buffer.slice(start, end))
        this.index = end
      }
      return finish()
    }

    while (true) {
      await this.fill()
      const start = this.index
      let end = start
      while (end < this.buffer.length && !/[\s,\]}]/.test(this.buffer[end]))
        end += 1
      parts.push(this.buffer.slice(start, end))
      this.index = end
      if (end < this.buffer.length || this.done) return finish()
    }
  }
}

export async function readWorkspaceJson(
  file: File,
  onProgress?: (progress: number) => void,
) {
  if (!file.stream) throw new Error('当前浏览器不支持流式读取导入文件')
  let lastProgressAt = 0
  const reader = new JsonStreamReader(file.stream(), (loaded) => {
    const now = performance.now()
    if (now - lastProgressAt < 100 && loaded < file.size) return
    lastProgressAt = now
    onProgress?.(Math.min(loaded / file.size, 1))
  })
  await reader.expect('{')
  const payload: Record<string, unknown> = Object.create(null)
  let itemCount = 0

  while (true) {
    await reader.skipWhitespace()
    const next = await reader.peek()
    if (next === '}') {
      await reader.read()
      break
    }
    if (next === null) throw new SyntaxError('JSON 内容不完整')

    const key = JSON.parse(await reader.readValue()) as string
    await reader.expect(':')
    await reader.skipWhitespace()
    if ((await reader.peek()) !== '[') {
      payload[key] = JSON.parse(await reader.readValue())
    } else {
      await reader.read()
      const items: unknown[] = []
      await reader.skipWhitespace()
      if ((await reader.peek()) !== ']') {
        while (true) {
          items.push(JSON.parse(await reader.readValue()))
          itemCount += 1
          await reader.skipWhitespace()
          const separator = await reader.read()
          if (separator === ']') break
          if (separator !== ',') throw new SyntaxError('JSON 数组格式错误')
          if (itemCount % 8 === 0)
            await new Promise((resolve) => window.setTimeout(resolve, 0))
        }
      } else await reader.read()
      payload[key] = items
    }

    await reader.skipWhitespace()
    const separator = await reader.read()
    if (separator === '}') break
    if (separator !== ',') throw new SyntaxError('JSON 对象格式错误')
  }
  await reader.skipWhitespace()
  if ((await reader.peek()) !== null)
    throw new SyntaxError('JSON 对象后存在多余内容')
  onProgress?.(1)
  return payload
}
