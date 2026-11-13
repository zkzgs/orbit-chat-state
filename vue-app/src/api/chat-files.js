export const chatFileAccept =
  'application/pdf,.pdf,text/*,.txt,.md,.mdx,.json,.jsonl,.csv,.tsv,.log,.html,.htm,.xml,.yaml,.yml,.toml,.ini,.conf,.env,.js,.jsx,.ts,.tsx,.mjs,.cjs,.vue,.svelte,.css,.scss,.less,.sql,.py,.java,.c,.h,.cpp,.hpp,.cs,.go,.rs,.php,.rb,.sh,.bash,.ps1,.bat,.r,.lua,.swift,.kt,.dart,.ipynb,.tex,.graphql,.gql,.properties'

export async function readChatTextFiles(files, currentLength = 0) {
  if (files.length > 10) throw new Error('每次最多选择 10 个文件')
  const blocks = []
  let length = currentLength
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024)
      throw new Error(`${file.name}: 文件不能超过 10 MB`)
    const extension = '.' + file.name.split('.').at(-1).toLowerCase()
    if (
      !file.type.startsWith('text/') &&
      !chatFileAccept.split(',').includes(extension)
    )
      throw new Error(`${file.name}: 暂不支持此文件类型`)
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength))
    const encoding =
      bytes[0] === 255 && bytes[1] === 254
        ? 'utf-16le'
        : bytes[0] === 254 && bytes[1] === 255
          ? 'utf-16be'
          : 'utf-8'
    const text = new TextDecoder(encoding).decode(buffer)
    if (text.includes('\0'))
      throw new Error(`${file.name}: 不是可读取的文本文件`)
    const block = `文件: ${file.name}\n\n${text}`
    length += block.length + 2
    if (length > 200000)
      throw new Error('文件与当前输入的文字总量不能超过 20 万字符')
    blocks.push(block)
  }
  return blocks.join('\n\n')
}

export async function readChatFiles(files, currentLength, existing = []) {
  if (files.length > 10) throw new Error('每次最多选择 10 个文件')
  const documents = files.filter(
    (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name),
  )
  if (existing.length + documents.length > 10)
    throw new Error('每条消息最多附加 10 个 PDF')
  for (const file of documents)
    if (file.size > 10 * 1024 * 1024)
      throw new Error(`${file.name}: 文件不能超过 10 MB`)
  if (
    [...existing, ...documents].reduce((sum, file) => sum + file.size, 0) >
    50 * 1024 * 1024
  )
    throw new Error('PDF 附件总量不能超过 50 MB')
  const text = await readChatTextFiles(
    files.filter((file) => !documents.includes(file)),
    currentLength,
  )
  return {
    text,
    documents: documents.map((file) => ({
      id: `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      size: file.size,
      file,
    })),
  }
}

// PDF 正文单独存储, 消息与草稿仅持有附件信息。
export const chatDocuments = (() => {
  let connection
  function open() {
    if (!connection)
      connection = new Promise((resolve, reject) => {
        const request = indexedDB.open('orbit-chat-files-v1', 1)
        request.onupgradeneeded = () =>
          request.result.createObjectStore('files', { keyPath: 'id' })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => {
          connection = undefined
          reject(request.error)
        }
      })
    return connection
  }
  async function write(run) {
    const db = await open()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      run(tx.objectStore('files'))
    })
  }
  async function read(id) {
    const db = await open()
    const record = await new Promise((resolve, reject) => {
      const request = db.transaction('files').objectStore('files').get(id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (!record) throw new Error('PDF 附件不存在, 请重新上传')
    return record.blob
  }
  async function save(files) {
    const records = []
    for (const { file, ...record } of files) {
      if (file)
        await write((store) =>
          store.put({
            id: record.id,
            blob: file.slice(0, file.size, 'application/pdf'),
          }),
        )
      records.push(record)
    }
    return records
  }
  async function content(content, files = []) {
    if (!files.length) return content
    const parts = Array.isArray(content)
      ? [...content]
      : content
        ? [{ type: 'text', text: content }]
        : []
    for (const file of files) {
      const blob = await read(file.id)
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      parts.push({
        type: 'file',
        file: { filename: file.name, file_data: data },
      })
    }
    return parts
  }
  async function restore(conversations, storage) {
    for (const conversation of conversations || [])
      for (const message of conversation.messages || [])
        for (const file of message.files || []) {
          if (!file.archiveSource) continue
          const blob = await storage.readBlob(file.archiveSource)
          await write((store) =>
            store.put({
              id: file.id,
              blob: blob.slice(0, blob.size, 'application/pdf'),
            }),
          )
          delete file.archiveSource
        }
  }
  async function collect(conversations, extra = []) {
    const used = new Set([
      ...extra,
      ...conversations.flatMap((conversation) =>
        conversation.messages.flatMap((message) =>
          (message.files || []).map((file) => file.id),
        ),
      ),
    ])
    await write((store) => {
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        if (!used.has(cursor.key)) cursor.delete()
        cursor.continue()
      }
    })
  }
  return { read, save, content, restore, collect }
})()
