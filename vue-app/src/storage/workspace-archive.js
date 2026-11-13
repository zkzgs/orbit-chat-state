// 导出按资源的实际产出来源分类, 与当前对话的引用标签无关。
export function outputImageIds(payload) {
  const ids = new Set(
    (payload.images || [])
      .filter((image) => image.origin === 'generated' || image.batchId)
      .map((image) => image.id),
  )
  for (const batch of payload.imageHistory || [])
    for (const id of batch.imageIds || []) ids.add(id)
  for (const conversation of payload.conversations || [])
    for (const message of conversation.messages || [])
      if (message.role === 'assistant')
        for (const id of message.imageIds || []) ids.add(id)
  return ids
}

// 两个入口共用 ZIP 格式, 图片逐个读写, 不在内存构造整库 Base64。
export function createWorkspaceArchive(
  zip,
  storage,
  createJson,
  readJson,
  documents,
) {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0))
  function snapshot(value) {
    if (Array.isArray(value)) return value.map(snapshot)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, snapshot(item)]),
      )
    return value
  }
  async function exportFile(payload, onProgress = (_progress) => {}) {
    payload = snapshot(payload)
    const parts = []
    let failure
    const writer = new zip.Zip((error, data) => {
      if (error) failure = error
      else parts.push(new Blob([data]))
    })
    const images = []
    const originals = payload.images || []
    const attachments = (payload.conversations || []).flatMap((conversation) =>
      conversation.messages.flatMap((message) => message.files || []),
    )
    const uniqueFiles = [
      ...new Map(attachments.map((file) => [file.id, file])).values(),
    ]
    const outputs = outputImageIds(payload)
    const progressStep =
      0.9 / Math.max(1, originals.length + uniqueFiles.length)
    onProgress(0)
    await pause()
    for (let i = 0; i < originals.length; i++) {
      const image = {
        ...originals[i],
        origin: outputs.has(originals[i].id) ? 'generated' : 'upload',
      }
      const source =
        storage.isSource(image.src) && !image.hasBlob
          ? await storage.dataUrl(image.src)
          : image.src
      if (!storage.isSource(source) && !source?.startsWith('data:')) {
        images.push({ ...image, src: source })
        onProgress((i + 1) * progressStep)
        continue
      }
      const blob = await storage.readBlob(source)
      const extension =
        { 'image/svg+xml': 'svg', 'image/jpeg': 'jpg' }[blob.type] ||
        blob.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ||
        'bin'
      const directory = outputs.has(image.id) ? 'outputs' : 'inputs'
      const file = `${directory}/${i}.${extension}`
      const entry = new zip.ZipPassThrough(file)
      writer.add(entry)
      for (let offset = 0; offset < blob.size; offset += 256 * 1024) {
        entry.push(
          new Uint8Array(
            await blob.slice(offset, offset + 256 * 1024).arrayBuffer(),
          ),
          false,
        )
        if (failure) throw failure
        onProgress(
          i * progressStep +
            Math.min(1, (offset + 256 * 1024) / Math.max(1, blob.size)) *
              progressStep,
        )
        await pause()
      }
      entry.push(new Uint8Array(), true)
      const { src, ...metadata } = image
      images.push({ ...metadata, file, mimeType: blob.type })
      onProgress((i + 1) * progressStep)
    }
    for (const [index, file] of uniqueFiles.entries()) {
      const blob = await documents.read(file.id)
      const path = `files/${index}.pdf`
      const entry = new zip.ZipPassThrough(path)
      writer.add(entry)
      for (let offset = 0; offset < blob.size; offset += 256 * 1024) {
        entry.push(
          new Uint8Array(
            await blob.slice(offset, offset + 256 * 1024).arrayBuffer(),
          ),
          false,
        )
        if (failure) throw failure
        onProgress(
          (originals.length +
            index +
            Math.min(1, (offset + 256 * 1024) / blob.size)) *
            progressStep,
        )
        await pause()
      }
      entry.push(new Uint8Array(), true)
      for (const reference of attachments)
        if (reference.id === file.id) reference.archiveFile = path
    }
    // 清单保存资源路径, 图片和 PDF 正文分别写入压缩包。
    const manifest = await createJson({ ...payload, version: 14, images })
    const entry = new zip.ZipDeflate('manifest.json', { level: 6 })
    writer.add(entry)
    for (let offset = 0; offset < manifest.size; offset += 128 * 1024) {
      entry.push(
        new Uint8Array(
          await manifest.slice(offset, offset + 128 * 1024).arrayBuffer(),
        ),
        false,
      )
      onProgress(
        Math.min(
          1,
          0.9 + (0.1 * (offset + 128 * 1024)) / Math.max(manifest.size, 1),
        ),
      )
      await pause()
    }
    entry.push(new Uint8Array(), true)
    writer.end()
    if (failure) throw failure
    onProgress(1)
    return new Blob(parts, { type: 'application/zip' })
  }

  async function importFile(file, onProgress = (_progress) => {}) {
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    if (signature[0] !== 80 || signature[1] !== 75)
      return {
        payload: await readJson(file, onProgress),
        dispose: async () => {},
      }
    const session = `import/${Date.now()}-${Math.random().toString(36).slice(2)}/`
    const staged = []
    const files = new Map()
    let manifest
    let failure
    let pending = []
    const dispose = () => storage.deleteAssets(staged)
    const reader = new zip.Unzip((entry) => {
      if (files.has(entry.name)) {
        failure = new Error('压缩包包含重复文件')
        return
      }
      if (
        entry.name !== 'manifest.json' &&
        !/^(?:images|inputs|outputs)\/\d+(?:\.[a-z0-9]+)?$/i.test(entry.name) &&
        !/^files\/\d+\.pdf$/i.test(entry.name)
      )
        return
      files.set(entry.name, null)
      let parts = []
      entry.ondata = (error, data, final) => {
        if (error) {
          failure = error
          return
        }
        parts.push(new Blob([data]))
        if (!final) return
        const blob = new Blob(parts)
        parts = []
        if (entry.name === 'manifest.json') manifest = blob
        else {
          const id = session + entry.name
          staged.push(id)
          pending.push(
            storage
              .putAsset(id, blob)
              .then((source) => files.set(entry.name, source)),
          )
        }
      }
      entry.start()
    })
    reader.register(zip.UnzipInflate)
    try {
      for (let offset = 0; offset < file.size; offset += 128 * 1024) {
        reader.push(
          new Uint8Array(
            await file.slice(offset, offset + 128 * 1024).arrayBuffer(),
          ),
          offset + 128 * 1024 >= file.size,
        )
        await Promise.all(pending)
        pending = []
        if (failure) throw failure
        onProgress(Math.min(0.9, ((offset + 128 * 1024) / file.size) * 0.9))
        await pause()
      }
      if (!manifest) throw new Error('压缩包缺少 manifest.json')
      const payload = await readJson(new File([manifest], 'manifest.json'))
      for (const conversation of payload.conversations || [])
        for (const message of conversation.messages || [])
          for (const file of message.files || []) {
            if (!file.archiveFile) continue
            if (!files.get(file.archiveFile))
              throw new Error(`备份缺少 PDF 文件: ${file.name}`)
            file.archiveSource = files.get(file.archiveFile)
            delete file.archiveFile
          }
      for (const image of payload.images || []) {
        if (!image.file) continue
        if (!files.get(image.file))
          throw new Error(`备份缺少图片文件: ${image.file}`)
        const source = files.get(image.file)
        // ZIP 无 MIME 信息, 以清单恢复原始类型。
        const blob = await storage.readBlob(source)
        await storage.putAsset(
          source.slice('orbit-image:'.length),
          blob.slice(
            0,
            blob.size,
            image.mimeType || 'application/octet-stream',
          ),
        )
        image.src = source
        image.hasBlob = true
        delete image.file
        delete image.mimeType
      }
      onProgress(1)
      return { payload, dispose }
    } catch (error) {
      await dispose()
      throw error
    }
  }
  return { exportFile, importFile }
}
