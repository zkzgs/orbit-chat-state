// HTML 内联同一份实现, 两个入口共用数据库格式和图片引用规则。
export function createImageStorage(options) {
  const prefix = 'orbit-image:'
  const assets = 'image-assets'
  const thumbnails = 'image-thumbnails'
  const stores = [options.storeName, assets, thumbnails]
  const placeholder =
    'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
  const cache = new Map()
  const reads = new Map()
  const memory = new Map()
  const bindings = new Map()
  let observer
  let connection
  let epoch = 0
  let active = 0
  let scanning = 0
  const deferredWrites = []
  const queue = []
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0))
  const isSource = (source) =>
    typeof source === 'string' && source.startsWith(prefix)
  const source = (id) => prefix + id
  const idOf = (value) => value.slice(prefix.length)

  function open() {
    if (connection) return connection
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(options.dbName, 2)
      request.onupgradeneeded = () => {
        for (const name of stores)
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name, { keyPath: 'id' })
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          connection = undefined
        }
        db.onclose = () => {
          connection = undefined
        }
        resolve(db)
      }
      request.onerror = () => {
        connection = undefined
        reject(request.error)
      }
    })
    return connection
  }

  async function get(name, id) {
    const db = await open()
    return new Promise((resolve, reject) => {
      const store = db.transaction(name).objectStore(name)
      const request = store.get(id)
      request.onsuccess = () => {
        if (
          request.result !== undefined ||
          typeof id !== 'string' ||
          !/^\d+$/.test(id)
        ) {
          resolve(request.result)
          return
        }
        // 早期版本允许数字 ID, 图片引用在 DOM 中会转成字符串。
        const legacy = store.get(Number(id))
        legacy.onsuccess = () => resolve(legacy.result)
        legacy.onerror = () => reject(legacy.error)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async function transaction(run) {
    const db = await open()
    return new Promise((resolve, reject) => {
      let tx
      try {
        tx = db.transaction(stores, 'readwrite', { durability: 'strict' })
      } catch {
        tx = db.transaction(stores, 'readwrite')
      }
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      run(tx)
    })
  }
  function backgroundWrite(run) {
    if (scanning) {
      deferredWrites.push(run)
      return
    }
    void transaction(run).catch(() => {
      /* 原图迁移和缩略图均可在下次读取时重试 */
    })
  }

  function metadata(record) {
    if (record.type !== 'image') return record
    return {
      ...record,
      src: source(record.id),
      hasBlob: record.hasBlob || record.src?.startsWith('data:'),
    }
  }

  async function readRecords(onRecords) {
    const db = await open()
    const legacy = []
    scanning++
    try {
      await new Promise((resolve, reject) => {
        let pending = []
        let last = performance.now()
        let first = true
        const publish = () => {
          if (!pending.length) return
          onRecords(pending)
          pending = []
          first = false
          last = performance.now()
        }
        const request = db
          .transaction(options.storeName)
          .objectStore(options.storeName)
          .openCursor(null, 'prev')
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            publish()
            resolve()
            return
          }
          const record = cursor.value
          if (record.type === 'image' && record.src?.startsWith('data:'))
            legacy.push(record.id)
          pending.push(metadata(record))
          if (
            pending.length >= (first ? 4 : 32) ||
            performance.now() - last >= 16
          )
            publish()
          cursor.continue()
        }
        request.onerror = () => reject(request.error)
      })
    } finally {
      scanning--
      if (!scanning)
        for (const run of deferredWrites.splice(0)) backgroundWrite(run)
    }
    // 只保留 ID, 后台逐张迁移, 不把旧库的所有 Base64 留在内存。
    const generation = epoch
    setTimeout(async () => {
      for (const id of legacy) {
        if (generation !== epoch) return
        try {
          await readBlob(source(id))
        } catch {
          /* 下次读取时可重试, 旧数据仍保留 */
        }
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
    }, 100)
  }

  async function fingerprint(value) {
    if (isSource(value)) {
      const id = idOf(value)
      const record = memory.get(id) || (await get(options.storeName, id))
      if (record?.fingerprint) return record.fingerprint
      value = record?.src || (await readBlob(value))
    }
    const blob =
      value instanceof Blob
        ? value
        : value?.startsWith('data:')
          ? await decode(value)
          : undefined
    const bytes = blob
      ? new Uint8Array(await blob.arrayBuffer())
      : new TextEncoder().encode(value)
    let first = 2166136261
    let second = 2246822519
    for (let i = 0; i < bytes.length; i++) {
      const code = bytes[i]
      first = Math.imul(first ^ code, 16777619)
      second = Math.imul(second ^ code, 3266489917)
      if (i && i % (256 * 1024) === 0) await pause()
    }
    return `${bytes.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`
  }

  async function decode(value) {
    try {
      return await options.decode(value)
    } catch {
      return await (await fetch(value)).blob()
    }
  }

  async function readBlob(value) {
    if (!isSource(value)) {
      if (value.startsWith('data:')) return decode(value)
      const response = await options.fetch(value)
      if (!response.ok) throw new Error('图片读取失败')
      return response.blob()
    }
    const id = idOf(value)
    if (reads.has(id)) return reads.get(id)
    const task = (async () => {
      const retained = memory.get(id)
      if (retained) return decode(retained.src)
      const asset = await get(assets, id)
      if (asset) return asset.blob
      const record = await get(options.storeName, id)
      if (!record) throw new Error('图片不存在')
      if (!record.src) throw new Error('图片文件不存在')
      if (!record.src.startsWith('data:')) return readBlob(record.src)
      const generation = epoch
      const blob = await decode(record.src)
      const hash = await fingerprint(record.src)
      if (generation === epoch) {
        // 迁移和读取并行时, 取最新元数据, 避免覆盖收藏等刚修改的字段。
        backgroundWrite((tx) => {
          const records = tx.objectStore(options.storeName)
          const request = records.get(id)
          request.onsuccess = () => {
            const latest = request.result
            if (generation !== epoch || latest?.src !== record.src) return
            tx.objectStore(assets).put({ id, blob })
            records.put({
              ...latest,
              src: '',
              hasBlob: true,
              fingerprint: hash,
            })
          }
        })
      }
      return blob
    })()
    reads.set(id, task)
    try {
      return await task
    } finally {
      if (reads.get(id) === task) reads.delete(id)
    }
  }

  async function dataUrl(value) {
    if (!isSource(value)) return value
    const record =
      memory.get(idOf(value)) || (await get(options.storeName, idOf(value)))
    if (record?.src) return record.src
    const blob = await readBlob(value)
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  }

  async function sameSource(first, second) {
    if (first === second) return true
    // 未缓存的远程图仍按原地址比较, 备份合并不额外依赖跨域下载。
    if (isSource(first)) {
      const record = await get(options.storeName, idOf(first))
      if (/^https?:\/\//i.test(record?.src || '')) first = record.src
    }
    if (isSource(second)) {
      const record = await get(options.storeName, idOf(second))
      if (/^https?:\/\//i.test(record?.src || '')) second = record.src
    }
    if (first === second) return true
    if ((await fingerprint(first)) !== (await fingerprint(second))) return false
    const [a, b] = await Promise.all([readBlob(first), readBlob(second)])
    if (a.size !== b.size) return false
    for (let offset = 0; offset < a.size; offset += 256 * 1024) {
      const x = new Uint8Array(
        await a.slice(offset, offset + 256 * 1024).arrayBuffer(),
      )
      const y = new Uint8Array(
        await b.slice(offset, offset + 256 * 1024).arrayBuffer(),
      )
      if (x.some((value, index) => value !== y[index])) return false
      await pause()
    }
    return true
  }

  async function includesSource(items, value) {
    for (const item of items)
      if (await sameSource(item.data, value)) return true
    return false
  }

  function retire(entry) {
    entry.retired = true
    if (!entry.users && entry.url) URL.revokeObjectURL(entry.url)
  }
  function invalidate(id) {
    reads.delete(id)
    for (const [key, entry] of cache)
      if (entry.id === id) {
        cache.delete(key)
        retire(entry)
      }
    for (const [element, binding] of bindings)
      if (binding.value === source(id) && binding.visible)
        display(element, binding)
  }
  function trim() {
    let bytes = 0
    let originals = 0
    for (const entry of cache.values()) bytes += entry.bytes || 0
    for (const key of cache.keys()) if (key.startsWith('full:')) originals++
    for (const [key, entry] of cache) {
      if (cache.size <= 128 && bytes <= 48 * 1024 * 1024 && originals <= 8)
        break
      if (entry.users || !entry.url) continue
      if (
        originals > 8 &&
        key.startsWith('thumb:') &&
        cache.size <= 128 &&
        bytes <= 48 * 1024 * 1024
      )
        continue
      cache.delete(key)
      if (key.startsWith('full:')) originals--
      bytes -= entry.bytes
      retire(entry)
    }
  }
  async function limited(work) {
    if (active >= 2) await new Promise((resolve) => queue.push(resolve))
    else active++
    try {
      return await work()
    } finally {
      const next = queue.shift()
      if (next) next()
      else active--
    }
  }

  async function createThumbnail(blob) {
    if (blob.type.startsWith('video/')) return videoFrame(blob, true)
    try {
      return await options.thumbnail(blob)
    } catch {
      const url = URL.createObjectURL(blob)
      try {
        const image = new Image()
        image.src = url
        await image.decode()
        const scale = Math.min(
          1,
          640 / Math.max(image.naturalWidth, image.naturalHeight),
        )
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        canvas
          .getContext('2d')
          .drawImage(image, 0, 0, canvas.width, canvas.height)
        return await new Promise((resolve, reject) =>
          canvas.toBlob(
            (result) =>
              result ? resolve(result) : reject(new Error('缩略图生成失败')),
            'image/webp',
            0.8,
          ),
        )
      } finally {
        URL.revokeObjectURL(url)
      }
    }
  }

  async function previewDataUrl(value) {
    const preview = isSource(value) ? await acquire(value, true) : undefined
    try {
      const blob = preview
        ? await (await options.fetch(preview.src)).blob()
        : await createThumbnail(await readBlob(value))
      return await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
    } finally {
      preview?.release()
    }
  }

  async function videoFrame(blob, thumbnail = false) {
    const video = document.createElement('video')
    const url = URL.createObjectURL(blob)
    video.muted = true
    video.preload = 'auto'
    video.src = url
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('视频读取超时')), 15000)
        video.onloadeddata = () => {
          clearTimeout(timer)
          resolve()
        }
        video.onerror = () => {
          clearTimeout(timer)
          reject(new Error('视频无法解码'))
        }
      })
      if (!thumbnail)
        return {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          fileSize: blob.size,
          format: blob.type.split('/')[1],
          detectedFormat: blob.type.split('/')[1],
        }
      const scale = Math.min(
        1,
        640 / Math.max(video.videoWidth, video.videoHeight),
      )
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      canvas
        .getContext('2d')
        .drawImage(video, 0, 0, canvas.width, canvas.height)
      return await new Promise((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error('视频封面生成失败')),
          'image/webp',
          0.8,
        ),
      )
    } finally {
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  }

  async function acquire(value, thumbnail = false) {
    if (!isSource(value)) return { src: value, release() {} }
    const id = idOf(value)
    const key = `${thumbnail ? 'thumb' : 'full'}:${id}`
    let entry = cache.get(key)
    if (!entry) {
      entry = { id, users: 0, bytes: 0, retired: false, url: '' }
      cache.set(key, entry)
      const current = entry
      const generation = epoch
      current.promise = limited(async () => {
        let blob
        if (thumbnail) blob = (await get(thumbnails, id))?.blob
        if (!blob) {
          let original
          try {
            original = await readBlob(value)
          } catch (error) {
            const record = await get(options.storeName, id)
            if (!/^https?:\/\//i.test(record?.src || '')) throw error
            current.url = record.src
            return current.url
          }
          if (thumbnail) {
            try {
              blob = await createThumbnail(original)
              if (generation === epoch && !current.retired)
                backgroundWrite((tx) => {
                  const request = tx.objectStore(options.storeName).getKey(id)
                  request.onsuccess = () => {
                    if (
                      generation === epoch &&
                      !current.retired &&
                      request.result !== undefined
                    )
                      tx.objectStore(thumbnails).put({ id, blob, version: 1 })
                  }
                })
            } catch {
              blob = original
            }
          } else blob = original
        }
        current.url = URL.createObjectURL(blob)
        current.bytes = blob.size
        if (generation !== epoch || (current.retired && !current.users)) {
          URL.revokeObjectURL(current.url)
          throw new Error('图片已失效')
        }
        return current.url
      })
    }
    entry.users++
    cache.delete(key)
    cache.set(key, entry)
    let released = false
    const release = () => {
      if (released) return
      released = true
      entry.users--
      if (entry.retired && !entry.users && entry.url)
        URL.revokeObjectURL(entry.url)
      trim()
    }
    try {
      const src = await entry.promise
      trim()
      return { src, release }
    } catch (error) {
      release()
      if (cache.get(key) === entry) cache.delete(key)
      throw error
    }
  }

  async function display(element, binding) {
    const version = ++binding.version
    binding.release?.()
    binding.release = undefined
    try {
      const result = await acquire(binding.value, binding.thumbnail)
      if (
        binding.version !== version ||
        !binding.visible ||
        !element.isConnected
      ) {
        result.release()
        return
      }
      binding.release = result.release
      element.src = result.src
    } catch {
      /* 图片暂不可用时保留占位, 再次进入视口时重试 */
    }
  }

  function bindImage(element, value, thumbnail = true) {
    const previous = bindings.get(element)
    if (previous?.value === value && previous.thumbnail === thumbnail) return
    unbindImage(element)
    if (!value) {
      element.removeAttribute('src')
      return
    }
    if (!isSource(value)) {
      if (element.getAttribute('src') !== value) element.src = value
      return
    }
    element.dataset.imageId = idOf(value)
    if (thumbnail) element.src = placeholder
    else element.removeAttribute('src')
    const binding = { value, thumbnail, visible: false, version: 0 }
    if (!thumbnail && element instanceof HTMLImageElement) {
      binding.onLoad = () => {
        if (!element.naturalWidth || element.src === binding.placeholder) return
        // 释放离屏原图时保留固有尺寸, 避免消息塌陷后反复触发懒加载。
        binding.placeholder =
          'data:image/svg+xml,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${element.naturalWidth}" height="${element.naturalHeight}"></svg>`,
          )
      }
      element.addEventListener('load', binding.onLoad)
    }
    bindings.set(element, binding)
    if (!observer && typeof IntersectionObserver !== 'undefined')
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const target = entry.target
            const current = bindings.get(target)
            if (!current) continue
            current.visible = entry.isIntersecting
            if (current.visible) display(target, current)
            else {
              current.version++
              current.release?.()
              current.release = undefined
              if (current.thumbnail) target.src = placeholder
              else {
                target.pause?.()
                if (current.placeholder) target.src = current.placeholder
                else target.removeAttribute('src')
              }
            }
          }
        },
        { rootMargin: '300px' },
      )
    if (observer) observer.observe(element)
    else {
      binding.visible = true
      display(element, binding)
    }
  }

  function unbindImage(element) {
    element.pause?.()
    observer?.unobserve(element)
    const binding = bindings.get(element)
    if (binding) {
      if (binding.onLoad) element.removeEventListener('load', binding.onLoad)
      binding.version++
      binding.release?.()
      bindings.delete(element)
    }
  }

  async function writeRecords(records = [], deleted = [], replace = false) {
    const generation = epoch
    if (replace && !records.length) {
      epoch++
      memory.clear()
      for (const entry of cache.values()) retire(entry)
      cache.clear()
      await transaction((tx) => {
        for (const name of stores) tx.objectStore(name).clear()
      })
      return []
    }
    const saved = []
    for (const record of records) {
      if (generation !== epoch) throw new Error('图片存储已重置')
      if (record.type !== 'image') {
        await transaction((tx) => tx.objectStore(options.storeName).put(record))
        saved.push(record)
        continue
      }
      const original = record.src
      const referenced = isSource(original)
      const sameReference = referenced && idOf(original) === record.id
      const hasData = original?.startsWith('data:')
      const blob = hasData
        ? await decode(original)
        : referenced && !sameReference
          ? await readBlob(original)
          : undefined
      const hash =
        sameReference && record.fingerprint
          ? record.fingerprint
          : await fingerprint(original)
      const stored = {
        ...record,
        src: referenced || hasData ? '' : original,
        hasBlob: Boolean(blob) || record.hasBlob,
        fingerprint: hash,
      }
      if (generation !== epoch) throw new Error('图片存储已重置')
      await transaction((tx) => {
        const store = tx.objectStore(options.storeName)
        if (sameReference) {
          // 旧记录尚未迁移时保留其原图, 只更新调用方传来的元数据。
          const request = store.get(record.id)
          request.onsuccess = () => {
            const previous = request.result
            store.put({
              ...stored,
              src: previous?.src || '',
              hasBlob: previous?.hasBlob || stored.hasBlob,
              fingerprint: stored.fingerprint || previous?.fingerprint,
            })
          }
        } else {
          store.put(stored)
          tx.objectStore(thumbnails).delete(record.id)
          if (blob) tx.objectStore(assets).put({ id: record.id, blob })
          else tx.objectStore(assets).delete(record.id)
        }
      })
      memory.delete(record.id)
      if (!sameReference) invalidate(record.id)
      saved.push(metadata(stored))
      await pause()
    }
    const remove = new Set(deleted)
    if (replace) {
      const keep = new Set(records.map((record) => record.id))
      const db = await open()
      const keys = await new Promise((resolve, reject) => {
        const request = db
          .transaction(options.storeName)
          .objectStore(options.storeName)
          .getAllKeys()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      for (const id of keys) if (!keep.has(id)) remove.add(id)
    }
    if (remove.size) {
      await transaction((tx) => {
        for (const id of remove)
          for (const name of stores) tx.objectStore(name).delete(id)
      })
      for (const id of remove) {
        memory.delete(id)
        invalidate(id)
      }
    }
    return saved
  }

  // IndexedDB 不可用时, 仅保留本次页面产生的数据。
  function retain(record) {
    memory.set(record.id, record)
  }
  async function putAsset(id, blob) {
    await transaction((tx) => tx.objectStore(assets).put({ id, blob }))
    return source(id)
  }
  async function deleteAssets(ids) {
    await transaction((tx) => {
      for (const id of ids) tx.objectStore(assets).delete(id)
    })
  }
  return {
    open,
    readRecords,
    writeRecords,
    metadata,
    readBlob,
    dataUrl,
    fingerprint,
    sameSource,
    includesSource,
    isSource,
    source,
    acquire,
    placeholder,
    retain,
    bindImage,
    unbindImage,
    putAsset,
    deleteAssets,
    videoFrame,
    previewDataUrl,
  }
}
