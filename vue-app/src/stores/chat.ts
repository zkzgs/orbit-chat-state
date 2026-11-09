import { defineStore } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import { useWorkspaceStore } from './workspace'
import { useInterfaceStore } from './interface'
import {
  requestChat,
  type ChatRequestMessage,
  type ImagePart,
} from '../api/chat'
import { createId } from '../utils/id'
import { cloneData } from '../utils/clone'
import { readReference, prepareReferences } from '../utils/images'
import { errorMessage, formatTime } from '../utils/format'
import { downloadFile } from '../utils/files'
import { escapeHtml, renderMarkdown } from '../utils/markdown'
import type {
  Message,
  ReferenceImage,
  ConversationChatContext,
} from '../types/models'

export const useChatStore = defineStore('chat', () => {
  const workspace = useWorkspaceStore()
  const ui = useInterfaceStore()
  const generating = ref(false)
  const generatingConversationId = ref('')
  const conversationSelectionMode = ref(false)
  const selectedConversations = ref(new Set<string>())
  const selectableConversations = computed(() =>
    workspace.state.conversations.filter(
      (item) =>
        !(generating.value && item.id === generatingConversationId.value),
    ),
  )
  const allConversationsSelected = computed(
    () =>
      selectableConversations.value.length > 0 &&
      selectableConversations.value.every((item) =>
        selectedConversations.value.has(item.id),
      ),
  )
  watch(selectableConversations, (items) => {
    const eligible = new Set(items.map((item) => item.id))
    for (const id of selectedConversations.value)
      if (!eligible.has(id)) selectedConversations.value.delete(id)
  })
  function exitConversationSelection() {
    conversationSelectionMode.value = false
    selectedConversations.value.clear()
  }
  function toggleConversationSelection() {
    if (conversationSelectionMode.value) exitConversationSelection()
    else conversationSelectionMode.value = true
  }
  function toggleSelectedConversation(id: string) {
    if (!selectableConversations.value.some((item) => item.id === id)) return
    if (selectedConversations.value.has(id))
      selectedConversations.value.delete(id)
    else selectedConversations.value.add(id)
  }
  function toggleAllConversations() {
    selectedConversations.value = allConversationsSelected.value
      ? new Set()
      : new Set(selectableConversations.value.map((item) => item.id))
  }
  // Batch actions share selection state; future actions can reuse this scope.
  async function deleteSelectedConversations() {
    const ids = new Set(
      selectableConversations.value
        .filter((item) => selectedConversations.value.has(item.id))
        .map((item) => item.id),
    )
    if (
      !ids.size ||
      !window.confirm(`删除选中的 ${ids.size} 个对话？此操作不可撤销。`)
    )
      return
    const activeDeleted = ids.has(workspace.state.activeConversationId || '')
    workspace.state.conversations = workspace.state.conversations.filter(
      (item) => !ids.has(item.id),
    )
    if (activeDeleted) resetDraft()
    if (!workspace.state.conversations.length) newConversation()
    else if (activeDeleted) {
      workspace.state.activeConversationId = workspace.state.conversations[0].id
      applyChatContext(workspace.activeConversation.chatContext)
    }
    exitConversationSelection()
    await workspace.collectUnusedImages()
    ui.notify(`已删除 ${ids.size} 个对话`)
  }
  const draft = ref('')
  const attachments = ref<ReferenceImage[]>([])
  const editingId = ref('')
  const streamingId = ref('')
  const stickToBottomTick = ref(0)
  let controller: AbortController | null = null
  let streamTimer: ReturnType<typeof setTimeout> | undefined
  function snapshotChatContext(
    previous = workspace.activeConversation?.chatContext,
  ): ConversationChatContext {
    const {
      chatModel,
      systemPrompt,
      reasoningEffort,
      chatStream,
      chatWebSearch,
    } = workspace.state.settings
    return {
      ...cloneData(previous || {}),
      settings: {
        ...cloneData(previous?.settings || {}),
        chatModel,
        systemPrompt,
        reasoningEffort,
        chatStream,
        chatWebSearch,
      },
      contextMode: workspace.state.contextMode,
    }
  }
  function applyChatContext(context?: ConversationChatContext) {
    if (!context) return
    for (const key of [
      'chatModel',
      'systemPrompt',
      'reasoningEffort',
      'chatStream',
      'chatWebSearch',
    ] as const) {
      if (context.settings[key] !== undefined)
        Object.assign(workspace.state.settings, {
          [key]: context.settings[key],
        })
    }
    workspace.state.contextMode = context.contextMode
  }
  function duplicateConversation(id: string) {
    const source = workspace.state.conversations.find((item) => item.id === id)
    if (!source || (generating.value && generatingConversationId.value === id))
      return
    if (id === workspace.state.activeConversationId || !source.chatContext)
      source.chatContext = snapshotChatContext()
    const copy = cloneData(source)
    copy.id = createId()
    copy.title = `${source.title}（副本）`
    copy.createdAt = Date.now()
    copy.messages.forEach((message) => {
      message.id = createId()
    })
    workspace.state.conversations.unshift(copy)
    selectConversation(copy.id)
    ui.activeView = 'chat'
    stickToBottomTick.value += 1
    ui.notify('对话已复制')
  }
  function resetDraft() {
    draft.value = ''
    attachments.value = []
    editingId.value = ''
  }
  function newConversation() {
    resetDraft()
    const current = workspace.activeConversation
    if (current?.chatContext) current.chatContext = snapshotChatContext()
    if (current && current.messages.length === 0) {
      ui.activeView = 'chat'
      ui.sidebarOpen = false
      void nextTick(() => document.getElementById('messageInput')?.focus())
      return
    }
    const conversation = {
      id: createId(),
      title: '新对话',
      createdAt: Date.now(),
      messages: [],
    }
    workspace.state.conversations.unshift(conversation)
    workspace.state.activeConversationId = conversation.id
    ui.activeView = 'chat'
    ui.sidebarOpen = false
    void nextTick(() => document.getElementById('messageInput')?.focus())
  }
  function selectConversation(id: string) {
    if (id === workspace.state.activeConversationId) return
    const current = workspace.activeConversation
    if (current?.chatContext) current.chatContext = snapshotChatContext()
    workspace.state.activeConversationId = id
    applyChatContext(workspace.activeConversation.chatContext)
    resetDraft()
    ui.sidebarOpen = false
  }
  function defaultConversationTitle(conversation: { messages: Message[] }) {
    const firstUser = conversation.messages.find((item) => item.role === 'user')
    const text = (firstUser?.content || '').trim()
    return text.slice(0, 24) || '新对话'
  }
  function renameConversation(id: string, title: string) {
    const item = workspace.state.conversations.find((item) => item.id === id)
    if (!item) return
    const trimmed = title.trim()
    item.title = trimmed || defaultConversationTitle(item)
  }
  async function deleteConversation(id: string) {
    const conversation = workspace.state.conversations.find(
      (item) => item.id === id,
    )
    if (!conversation || !window.confirm(`删除对话“${conversation.title}”?`))
      return
    if (generatingConversationId.value === id) stop()
    const wasActive = workspace.state.activeConversationId === id
    if (wasActive) resetDraft()
    workspace.state.conversations = workspace.state.conversations.filter(
      (item) => item.id !== id,
    )
    if (!workspace.state.conversations.length) newConversation()
    else if (wasActive) {
      workspace.state.activeConversationId = workspace.state.conversations[0].id
      applyChatContext(workspace.activeConversation.chatContext)
    }
    await workspace.collectUnusedImages()
    ui.notify('对话已删除')
  }
  function editMessage(message: Message) {
    draft.value = message.content
    editingId.value = message.id
    attachments.value = workspace
      .messageImages(message.imageIds)
      .map((image) => ({
        id: createId(),
        data: image.src,
        imageId: image.id,
        name: image.name || '原消息图片',
      }))
  }
  async function deleteMessage(id: string) {
    if (!window.confirm('删除这条消息?')) return
    workspace.activeConversation.messages =
      workspace.activeConversation.messages.filter((item) => item.id !== id)
    if (editingId.value === id) resetDraft()
    await workspace.collectUnusedImages()
    ui.notify('消息已删除')
  }
  async function addImages(files: File[]) {
    for (const file of files.filter((item) => item.type.startsWith('image/'))) {
      const reference = await readReference(file)
      if (!attachments.value.some((item) => item.data === reference.data))
        attachments.value.push(reference)
      if (attachments.value.length >= 16) break
    }
  }
  async function addTextFile(file?: File) {
    if (!file) return
    draft.value += `${draft.value ? '\n\n' : ''}文件: ${file.name}\n\n${await file.text()}`
  }
  function stop() {
    controller?.abort()
  }
  async function buildMessages(
    conversationId: string,
  ): Promise<ChatRequestMessage[]> {
    const conversation = workspace.state.conversations.find(
      (item) => item.id === conversationId,
    )!
    const source =
      workspace.state.contextMode === 'single'
        ? conversation.messages.slice(-1)
        : conversation.messages
    const messages: ChatRequestMessage[] = []
    for (const message of source) {
      if (message.role === 'assistant' && !message.content.trim()) continue
      const images = workspace.messageImages(message.imageIds)
      if (!images.length)
        messages.push({ role: message.role, content: message.content })
      else {
        const references = images.map((image) => ({
          id: image.id,
          name: image.name || 'chat-image.png',
          data: image.src,
        }))
        const prepared = workspace.state.settings.compressRequestImages
          ? await prepareReferences(references, workspace.state.settings, true)
          : references.map((reference) => ({ data: reference.data }))
        messages.push({
          role: message.role,
          content: [
            { type: 'text', text: message.content },
            ...prepared.map<ImagePart>((image) => ({
              type: 'image_url',
              image_url: { url: image.data },
            })),
          ],
        })
      }
    }
    if (workspace.state.settings.systemPrompt)
      messages.unshift({
        role: 'system',
        content: workspace.state.settings.systemPrompt,
      })
    return messages
  }
  async function send() {
    if (!workspace.ready) return
    if (generating.value) {
      stop()
      return
    }
    const content = draft.value.trim()
    if (!content && !attachments.value.length) return
    const conversation = workspace.activeConversation
    conversation.chatContext = snapshotChatContext()
    const references = [...attachments.value]
    const edit = editingId.value
    // 发送新消息时强制恢复贴底跟随
    stickToBottomTick.value += 1
    resetDraft()
    generating.value = true
    generatingConversationId.value = conversation.id
    streamingId.value = ''
    controller = new AbortController()
    const signal = controller.signal
    const timeout = setTimeout(
      () => controller?.abort(),
      workspace.state.settings.chatStream ? 300000 : 60000,
    )
    let assistant: Message | undefined
    let pending = { content: '', reasoning: '' }
    function applyChunk() {
      clearTimeout(streamTimer)
      streamTimer = undefined
      if (!assistant) {
        assistant = {
          id: createId(),
          role: 'assistant',
          content: '',
          reasoning: '',
          imageIds: [],
          createdAt: Date.now(),
        }
        conversation.messages.push(assistant)
        assistant = conversation.messages[conversation.messages.length - 1]
        streamingId.value = assistant.id
      }
      assistant.content = pending.content
      assistant.reasoning = pending.reasoning
    }
    const update = (text: string, reasoning: string) => {
      pending = { content: text, reasoning }
      if (!assistant) applyChunk()
      else if (!streamTimer) streamTimer = setTimeout(applyChunk, 40)
    }
    try {
      const imageIds: string[] = []
      for (const reference of references)
        imageIds.push(
          reference.imageId ||
            (await workspace.saveImage(reference.data, reference.name)),
        )
      if (signal.aborted) throw new DOMException('已暂停生成', 'AbortError')
      if (edit) {
        const index = conversation.messages.findIndex(
          (item) => item.id === edit,
        )
        if (index >= 0) conversation.messages.splice(index)
      }
      conversation.messages.push({
        id: createId(),
        role: 'user',
        content: content || '请分析这些图片',
        imageIds,
        createdAt: Date.now(),
      })
      if (conversation.title === '新对话')
        conversation.title =
          (content || '请分析这些图片').slice(0, 24) || '图片对话'
      const settings = { ...workspace.state.settings }
      let result: { content: string; reasoning: string }
      if (settings.demoMode || !settings.chatApiKey || !settings.chatBaseUrl) {
        const text = references.length
          ? '我已经收到这张图片。当前是演示模式, 配置真实接口后可以根据图片内容进行分析。'
          : `这是演示模式的回复。\n\n我收到了: “${content}”\n\n在设置中填写对话接口地址和 API Key 后, 这里会切换成真实模型响应。上下文当前使用“${workspace.state.contextMode === 'client' ? '客户端拼接' : '单轮请求'}”`
        if (settings.chatStream) {
          let output = ''
          for (const char of text) {
            if (signal.aborted) break
            output += char
            update(output, '')
            await new Promise((resolve) => setTimeout(resolve, 12))
          }
          result = { content: output, reasoning: '' }
        } else {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 780)
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                reject(new DOMException('已暂停生成', 'AbortError'))
              },
              { once: true },
            )
          })
          result = { content: text, reasoning: '' }
        }
      } else
        result = await requestChat(
          settings,
          await buildMessages(conversation.id),
          signal,
          settings.chatStream ? update : undefined,
          () => {
            workspace.state.settings.chatWebSearch = false
            ui.notify(
              '当前接口不支持 web_search_options, 已关闭联网并重试',
              'warning',
            )
          },
        )
      pending = result
      applyChunk()
    } catch (error) {
      if (signal.aborted) {
        if (pending.content || pending.reasoning) applyChunk()
        ui.notify('已暂停生成')
      } else ui.notify(errorMessage(error), 'error')
    } finally {
      clearTimeout(timeout)
      clearTimeout(streamTimer)
      controller = null
      generating.value = false
      generatingConversationId.value = ''
      streamingId.value = ''
    }
  }
  function exportConversation(format: 'markdown' | 'html') {
    const conversation = workspace.activeConversation
    if (!conversation?.messages.length) {
      ui.notify('当前对话还没有消息', 'error')
      return
    }
    const content = format === 'markdown' ? exportMarkdown() : exportHtml()
    downloadFile(
      content,
      format === 'html'
        ? 'text/html;charset=utf-8'
        : 'text/markdown;charset=utf-8',
      `${conversationFileName(conversation.title)}.${format === 'html' ? 'html' : 'md'}`,
    )
    ui.exportMenuOpen = false
    ui.notify(`当前对话已导出为 ${format === 'html' ? 'HTML' : 'Markdown'}`)

    function exportMarkdown() {
      const sections = [
        `# ${conversation.title}`,
        `> 导出时间：${formatTime(Date.now())}`,
      ]
      conversation.messages.forEach((message) => {
        const role = message.role === 'assistant' ? 'Orbit' : '你'
        const imageLines = workspace
          .messageImages(message.imageIds)
          .map(
            (image, index) =>
              `> 图片 ${index + 1}${image.name ? `：${image.name}` : ''}`,
          )
          .join('\n')
        const reasoning = message.reasoning
          ? `> 思考过程\n> ${message.reasoning.replace(/\n/g, '\n> ')}\n\n`
          : ''
        sections.push(
          `## ${role} · ${formatTime(message.createdAt)}\n\n${reasoning}${message.content || ''}${imageLines ? `\n\n${imageLines}` : ''}`,
        )
      })
      return sections.join('\n\n---\n\n')
    }

    function exportHtml() {
      const messageHtml = conversation.messages
        .map((message) => {
          const role = message.role === 'assistant' ? 'Orbit' : '你'
          const images = workspace
            .messageImages(message.imageIds)
            .map((image, index) => {
              const name = image.name || `图片 ${index + 1}`
              return `<figure><img src="${escapeHtml(image.src)}" alt="${escapeHtml(name)}"><figcaption>${escapeHtml(name)}</figcaption></figure>`
            })
            .join('')
          const reasoning = message.reasoning
            ? `<details class="message-reasoning"><summary>思考过程</summary><div class="message-reasoning-content">${renderMarkdown(message.reasoning)}</div></details>`
            : ''
          return `<article><header><strong>${role}</strong><time>${escapeHtml(formatTime(message.createdAt))}</time></header>${reasoning}<div class="message-content">${renderMarkdown(message.content || '')}</div>${images ? `<div class="message-images">${images}</div>` : ''}</article>`
        })
        .join('\n')
      return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(conversation.title)}</title><style>body{max-width:860px;margin:0 auto;padding:32px 20px;color:#243447;background:#f6f8fb;font:15px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}h1{font-size:24px}h1,article{background:#fff;border:1px solid #dfe6ee;border-radius:10px;padding:18px 20px}article{margin-top:14px}header{display:flex;gap:12px;align-items:baseline;border-bottom:1px solid #edf1f5;padding-bottom:8px}time{color:#718096;font-size:12px}.message-content p{margin:0 0 10px}.message-content p:last-child{margin-bottom:0}.message-content pre{overflow:auto;padding:12px;background:#f1f4f7;border-radius:6px}.message-content code{padding:2px 4px;background:#eef2f5;border-radius:3px}.message-content a{color:#147d92}.message-images{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}figure{margin:0;max-width:360px}figure img{display:block;max-width:100%;max-height:420px;border-radius:7px}figcaption{margin-top:4px;color:#718096;font-size:12px}</style></head><body><h1>${escapeHtml(conversation.title)}</h1>${messageHtml}</body></html>`
    }

    function conversationFileName(title: string) {
      return (
        String(title || '当前对话')
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
          .trim()
          .slice(0, 80) || '当前对话'
      )
    }
  }
  function dispose() {
    stop()
    clearTimeout(streamTimer)
  }
  return {
    conversationSelectionMode,
    selectedConversations,
    allConversationsSelected,
    toggleConversationSelection,
    exitConversationSelection,
    toggleSelectedConversation,
    toggleAllConversations,
    deleteSelectedConversations,
    draft,
    attachments,
    editingId,
    generating,
    generatingConversationId,
    streamingId,
    stickToBottomTick,
    resetDraft,
    newConversation,
    selectConversation,
    renameConversation,
    duplicateConversation,
    deleteConversation,
    editMessage,
    deleteMessage,
    addImages,
    addTextFile,
    send,
    stop,
    exportConversation,
    dispose,
  }
})
