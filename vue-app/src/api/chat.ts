import { apiFetch, chatEndpoint } from './client'
import { isHtmlResponse, readApiChunk, readApiJson, readRequestError } from './request-error.js'
import type { Settings } from '../types/models'
import {
  addUrlCitations,
  applyWebSearch,
  chatReasoningMessages,
  fromResponsesEvent,
  fromResponsesOutput,
  toResponsesBody,
} from './image-agent.js'

export interface TextPart {
  type: 'text'
  text: string
}
export interface ImagePart {
  type: 'image_url'
  image_url: { url: string }
}
export interface FilePart {
  type: 'file'
  file: { filename: string; file_data: string }
}
export interface ChatRequestMessage {
  role: string
  content: string | null | (TextPart | ImagePart | FilePart)[]
  tool_calls?: unknown[]
  tool_call_id?: string
  reasoning_content?: string
}
interface ChatDelta {
  content?: string | { text?: string; content?: string }[]
  reasoning_content?: string
  reasoning?: string
  reasoning_text?: string
  annotations?: unknown[]
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
type Source = { url: string; title: string }
export async function requestChat(
  settings: Settings,
  messages: ChatRequestMessage[],
  signal: AbortSignal,
  onChunk?: (content: string, reasoning: string) => void,
) {
  const body: {
    model: string
    messages: ChatRequestMessage[]
    temperature: number
    stream: boolean
    reasoning_effort?: string
  } = {
    model: settings.chatModel,
    messages: chatReasoningMessages(messages, settings),
    temperature: 0.7,
    stream: Boolean(onChunk),
  }
  if (settings.reasoningEffort !== 'auto')
    body.reasoning_effort = settings.reasoningEffort
  applyWebSearch(body, settings)
  const responses = settings.chatApiFormat === 'responses'
  const response = await apiFetch(
    chatEndpoint(settings),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.chatApiKey}`,
      },
      body: JSON.stringify(responses ? toResponsesBody(body) : body),
      signal,
    },
    settings,
  )
  if (!response.ok || isHtmlResponse(response))
    throw new Error(await readRequestError(response, settings.proxyEnabled))
  if (
    !onChunk ||
    response.headers.get('content-type')?.includes('application/json') ||
    !response.body
  ) {
    let payload = (await readApiJson(response, settings.proxyEnabled)) as ChatPayload
    if (responses) payload = fromResponsesOutput(payload) as ChatPayload
    const result = resultText(payload.choices?.[0]?.message)
    if (!result.content && !result.reasoning)
      throw new Error('接口没有返回可显示的内容')
    onChunk?.(result.content, result.reasoning)
    return {
      ...result,
      sources: addUrlCitations(
        [],
        payload.choices?.[0]?.message?.annotations,
      ) as Source[],
    }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  const sources: Source[] = []
  let finished = false
  function readLine(line: string) {
    if (!line.trim().startsWith('data:')) return
    const data = line.trim().slice(5).trim()
    if (data === '[DONE]') {
      finished = true
      return
    }
    if (!data) return
    let payload: ChatPayload | null
    try {
      payload = JSON.parse(data) as ChatPayload
    } catch {
      return
    }
    if (responses) payload = fromResponsesEvent(payload) as ChatPayload | null
    if (!payload) return
    if (payload.error?.message) throw new Error(payload.error.message)
    for (const item of payload.choices || [])
      addUrlCitations(sources, (item.delta || item.message)?.annotations)
    const choice = payload.choices?.[0]
    const delta = resultText(choice?.delta || choice?.message)
    content += delta.content || choice?.text || ''
    reasoning += delta.reasoning
    onChunk?.(content, reasoning)
  }
  try {
    while (!finished) {
      const next = await readApiChunk(reader, settings.proxyEnabled, response)
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
  return { content, reasoning, sources }
}
