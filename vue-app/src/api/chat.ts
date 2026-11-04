import { apiFetch, buildApiEndpoint } from './client'
import type { Settings } from '../types/models'

export interface TextPart {
  type: 'text'
  text: string
}
export interface ImagePart {
  type: 'image_url'
  image_url: { url: string }
}
export interface ChatRequestMessage {
  role: string
  content: string | (TextPart | ImagePart)[]
}
interface ChatDelta {
  content?: string | { text?: string; content?: string }[]
  reasoning_content?: string
  reasoning?: string
  reasoning_text?: string
}
interface ChatPayload {
  choices?: { delta?: ChatDelta; message?: ChatDelta; text?: string }[]
  error?: { message?: string }
}
export function chatText(value: ChatDelta['content']) {
  return Array.isArray(value)
    ? value.map((part) => part.text || part.content || '').join('')
    : value || ''
}
function resultText(value?: ChatDelta) {
  return {
    content: chatText(value?.content),
    reasoning:
      value?.reasoning_content ||
      value?.reasoning ||
      value?.reasoning_text ||
      '',
  }
}
export async function requestChat(
  settings: Settings,
  messages: ChatRequestMessage[],
  signal: AbortSignal,
  onChunk?: (content: string, reasoning: string) => void,
  onUnsupportedSearch?: () => void,
) {
  const body: {
    model: string
    messages: ChatRequestMessage[]
    temperature: number
    stream: boolean
    reasoning_effort?: string
    web_search_options?: object
  } = {
    model: settings.chatModel,
    messages,
    temperature: 0.7,
    stream: Boolean(onChunk),
  }
  if (settings.reasoningEffort !== 'auto')
    body.reasoning_effort = settings.reasoningEffort
  if (settings.chatWebSearch) body.web_search_options = {}
  const send = () =>
    apiFetch(buildApiEndpoint(settings.chatBaseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.chatApiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })
  let response = await send()
  if (
    !response.ok &&
    body.web_search_options &&
    [400, 404, 422].includes(response.status)
  ) {
    delete body.web_search_options
    onUnsupportedSearch?.()
    response = await send()
  }
  if (!response.ok) {
    const payload = (await response.json()) as ChatPayload
    throw new Error(payload.error?.message || `接口返回 ${response.status}`)
  }
  if (
    !onChunk ||
    response.headers.get('content-type')?.includes('application/json') ||
    !response.body
  ) {
    const payload = (await response.json()) as ChatPayload
    const result = resultText(payload.choices?.[0]?.message)
    if (!result.content && !result.reasoning)
      throw new Error('接口没有返回可显示的内容')
    onChunk?.(result.content, result.reasoning)
    return result
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let finished = false
  function readLine(line: string) {
    if (!line.trim().startsWith('data:')) return
    const data = line.trim().slice(5).trim()
    if (data === '[DONE]') {
      finished = true
      return
    }
    if (!data) return
    let payload: ChatPayload
    try {
      payload = JSON.parse(data) as ChatPayload
    } catch {
      return
    }
    if (payload.error?.message) throw new Error(payload.error.message)
    const choice = payload.choices?.[0]
    const delta = resultText(choice?.delta || choice?.message)
    content += delta.content || choice?.text || ''
    reasoning += delta.reasoning
    onChunk?.(content, reasoning)
  }
  try {
    while (!finished) {
      const next = await reader.read()
      if (next.done) {
        buffer += decoder.decode()
        break
      }
      buffer += decoder.decode(next.value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      lines.forEach(readLine)
    }
    if (!finished && buffer.trim()) readLine(buffer)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  if (!content && !reasoning) throw new Error('接口没有返回可显示的内容')
  return { content, reasoning }
}
