import { defineStore } from 'pinia'
import { computed, markRaw, nextTick, reactive, ref, watch } from 'vue'
import { useWorkspaceStore } from './workspace'
import { useInterfaceStore } from './interface'
import { requestChat, type ChatRequestMessage } from '../api/chat'
import { createId } from '../utils/id'
import { cloneData } from '../utils/clone'
import { prepareReferences, readReference } from '../utils/images'
import { chatImageContent } from '../api/chat-images.js'
import { readChatFiles, chatDocuments } from '../api/chat-files.js'
import { errorMessage, formatTime } from '../utils/format'
import { downloadFile } from '../utils/files'
import { escapeHtml, renderMarkdown } from '../utils/markdown'
import type {
  Message,
  ChatFile,
  ReferenceImage,
  ImageOptions,
  ConversationChatContext,
  Settings,
} from '../types/models'
import { imageStorage } from '../storage/database'
import { agentMessages, runImageAgent } from '../api/image-agent.js'
import { apiFetch, buildApiEndpoint } from '../api/client'
import { useImageGenerationStore } from './image-generation'
import { imageSize } from '../utils/image-options'
import {
  clearChatDrafts,
  readChatDraft,
  removeChatDraft,
  saveChatDraft,
} from '../storage/input-drafts.js'

export const useChatStore = defineStore('chat', () => {
  const workspace = useWorkspaceStore()
  const ui = useInterfaceStore()
  const runs = reactive(
    new Map<
      string,
      {
        controller: AbortController
        streamingId: string
        activity: { status: string; prompt: string } | null
      }
    >(),
  )
  const activeRun = computed(() =>
    runs.get(workspace.state.activeConversationId || ''),
  )
  const generating = computed(() => Boolean(activeRun.value))
  const generatingConversationId = computed(() =>
    generating.value ? workspace.state.activeConversationId : '',
  )
  const agentActivity = computed(() => activeRun.value?.activity || null)
  const streamingId = computed(() => activeRun.value?.streamingId || '')
  function isGenerating(id: string) {
    return runs.has(id)
  }
  const conversationSelectionMode = ref(false)
  const selectedConversations = ref(new Set<string>())
  const selectableConversations = computed(() =>
    workspace.state.conversations.filter((item) => !isGenerating(item.id)),
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
  const drafts = reactive(
    new Map<
      string,
      {
        text: string
        attachments: ReferenceImage[]
        files: ChatFile[]
        editingId: string
      }
    >(),
  )
  const draft = ref(
    workspace.state.settings.persistInputContent
      ? readChatDraft(workspace.state.activeConversationId || '') || ''
      : '',
  )
  const attachments = ref<ReferenceImage[]>([])
  const files = ref<ChatFile[]>([])
  const mentionImages = computed(() => {
    const messages = workspace.activeConversation?.messages || []
    const outputs = new Set(
      messages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => message.imageIds || []),
    )
    const ids = [
      ...new Set(messages.flatMap((message) => message.imageIds || [])),
    ]
    const images: ReferenceImage[] = workspace
      .messageImages(ids)
      .filter((image) => image.mediaType !== 'video')
      .map((image) => ({
        id: image.id,
        imageId: image.id,
        data: image.src,
        name: image.name || '对话图片',
        origin: outputs.has(image.id) ? '输出' : '输入',
      }))
    const seen = new Set(images.map((image) => image.id))
    for (const reference of attachments.value) {
      const id = reference.imageId || reference.id
      if (seen.has(id)) continue
      seen.add(id)
      images.push({
        ...reference,
        id,
        imageId: reference.imageId,
        origin: outputs.has(id) ? '输出' : '输入',
      })
    }
    return images
  })
  const editingId = ref('')
  watch(
    () => workspace.state.activeConversationId,
    (id, previous) => {
      if (
        previous &&
        workspace.state.conversations.some((item) => item.id === previous)
      ) {
        drafts.set(previous, {
          text: draft.value,
          attachments: [...attachments.value],
          files: [...files.value],
          editingId: editingId.value,
        })
        if (workspace.state.settings.persistInputContent)
          saveChatDraft(previous, draft.value)
      }
      const saved = id ? drafts.get(id) : undefined
      draft.value =
        saved?.text ||
        (id && workspace.state.settings.persistInputContent
          ? readChatDraft(id)
          : '') ||
        ''
      attachments.value = saved ? [...saved.attachments] : []
      files.value = saved ? [...saved.files] : []
      editingId.value = saved?.editingId || ''
    },
    { flush: 'sync' },
  )
  watch(
    draft,
    (value) => {
      if (!workspace.state.settings.persistInputContent) return
      const id = workspace.state.activeConversationId
      if (id) saveChatDraft(id, value)
    },
    { flush: 'sync' },
  )
  watch(
    () => workspace.state.settings.persistInputContent,
    (enabled) => {
      if (enabled) {
        for (const [id, item] of drafts) saveChatDraft(id, item.text)
        const id = workspace.state.activeConversationId
        if (id) saveChatDraft(id, draft.value)
      } else clearChatDrafts()
    },
    { immediate: true, flush: 'sync' },
  )
  watch(
    () => workspace.state.conversations.map((item) => item.id),
    (ids, previous = []) => {
      for (const id of previous)
        if (!ids.includes(id)) {
          drafts.delete(id)
          removeChatDraft(id)
        }
    },
    { flush: 'sync' },
  )
  watch(
    () =>
      [
        ...attachments.value,
        ...[...drafts.entries()]
          .filter(([id]) => id !== workspace.state.activeConversationId)
          .flatMap(([, item]) => item.attachments),
      ]
        .map(
          (item) =>
            item.imageId ||
            (imageStorage.isSource(item.data)
              ? item.data.slice('orbit-image:'.length)
              : ''),
        )
        .filter(Boolean),
    (ids) => {
      workspace.chatDraftIds = ids
    },
    { immediate: true, flush: 'sync' },
  )
  watch(
    () =>
      [
        ...files.value,
        ...[...drafts.values()].flatMap((item) => item.files),
      ].map((file) => file.id),
    (ids) => {
      workspace.chatFileDraftIds = ids
    },
    { immediate: true, flush: 'sync' },
  )
  const stickToBottomTick = ref(0)
  function snapshotChatContext(
    previous = workspace.activeConversation?.chatContext,
  ): ConversationChatContext {
    const {
      chatModel,
      systemPrompt,
      reasoningEffort,
      chatStream,
      chatWebSearch,
      chatImageTools,
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
        chatImageTools,
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
      'chatImageTools',
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
    if (!source || isGenerating(id)) return
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
    if (workspace.state.activeConversationId)
      drafts.delete(workspace.state.activeConversationId)
    draft.value = ''
    attachments.value = []
    files.value = []
    editingId.value = ''
  }
  function newConversation() {
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
      updatedAt: Date.now(),
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
    item.updatedAt = Date.now()
  }
  async function deleteConversation(id: string) {
    const conversation = workspace.state.conversations.find(
      (item) => item.id === id,
    )
    if (!conversation || !window.confirm(`删除对话“${conversation.title}”?`))
      return
    stop(id)
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
    files.value = [...(message.files || [])]
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
      const outputs = new Set(
        workspace.activeConversation.messages
          .filter((message) => message.role === 'assistant')
          .flatMap((message) => message.imageIds || []),
      )
      const fingerprint = outputs.size
        ? await imageStorage.fingerprint(reference.data)
        : ''
      for (const image of workspace.messageImages([...outputs])) {
        const key =
          image.fingerprint || (await imageStorage.fingerprint(image.src))
        if (
          key === fingerprint &&
          (await imageStorage.sameSource(image.src, reference.data))
        ) {
          reference.imageId = image.id
          break
        }
      }
      if (
        !(await imageStorage.includesSource(attachments.value, reference.data))
      )
        attachments.value.push(reference)
      if (attachments.value.length >= 16) break
    }
  }
  async function addTextFile(file?: File) {
    if (!file) return
    return addTextFiles([file])
  }
  async function addTextFiles(selectedFiles: File[]) {
    if (!selectedFiles.length) return
    const conversationId = workspace.state.activeConversationId
    try {
      const result = await readChatFiles(
        selectedFiles,
        draft.value.length,
        files.value,
      )
      if (workspace.state.activeConversationId !== conversationId) return
      if (result.text)
        draft.value += `${draft.value ? '\n\n' : ''}${result.text}`
      files.value.push(...result.documents)
    } catch (error) {
      ui.notify(errorMessage(error), 'error')
    }
  }
  async function referenceImage(id: string) {
    const index = mentionImages.value.findIndex((image) => image.id === id)
    if (index < 0) return
    const token = `@图${index + 1}`
    draft.value += `${draft.value && !/\s$/.test(draft.value) ? ' ' : ''}${token} `
    await nextTick()
    const input = document.getElementById('messageInput') as HTMLTextAreaElement
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }
  function stop(id = workspace.state.activeConversationId) {
    if (id) runs.get(id)?.controller.abort()
  }
  function stopAll() {
    for (const run of runs.values()) run.controller.abort()
    runs.clear()
  }
  async function buildMessages(
    conversationId: string,
    settings: Settings,
    contextMode: string,
  ): Promise<ChatRequestMessage[]> {
    const conversation = workspace.state.conversations.find(
      (item) => item.id === conversationId,
    )!
    const source =
      contextMode === 'single'
        ? conversation.messages.slice(-1)
        : conversation.messages
    const messages: ChatRequestMessage[] = []
    const imageData = new Map<string, Promise<string>>()
    const readImage = (source: string) => {
      if (!imageData.has(source))
        imageData.set(
          source,
          settings.chatImagePreview
            ? imageStorage.previewDataUrl(source)
            : prepareReferences(
                [{ id: 'chat-image', data: source, name: 'chat-image' }],
                settings,
                true,
              ).then(([image]) => image.data),
        )
      return imageData.get(source)!
    }
    for (const message of source) {
      if (message.toolRounds?.length) messages.push(...agentMessages(message))
      if (message.role === 'assistant' && !message.content.trim()) continue
      const images = workspace
        .messageImages(message.imageIds)
        .filter((image) => image.mediaType !== 'video')
      const current = [...conversation.messages]
        .reverse()
        .find((item) => item.role === 'user')
      const carryImages =
        settings.chatHistoryImages === 'all' || message.id === current?.id
      if (message.role === 'assistant' && carryImages && images.length) {
        messages.push({
          role: 'assistant',
          content: await chatDocuments.content(message.content, message.files),
          ...(message.reasoning
            ? { reasoning_content: message.reasoning }
            : {}),
        })
        messages.push({
          role: 'user',
          content: await chatImageContent(
            {
              ...message,
              role: 'user',
              content: '以下是上一条助手回复生成的图片, 仅作为视觉上下文参考。',
            },
            images,
            true,
            readImage,
          ),
        })
        continue
      }
      messages.push({
        role: message.role,
        ...(message.role === 'assistant' && message.reasoning
          ? { reasoning_content: message.reasoning }
          : {}),
        content: await chatDocuments.content(
          await chatImageContent(message, images, carryImages, readImage),
          message.files,
        ),
      })
    }
    if (settings.systemPrompt)
      messages.unshift({
        role: 'system',
        content: settings.systemPrompt,
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
    if (!content && !attachments.value.length && !files.value.length) return
    const conversation = workspace.activeConversation
    const mentionMatches = [...content.matchAll(/@图(\d+|\?)/g)]
    const mentionReferences = mentionMatches.map((match) => {
      const index = Number(match[1]) - 1
      return match[1] === '?' ? undefined : mentionImages.value[index]
    })
    if (mentionReferences.some((image) => !image)) {
      ui.notify('引用了不存在的图片, 请先修改 @图x', 'error')
      return
    }
    conversation.chatContext = snapshotChatContext()
    const settings = cloneData(workspace.state.settings)
    const config = cloneData(workspace.imageConfig)
    const contextMode = workspace.state.contextMode
    const references = [...attachments.value]
    const documents = [...files.value]
    const edit = editingId.value
    // 发送新消息时强制恢复贴底跟随
    stickToBottomTick.value += 1
    resetDraft()
    const run = reactive({
      controller: markRaw(new AbortController()),
      streamingId: '',
      activity: null as { status: string; prompt: string } | null,
    })
    runs.set(conversation.id, run)
    let streamTimer: ReturnType<typeof setTimeout> | undefined
    const signal = run.controller.signal
    const timeout = setTimeout(
      () => run.controller.abort(),
      settings.chatImageTools ? 1800000 : settings.chatStream ? 300000 : 60000,
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
        run.streamingId = assistant.id
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
      const attachmentIds = new Map<string, string>()
      for (const reference of references) {
        const id =
          reference.imageId ||
          (await workspace.saveImage(reference.data, reference.name))
        imageIds.push(id)
        attachmentIds.set(reference.id, id)
        if (reference.imageId) attachmentIds.set(reference.imageId, id)
      }
      const mentionImageIds = mentionReferences.map(
        (image) => image!.imageId || attachmentIds.get(image!.id) || image!.id,
      )
      if (signal.aborted) throw new DOMException('已暂停生成', 'AbortError')
      if (edit) {
        const index = conversation.messages.findIndex(
          (item) => item.id === edit,
        )
        if (index >= 0) conversation.messages.splice(index)
      }
      const messageImageIds = [
        ...new Set([...imageIds, ...(mentionImageIds as string[])]),
      ]
      const messageFiles = await chatDocuments.save(documents)
      if (signal.aborted) throw new DOMException('已暂停生成', 'AbortError')
      conversation.messages.push({
        id: createId(),
        role: 'user',
        content,
        imageIds: messageImageIds,
        mentionImageIds: mentionImageIds as string[],
        ...(messageFiles.length ? { files: messageFiles } : {}),
        createdAt: Date.now(),
      })
      conversation.updatedAt =
        conversation.messages[conversation.messages.length - 1].createdAt
      if (conversation.title === '新对话')
        conversation.title = content.slice(0, 24) || '图片对话'
      let result: { content: string; reasoning: string }
      if (settings.demoMode || !settings.chatApiKey || !settings.chatBaseUrl) {
        const text = references.length
          ? '我已经收到这张图片。当前是演示模式, 配置真实接口后可以根据图片内容进行分析。'
          : `这是演示模式的回复。\n\n我收到了: “${content}”\n\n在设置中填写对话接口地址和 API Key 后, 这里会切换成真实模型响应。上下文当前使用“${contextMode === 'client' ? '客户端拼接' : '单轮请求'}”`
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
      } else if (settings.chatImageTools) {
        const imageSettings = cloneData(settings)
        const available = conversation.messages
          .flatMap((message) => message.imageIds)
          .filter((id) => workspace.imageMap.get(id)?.mediaType !== 'video')
        result = await runImageAgent({
          fetch: apiFetch,
          settings: {
            ...settings,
            chatBaseUrl: buildApiEndpoint(
              settings.chatBaseUrl,
              '/chat/completions',
            ),
          },
          imageModels: workspace.modelCatalog.image,
          messages: await buildMessages(conversation.id, settings, contextMode),
          imageIds: available,
          signal,
          onChunk: settings.chatStream ? update : undefined,
          onStatus: (activity: { status: string; prompt: string }) => {
            run.activity = activity
          },
          onUnsupportedSearch: () => {
            if (conversation.chatContext)
              conversation.chatContext.settings.chatWebSearch = false
            if (workspace.state.activeConversationId === conversation.id)
              workspace.state.settings.chatWebSearch = false
            ui.notify('当前接口不支持联网参数, 已关闭联网并重试', 'warning')
          },
          preview: (id: string) =>
            imageStorage.previewDataUrl(workspace.imageMap.get(id)!.src),
          generate: (
            text: string,
            ids: string[],
            parameters?: ImageOptions,
          ) => {
            if (!imageSettings.imageApiKey || !imageSettings.imageBaseUrl)
              throw new Error('请先配置生图接口和 API Key')
            return useImageGenerationStore().generate({
              prompt: text,
              config: {
                ...config,
                ...parameters,
                size: parameters ? imageSize(parameters) : config.size,
                mediaType: 'image',
                requestType: ids.length ? 'edit' : 'generation',
              },
              references: workspace.messageImages(ids).map((image) => ({
                id: image.id,
                imageId: image.id,
                data: image.src,
                name: image.name || '对话参考图',
              })),
              signal,
              settings: imageSettings,
            })
          },
          onRound: (round: NonNullable<Message['toolRounds']>[number]) => {
            if (signal.aborted) return
            if (!assistant) applyChunk()
            const rounds = (assistant!.toolRounds ||= [])
            const index = rounds.findIndex(
              (item) =>
                item.assistant.tool_calls[0]?.id ===
                round.assistant.tool_calls[0]?.id,
            )
            if (index >= 0) rounds[index] = round
            else rounds.push(round)
            assistant!.imageIds = [
              ...new Set(
                rounds.flatMap((item) =>
                  item.results.flatMap(
                    (result) => JSON.parse(result.content).imageIds || [],
                  ),
                ),
              ),
            ]
          },
        })
      } else
        result = await requestChat(
          settings,
          await buildMessages(conversation.id, settings, contextMode),
          signal,
          settings.chatStream ? update : undefined,
          () => {
            if (conversation.chatContext)
              conversation.chatContext.settings.chatWebSearch = false
            if (workspace.state.activeConversationId === conversation.id)
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
      } else {
        if (pending.content || pending.reasoning) applyChunk()
        if (!assistant) applyChunk()
        assistant!.error = errorMessage(error)
        ui.notify(assistant!.error, 'error')
      }
    } finally {
      clearTimeout(timeout)
      clearTimeout(streamTimer)
      if (runs.get(conversation.id) === run) runs.delete(conversation.id)
    }
  }
  async function exportConversation(
    format: 'markdown' | 'html',
    id = workspace.state.activeConversationId,
  ) {
    if (ui.exporting) return
    const selected = workspace.state.conversations.find(
      (item) => item.id === id,
    )
    if (!selected?.messages.length) {
      ui.notify('当前对话还没有消息', 'error')
      return
    }
    const conversation = selected
    const exportedImages = new Map<string, string>()
    ui.exporting = true
    Object.assign(ui.exportProgress, {
      active: true,
      label: '正在导出对话',
      percent: 0,
    })
    try {
      await new Promise((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 0)),
      )
      const ids = [
        ...new Set(
          conversation.messages.flatMap((message) => message.imageIds),
        ),
      ]
      if (format === 'html')
        for (const message of conversation.messages)
          for (const image of workspace.messageImages(message.imageIds))
            if (!exportedImages.has(image.id)) {
              exportedImages.set(
                image.id,
                await imageStorage.dataUrl(image.src),
              )
              ui.exportProgress.percent = Math.round(
                (exportedImages.size / Math.max(1, ids.length)) * 90,
              )
            }
      const content = format === 'markdown' ? exportMarkdown() : exportHtml()
      downloadFile(
        content,
        format === 'html'
          ? 'text/html;charset=utf-8'
          : 'text/markdown;charset=utf-8',
        `${conversationFileName(conversation.title)}.${format === 'html' ? 'html' : 'md'}`,
      )
      ui.notify(`当前对话已导出为 ${format === 'html' ? 'HTML' : 'Markdown'}`)
    } catch (error) {
      ui.notify('导出失败: ' + errorMessage(error), 'error')
    } finally {
      ui.exporting = false
      ui.exportProgress.active = false
    }

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
          `## ${role} · ${formatTime(message.createdAt)}\n\n${reasoning}${message.content || ''}${message.error ? '\n\n> 请求失败: ' + message.error : ''}${imageLines ? `\n\n${imageLines}` : ''}`,
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
              return `<figure><img src="${escapeHtml(exportedImages.get(image.id) || '')}" alt="${escapeHtml(name)}"><figcaption>${escapeHtml(name)}</figcaption></figure>`
            })
            .join('')
          const reasoning = message.reasoning
            ? `<details class="message-reasoning"><summary>思考过程</summary><div class="message-reasoning-content">${renderMarkdown(message.reasoning)}</div></details>`
            : ''
          return `<article><header><strong>${role}</strong><time>${escapeHtml(formatTime(message.createdAt))}</time></header>${reasoning}<div class="message-content">${renderMarkdown(message.content || '')}${message.error ? '<p>请求失败: ' + escapeHtml(message.error) + '</p>' : ''}</div>${images ? `<div class="message-images">${images}</div>` : ''}</article>`
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
    stopAll()
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
    files,
    editingId,
    generating,
    generatingConversationId,
    agentActivity,
    mentionImages,
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
    referenceImage,
    addTextFile,
    addTextFiles,
    send,
    stop,
    stopAll,
    isGenerating,
    exportConversation,
    dispose,
  }
})
