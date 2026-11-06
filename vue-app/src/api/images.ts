import type { ImageConfig, PreparedReference, Settings } from '../types/models'
import type { ParsedImageResponse } from '../types/image-worker'
import {
  apiFetch,
  buildApiEndpoint,
  normalizeProxyUrl,
  routeApiRequest,
} from './client'
import { runImageWorker } from '../workers/client'
import { parseImageResponse } from '../utils/image-response'

export interface GeneratedResponse {
  images: ParsedImageResponse['images']
  meta: Record<string, unknown>
  upstream: Record<string, unknown>
}
type ImageRequestPhase = 'uploading' | 'waiting' | 'parsing'

function sendImageEditRequest(
  endpoint: string,
  options: RequestInit,
  settings: Settings,
  onUploaded: () => void,
) {
  return new Promise<Response>((resolve, reject) => {
    let routed: ReturnType<typeof routeApiRequest>
    try {
      routed = routeApiRequest(endpoint, options, settings)
    } catch (error) {
      reject(error)
      return
    }
    const request = new XMLHttpRequest()
    const signal = options.signal
    let responseReceived = false
    let settled = false
    const abort = () => request.abort()
    const removeAbortListener = () =>
      signal?.removeEventListener('abort', abort)
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      removeAbortListener()
      reject(error)
    }
    request.open(routed.options.method || 'POST', routed.endpoint)
    new Headers(routed.options.headers || {}).forEach((value, name) =>
      request.setRequestHeader(name, value),
    )
    request.upload.onloadend = () => {
      if (!responseReceived) onUploaded()
    }
    request.onerror = () =>
      fail(
        new Error(
          settings.proxyEnabled
            ? `无法连接本地代理 ${normalizeProxyUrl(settings.proxyUrl)}, 请先启动代理服务`
            : '网络请求失败, 请检查接口地址和跨域设置',
        ),
      )
    request.onabort = () => fail(new DOMException('请求已中断', 'AbortError'))
    request.onload = () => {
      responseReceived = true
      if (request.status === 0) {
        fail(new Error('网络请求失败, 请检查接口地址和跨域设置'))
        return
      }
      const headers = new Headers()
      request
        .getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/)
        .filter(Boolean)
        .forEach((line) => {
          const separator = line.indexOf(':')
          if (separator > 0)
            headers.append(
              line.slice(0, separator).trim(),
              line.slice(separator + 1).trim(),
            )
        })
      settled = true
      removeAbortListener()
      resolve(
        new Response(request.responseText, {
          status: request.status,
          statusText: request.statusText,
          headers,
        }),
      )
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      request.abort()
      return
    }
    request.send(routed.options.body as XMLHttpRequestBodyInit)
  })
}

export class ImageRequestError extends Error {
  constructor(
    message: string,
    public upstream: Record<string, unknown>,
  ) {
    super(message)
  }
}
export function imageRequestBody(config: ImageConfig, prompt: string) {
  const body: Record<string, string | number> = {
    model: config.model,
    prompt,
    n: config.countMode === 'parallel' ? 1 : config.count,
    moderation: config.moderation || 'auto',
  }
  if (config.size !== 'auto') body.size = config.size
  if (config.quality !== 'auto') body.quality = config.quality
  if (config.reasoningEffort && config.reasoningEffort !== 'auto')
    body.reasoning_effort = config.reasoningEffort
  if (config.background !== 'auto' && config.backgroundMode === 'parameter')
    body.background = config.background
  if (config.format !== 'png') body.output_format = config.format
  if (['gif', 'svg'].includes(config.format)) body.response_format = 'url'
  if (['jpeg', 'webp'].includes(config.format))
    body.output_compression = config.compression
  return body
}
export async function requestImages(
  settings: Settings,
  config: ImageConfig,
  prompt: string,
  references: PreparedReference[],
  signal: AbortSignal,
  onPhase?: (phase: ImageRequestPhase) => void,
): Promise<GeneratedResponse> {
  const isEdit = config.requestType
    ? config.requestType === 'edit'
    : references.length > 0
  if (
    isEdit &&
    ['gif', 'svg'].includes(config.format) &&
    references.some(
      (reference) =>
        !['image/png', 'image/jpeg', 'image/webp'].includes(
          reference.file.type,
        ),
    )
  )
    throw new Error('GIF/SVG 改图仅支持 PNG、JPEG 或 WebP 参考图')
  const endpoint = buildApiEndpoint(
    settings.imageBaseUrl,
    isEdit ? '/images/edits' : '/images/generations',
  )
  const body = imageRequestBody(config, prompt)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${settings.imageApiKey}`,
  }
  let data: string | FormData
  if (isEdit && references.length) {
    const form = new FormData()
    Object.entries(body).forEach(([key, value]) =>
      form.append(key, String(value)),
    )
    references.forEach((reference) =>
      form.append(
        references.length === 1 ? 'image' : 'image[]',
        reference.file,
        reference.file.name,
      ),
    )
    data = form
  } else {
    headers['Content-Type'] = 'application/json'
    data = JSON.stringify({
      ...body,
      ...(references.length
        ? { image: references.map((reference) => reference.data) }
        : {}),
    })
  }
  const options: RequestInit = {
    method: 'POST',
    headers,
    body: data,
    signal,
  }
  let response: Response
  if (references.length) {
    onPhase?.('uploading')
    response = await sendImageEditRequest(endpoint, options, settings, () =>
      onPhase?.('waiting'),
    )
  } else {
    onPhase?.('waiting')
    response = await apiFetch(endpoint, options, settings)
  }
  onPhase?.('parsing')
  const raw = await response.text()
  let result: ParsedImageResponse
  try {
    result = await runImageWorker('parseImageResponse', {
      raw,
      endpoint,
      isEdit,
    })
  } catch {
    result = parseImageResponse(raw, endpoint, isEdit)
  }
  const upstream = {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers),
    body: result.apiResponse,
    receivedAt: Date.now(),
  }
  const model =
    result.responseModel ||
    response.headers.get('x-model') ||
    response.headers.get('x-openai-model') ||
    ''
  if (!response.ok || !result.parsed)
    throw new ImageRequestError(
      result.errorMessage || `接口返回 ${response.status}`,
      upstream,
    )
  if (!result.images.length)
    throw new ImageRequestError('接口没有返回图片地址', upstream)
  return {
    images: result.images.map((image) => ({
      ...image,
      responseMeta: {
        ...image.responseMeta,
        model: image.responseMeta.model || model,
      },
    })),
    meta: {
      source: endpoint,
      model,
      created: result.created,
      usage: result.usage,
      id: result.id,
      status: response.status,
      moderationSent: true,
      apiResponse: result.apiResponse,
      upstreamResponse: upstream,
      requestType: isEdit ? 'edit' : 'generation',
      requestId: response.headers.get('x-request-id') || '',
    },
    upstream,
  }
}
