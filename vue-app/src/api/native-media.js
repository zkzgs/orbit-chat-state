export function nativeEndpoint(base, suffix, provider) {
  const url = new URL(base)
  let path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(?:images|videos)\/(?:generations|edits)$/, '')
    .replace(/\/models(?:\/.*)?$/, '')
  if (!path) path = provider === 'gemini' ? '/v1beta' : '/v1'
  url.pathname = path + suffix
  return url.href
}

export function nativeMediaRequest(settings, config, prompt, references) {
  const provider = config.provider || settings.imageProvider
  const video = config.mediaType === 'video'
  if (provider === 'gemini') {
    if (video) throw new Error('Gemini 原生图片接口不支持视频')
    const parts = [{ text: prompt }]
    for (const reference of references) {
      const match = reference.data.match(/^data:([^;]+);base64,(.*)$/s)
      if (!match) throw new Error('Gemini 参考图需要 Base64 图片')
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } })
    }
    const imageConfig = {}
    if (config.ratio && config.ratio !== 'auto')
      imageConfig.aspectRatio = config.ratio
    if (config.sizeMode !== 'auto' && config.resolution)
      imageConfig.imageSize = config.resolution.toUpperCase()
    return {
      endpoint: nativeEndpoint(
        settings.imageBaseUrl,
        `/models/${encodeURIComponent(config.model.replace(/^models\//, ''))}:generateContent`,
        provider,
      ),
      body: {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
        },
      },
    }
  }
  const body = {
    model: config.model,
    prompt: prompt.replace(
      /\[image (\d+)\]/g,
      (_, number) => `<IMAGE_${Number(number) - 1}>`,
    ),
  }
  if (config.ratio && config.ratio !== 'auto' && references.length !== 1)
    body.aspect_ratio = config.ratio
  if (video) {
    body.duration = config.videoDuration || 8
    body.resolution = config.videoResolution || '720p'
    if (references.length === 1) body.image = { url: references[0].data }
    else if (references.length)
      body.reference_images = references.map((item) => ({ url: item.data }))
  } else {
    body.n = config.countMode === 'parallel' ? 1 : config.count
    body.response_format = 'b64_json'
    if (config.sizeMode !== 'auto' && config.resolution)
      body.resolution = config.resolution.toLowerCase()
    if (references.length === 1) body.image = { url: references[0].data }
    else if (references.length)
      body.images = references.map((item) => ({ url: item.data }))
  }
  return {
    endpoint: nativeEndpoint(
      settings.imageBaseUrl,
      video
        ? '/videos/generations'
        : references.length
          ? '/images/edits'
          : '/images/generations',
      provider,
    ),
    body,
  }
}

export function mediaAudit(value, key = '') {
  if (
    typeof value === 'string' &&
    (value.startsWith('data:') || ['data', 'b64_json'].includes(key)) &&
    value.length > 200
  )
    return `[媒体正文已独立缓存, ${value.length} 个字符]`
  if (Array.isArray(value)) return value.map((item) => mediaAudit(item))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        mediaAudit(item, name),
      ]),
    )
  return value
}

export async function listGeminiModels(fetchApi, settings, signal) {
  const result = []
  let token = ''
  do {
    const url = new URL(
      nativeEndpoint(settings.imageBaseUrl, '/models', 'gemini'),
    )
    url.searchParams.set('pageSize', '100')
    if (token) url.searchParams.set('pageToken', token)
    const response = await fetchApi(
      url.href,
      { headers: { 'x-goog-api-key': settings.imageApiKey }, signal },
      settings,
    )
    const payload = await response.json()
    if (!response.ok)
      throw new Error(payload.error?.message || `接口返回 ${response.status}`)
    result.push(
      ...(payload.models || []).map((model) =>
        model.name.replace(/^models\//, ''),
      ),
    )
    token = payload.nextPageToken || ''
  } while (token)
  return result
}

export async function requestNativeMedia(
  fetchApi,
  settings,
  config,
  prompt,
  references,
  signal,
  onPhase,
  onSent,
  onRemote,
) {
  const provider = config.provider || settings.imageProvider
  const request = nativeMediaRequest(settings, config, prompt, references)
  const headers = {
    'Content-Type': 'application/json',
    ...(provider === 'gemini'
      ? { 'x-goog-api-key': settings.imageApiKey }
      : { Authorization: `Bearer ${settings.imageApiKey}` }),
  }
  const events = []
  async function send(endpoint, init) {
    const response = await fetchApi(
      endpoint,
      { ...init, headers, signal },
      settings,
      init.method === 'POST' ? onSent : undefined,
    )
    onPhase?.('parsing')
    const raw = await response.text()
    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = { error: { message: raw.slice(0, 500) || '接口未返回 JSON' } }
    }
    const upstream = {
      endpoint,
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: mediaAudit(payload),
      receivedAt: Date.now(),
    }
    events.push(upstream)
    if (!response.ok || payload.error) {
      const error = new Error(
        payload.error?.message || `接口返回 ${response.status}`,
      )
      error.upstream = { responses: events }
      error.upstreamResponse = error.upstream
      throw error
    }
    return payload
  }
  onPhase?.(references.length ? 'uploading' : 'waiting')
  let payload = await send(request.endpoint, {
    method: 'POST',
    body: JSON.stringify(request.body),
  })
  if (payload.request_id) {
    const id = payload.request_id
    await onRemote?.({ requestId: id, response: events[events.length - 1] })
    while (true) {
      onPhase?.('waiting')
      await new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason)
          return
        }
        const abort = () => {
          clearTimeout(timer)
          reject(signal.reason)
        }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort)
          resolve()
        }, 3000)
        signal.addEventListener('abort', abort, { once: true })
      })
      payload = await send(
        nativeEndpoint(
          settings.imageBaseUrl,
          `/${config.mediaType === 'video' ? 'videos' : 'images'}/${encodeURIComponent(id)}`,
          provider,
        ),
        { method: 'GET' },
      )
      if (payload.status === 'failed' || payload.status === 'expired') {
        const error = new Error(payload.error?.message || '上游生成失败')
        error.upstream = { responses: events }
        error.upstreamResponse = error.upstream
        throw error
      }
      if (payload.status === 'done') break
      onPhase?.(
        payload.progress == null
          ? 'waiting'
          : `等待上游中 · ${payload.progress}%`,
      )
    }
  }
  let images
  if (provider === 'gemini') {
    images = (payload.candidates || []).flatMap((candidate) =>
      (candidate.content?.parts || []).flatMap((part) => {
        const image = part.inlineData
        return image?.data && image.mimeType?.startsWith('image/')
          ? [
              {
                src: `data:${image.mimeType};base64,${image.data}`,
                responseMeta: {
                  output_format: image.mimeType.split('/')[1],
                  model: payload.modelVersion,
                },
              },
            ]
          : []
      }),
    )
  } else if (config.mediaType === 'video') {
    images = payload.video?.url
      ? [
          {
            src: payload.video.url,
            responseMeta: {
              mediaType: 'video',
              duration: payload.video.duration,
              output_format: 'mp4',
            },
          },
        ]
      : []
  } else {
    images = (payload.data || [])
      .map((image) => {
        const mime =
          image.mime_type ||
          (image.b64_json?.startsWith('iVBOR')
            ? 'image/png'
            : image.b64_json?.startsWith('UklGR')
              ? 'image/webp'
              : 'image/jpeg')
        return {
          src: image.b64_json
            ? `data:${mime};base64,${image.b64_json}`
            : image.url,
          responseMeta: {
            ...mediaAudit(image),
            output_format: image.output_format || mime.split('/')[1],
          },
        }
      })
      .filter((item) => item.src)
  }
  const upstream = { responses: events }
  if (!images.length) {
    const error = new Error(
      payload.promptFeedback?.blockReason ||
        payload.candidates?.[0]?.finishMessage ||
        payload.candidates?.[0]?.finishReason ||
        '接口没有返回生成结果',
    )
    error.upstream = upstream
    error.upstreamResponse = upstream
    throw error
  }
  return {
    images,
    upstream,
    meta: {
      provider,
      model: payload.model || payload.modelVersion || config.model,
      source: request.endpoint,
      requestType:
        config.mediaType === 'video'
          ? 'video'
          : references.length
            ? 'edit'
            : 'generation',
      usage: payload.usage || payload.usageMetadata,
      upstreamResponse: upstream,
      apiResponse: mediaAudit(payload),
      requestLog: {
        endpoint: request.endpoint,
        method: 'POST',
        contentType: 'application/json',
        body: mediaAudit(request.body),
      },
    },
  }
}
