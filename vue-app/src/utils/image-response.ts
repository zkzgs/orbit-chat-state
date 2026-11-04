import type { ImageResponse, ParsedImageResponse } from '../types/image-worker'

function detectBase64ImageFormat(encoded: string) {
  try {
    const binary = atob(String(encoded || '').slice(0, 24))
    const bytes = [...binary].map((character) => character.charCodeAt(0))
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    )
      return 'png'
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      return 'jpeg'
    if (binary.slice(0, 6) === 'GIF87a' || binary.slice(0, 6) === 'GIF89a')
      return 'gif'
    if (binary.slice(0, 4) === 'RIFF' && binary.slice(8, 12) === 'WEBP')
      return 'webp'
  } catch {}
  return 'png'
}

function abbreviateResponseValue(value: unknown) {
  const text = String(value || '')
  if (text.length <= 100) return text
  return `${text.slice(0, 42)}...${text.slice(-42)}（共 ${text.length} 个字符）`
}

export function parseImageResponse(
  raw: string,
  endpoint: string,
  hasReference: boolean,
): ParsedImageResponse {
  let payload: ImageResponse = {}
  let parsed = true
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = {}
    parsed = false
  }
  const apiResponse =
    parsed && payload && typeof payload === 'object'
      ? {
          ...payload,
          data: Array.isArray(payload.data)
            ? payload.data.map((item) => {
                if (typeof item === 'string')
                  return abbreviateResponseValue(item)
                if (!item || typeof item !== 'object') return item
                return {
                  ...item,
                  b64_json: item.b64_json
                    ? abbreviateResponseValue(item.b64_json)
                    : item.b64_json,
                  delivery: item.b64_json
                    ? 'b64_json'
                    : item.url
                      ? 'url'
                      : 'unknown',
                  base64Length: item.b64_json?.length || 0,
                }
              })
            : payload.data,
        }
      : raw
  const responseModel = payload?.model || ''
  const images = (payload?.data || [])
    .map((item) => {
      const value = typeof item === 'string' ? item : item?.b64_json
      const detectedFormat = value ? detectBase64ImageFormat(value) : ''
      const meta = typeof item === 'string' ? {} : item
      const source =
        typeof item === 'string'
          ? `data:image/${detectedFormat};base64,${item}`
          : value
            ? `data:image/${detectedFormat};base64,${value}`
            : item?.url || ''
      return {
        src: source,
        responseMeta: {
          id: meta?.id,
          revised_prompt: meta?.revised_prompt,
          model: responseModel || meta?.model || '',
          created: payload.created || meta?.created,
          output_format: meta?.output_format || detectedFormat,
          size: meta?.size,
          source: endpoint,
          requestType: hasReference ? 'edit' : 'generation',
          delivery:
            typeof item === 'string' || meta?.b64_json
              ? 'b64_json'
              : meta?.url
                ? 'url'
                : 'unknown',
          providedUrl: Boolean(meta?.url),
        },
      }
    })
    .filter((item) => item.src)
  return {
    images,
    apiResponse,
    responseModel,
    created: payload.created,
    id: payload.id,
    usage: payload.usage,
    parsed,
    errorMessage:
      payload?.error?.message ||
      payload?.message ||
      payload?.detail ||
      String(raw || '').slice(0, 500),
  }
}
