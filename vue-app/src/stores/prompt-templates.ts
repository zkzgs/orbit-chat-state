import { defineStore } from 'pinia'
import { nextTick, reactive, watch } from 'vue'
import { useWorkspaceStore } from './workspace'
import { useInterfaceStore } from './interface'
import { useImageGenerationStore } from './image-generation'
import {
  requestChat,
  type ChatRequestMessage,
  type ImagePart,
} from '../api/chat'
import type { ReferenceImage } from '../types/models'
import { createId } from '../utils/id'
import { errorMessage } from '../utils/format'
import { prepareReferences, readReference } from '../utils/images'
import {
  remapMentions,
  moveReference as reorderReference,
} from '../utils/references'

export const usePromptTemplatesStore = defineStore('prompt-templates', () => {
  const workspace = useWorkspaceStore()
  const ui = useInterfaceStore()
  const image = useImageGenerationStore()
  const polish = reactive({
    source: '',
    instruction: '',
    result: '',
    status: '尚未生成',
    busy: false,
    useGenerationReferences: false,
    generationReferences: [] as ReferenceImage[],
    references: [] as ReferenceImage[],
  })
  let controller: AbortController | null = null
  async function referenceIds(references: ReferenceImage[]) {
    const ids: string[] = []
    for (const reference of references)
      ids.push(
        reference.imageId ||
          (await workspace.saveImage(reference.data, reference.name)),
      )
    return ids
  }
  function referencesFromIds(ids: string[]) {
    return workspace.messageImages(ids).map((item) => ({
      id: createId(),
      data: item.src,
      name: item.name || '模板参考图',
      imageId: item.id,
    }))
  }
  async function selectPrompt(id: string) {
    workspace.state.settings.activeImagePromptTemplateId = id
    const template = workspace.state.settings.imagePromptTemplates.find(
      (item) => item.id === id,
    )
    if (template) {
      const templateImageCount = template.referenceImageIds.length
      const shouldApplyImages =
        templateImageCount > 0 &&
        (!image.references.length ||
          window.confirm(
            `当前已有 ${image.references.length} 张参考图, 此模板包含 ${templateImageCount} 张参考图。是否用模板图片覆盖当前列表?\n\n选择“取消”会保留当前图片, 仍应用模板关键词。`,
          ))
      image.prompt = template.prompt
      if (shouldApplyImages)
        image.references = referencesFromIds(template.referenceImageIds)
      await nextTick()
      document.getElementById('imagePrompt')?.focus()
    }
  }
  async function savePrompt(update = false) {
    if (!image.prompt.trim()) {
      ui.notify('请先填写生图关键词', 'error')
      return
    }
    const templates = workspace.state.settings.imagePromptTemplates
    const active = templates.find(
      (item) =>
        item.id === workspace.state.settings.activeImagePromptTemplateId,
    )
    if (update && !active) {
      ui.notify('请先选择需要更新的关键词模板', 'error')
      return
    }
    const name = update
      ? active?.name
      : window.prompt(
          '请输入关键词模板名称',
          `关键词模板 ${templates.length + 1}`,
        )
    if (name === null || name === undefined) return
    const cleanName = name.trim()
    if (!cleanName) {
      ui.notify('模板名称不能为空', 'error')
      return
    }
    const existing = update
      ? active
      : templates.find(
          (item) => item.name.toLowerCase() === cleanName.toLowerCase(),
        )
    if (
      existing &&
      !update &&
      !window.confirm(`关键词模板 "${existing.name}" 已存在, 覆盖它吗?`)
    )
      return
    const now = Date.now()
    const values = {
      prompt: image.prompt,
      referenceImageIds: await referenceIds(image.references),
      updatedAt: now,
    }
    if (existing) {
      Object.assign(existing, {
        ...values,
        name: cleanName,
        updatedAt: now,
      })
    } else {
      const id = createId()
      templates.push({ id, name: cleanName, createdAt: now, ...values })
      workspace.state.settings.activeImagePromptTemplateId = id
    }
    workspace.state.settings.activeImagePromptTemplateId =
      existing?.id || templates.at(-1)!.id
    await workspace.collectUnusedImages()
    ui.notify(existing ? '关键词模板已覆盖' : '关键词模板已保存')
  }
  async function deletePrompt() {
    const id = workspace.state.settings.activeImagePromptTemplateId
    const template = workspace.state.settings.imagePromptTemplates.find(
      (item) => item.id === id,
    )
    if (!template || !confirm(`删除关键词模板“${template.name}”?`)) return
    workspace.state.settings.imagePromptTemplates =
      workspace.state.settings.imagePromptTemplates.filter(
        (item) => item.id !== id,
      )
    workspace.state.settings.activeImagePromptTemplateId = ''
    await workspace.collectUnusedImages()
    ui.notify('关键词模板已删除, 当前关键词和参考图仍保留')
  }
  function selectPolish(id: string) {
    workspace.state.settings.activeImagePolishTemplateId = id
    const template = workspace.state.settings.imagePolishTemplates.find(
      (item) => item.id === id,
    )
    if (template) {
      polish.instruction = template.instruction
      polish.references = referencesFromIds(template.referenceImageIds)
    } else {
      polish.instruction =
        workspace.state.settings.imagePolishInstruction ||
        '保留原始创作意图，补充主体、构图、光影、材质和画面质量细节。只输出可直接用于生图的完整提示词。'
      polish.references = []
    }
  }
  async function savePolish(update = false) {
    if (!polish.instruction.trim()) {
      ui.notify('请先填写润色要求', 'error')
      return
    }
    const templates = workspace.state.settings.imagePolishTemplates
    const active = templates.find(
      (item) =>
        item.id === workspace.state.settings.activeImagePolishTemplateId,
    )
    if (update && !active) {
      ui.notify('请先选择需要更新的润色模板', 'error')
      return
    }
    const name = update
      ? active?.name
      : window.prompt('请输入润色模板名称', `润色模板 ${templates.length + 1}`)
    if (name === null || name === undefined) return
    const cleanName = name.trim()
    if (!cleanName) {
      ui.notify('模板名称不能为空', 'error')
      return
    }
    const existing = update
      ? active
      : templates.find(
          (item) => item.name.toLowerCase() === cleanName.toLowerCase(),
        )
    if (
      existing &&
      !update &&
      !window.confirm(`润色模板“${existing.name}”已存在，覆盖它吗?`)
    )
      return
    const now = Date.now()
    const values = {
      instruction: polish.instruction,
      referenceImageIds: await referenceIds(polish.references),
      updatedAt: now,
    }
    if (existing) {
      Object.assign(existing, {
        ...values,
        name: cleanName,
        updatedAt: now,
      })
    } else {
      const id = createId()
      templates.push({ id, name: cleanName, createdAt: now, ...values })
      workspace.state.settings.activeImagePolishTemplateId = id
    }
    workspace.state.settings.imagePolishInstruction = polish.instruction
    workspace.state.settings.activeImagePolishTemplateId =
      existing?.id || templates.at(-1)!.id
    await workspace.collectUnusedImages()
    ui.notify(existing ? '润色模板已覆盖' : '润色模板已保存')
  }
  async function deletePolish() {
    const id = workspace.state.settings.activeImagePolishTemplateId
    const template = workspace.state.settings.imagePolishTemplates.find(
      (item) => item.id === id,
    )
    if (!template || !window.confirm(`删除润色模板“${template.name}”?`)) return
    workspace.state.settings.imagePolishTemplates =
      workspace.state.settings.imagePolishTemplates.filter(
        (item) => item.id !== id,
      )
    workspace.state.settings.activeImagePolishTemplateId = ''
    await workspace.collectUnusedImages()
    ui.notify('润色模板已删除，当前润色要求仍保留')
  }
  function openPolish() {
    const activeTemplate = workspace.state.settings.imagePolishTemplates.find(
      (item) =>
        item.id === workspace.state.settings.activeImagePolishTemplateId,
    )
    Object.assign(polish, {
      source: image.prompt.trim(),
      instruction: workspace.state.settings.imagePolishInstruction,
      result: '',
      status: '尚未生成',
      generationReferences: [...image.references],
      references: [],
      useGenerationReferences: false,
    })
    selectPolish(workspace.state.settings.activeImagePolishTemplateId)
    ui.polishOpen = true
    void nextTick(() => {
      const input = document.getElementById(
        polish.source ? 'polishInstruction' : 'polishSourcePrompt',
      )
      input?.focus()
      const body = document.querySelector<HTMLElement>('.polish-body')
      if (body) body.scrollTop = 0
      if (!activeTemplate && !polish.instruction)
        polish.instruction = workspace.state.settings.imagePolishInstruction
    })
  }
  function closePolish() {
    controller?.abort()
    if (!workspace.state.settings.activeImagePolishTemplateId)
      workspace.state.settings.imagePolishInstruction = polish.instruction
    polish.generationReferences = []
    polish.references = []
    polish.useGenerationReferences = false
    ui.polishOpen = false
  }
  watch(
    () => polish.instruction,
    (value) => {
      if (!workspace.state.settings.activeImagePolishTemplateId)
        workspace.state.settings.imagePolishInstruction = value
    },
  )
  async function addPolishReferences(
    files: File[],
    kind: 'generation' | 'polish',
  ) {
    const target =
      kind === 'generation' ? polish.generationReferences : polish.references
    for (const file of files.filter((file) => file.type.startsWith('image/'))) {
      if (target.length >= 16) break
      const reference = await readReference(file)
      if (!target.some((item) => item.data === reference.data))
        target.push(reference)
    }
  }
  function setReferences(
    kind: 'generation' | 'polish',
    next: ReferenceImage[],
  ) {
    const before =
      kind === 'generation' ? polish.generationReferences : polish.references
    polish.source = remapMentions(polish.source, before, next, kind)
    polish.instruction = remapMentions(polish.instruction, before, next, kind)
    if (kind === 'generation') polish.generationReferences = next
    else polish.references = next
  }
  function removeReference(kind: 'generation' | 'polish', index: number) {
    const images =
      kind === 'generation' ? polish.generationReferences : polish.references
    setReferences(
      kind,
      images.filter((_, i) => i !== index),
    )
  }
  function moveReference(
    kind: 'generation' | 'polish',
    from: number,
    to: number,
  ) {
    setReferences(
      kind,
      reorderReference(
        kind === 'generation' ? polish.generationReferences : polish.references,
        from,
        to,
      ),
    )
  }
  async function replaceReference(
    kind: 'generation' | 'polish',
    index: number,
    file: File,
  ) {
    const images =
      kind === 'generation' ? polish.generationReferences : polish.references
    images.splice(index, 1, await readReference(file))
  }
  function clearReferences(kind: 'generation' | 'polish') {
    const references =
      kind === 'generation' ? polish.generationReferences : polish.references
    if (!references.length) return
    const label = kind === 'generation' ? '生成参考图' : '润色参考图'
    if (window.confirm(`清空全部${label}？`)) setReferences(kind, [])
  }
  function submittedText(text: string, source: boolean) {
    return text.replace(
      /@(图|生成参考图|润色参考图)(\d+|\?)/g,
      (token, label: string, number: string) => {
        const generation = label !== '润色参考图'
        const images = generation
          ? polish.generationReferences
          : polish.references
        const index = Number(number) - 1
        if (!images[index])
          throw new Error(`引用的参考图不存在, 请修改 ${token}`)
        if (generation && !polish.useGenerationReferences)
          throw new Error('关键词引用了生成参考图, 请勾选“润色时分析这组图片”')
        if (!generation && source) throw new Error('润色参考图只能用于润色要求')
        return `${generation ? '生成参考图' : '润色参考图'} ${index + 1}`
      },
    )
  }
  async function generatePolish() {
    if (polish.busy) return
    polish.busy = true
    polish.status = '请求中'
    const request = new AbortController()
    controller = request
    const timeout = setTimeout(() => request.abort(), 60000)
    try {
      const source = submittedText(polish.source, true)
      const instruction = submittedText(polish.instruction, false)
      const settings = workspace.state.settings
      const generationReferences = polish.useGenerationReferences
        ? polish.generationReferences
        : []
      const referenceCount =
        generationReferences.length + polish.references.length
      if (!source && !referenceCount)
        throw new Error('请填写关键词, 添加润色参考图或勾选生成参考图参与润色')
      if (!instruction) throw new Error('请填写润色要求')
      workspace.state.settings.imagePolishInstruction = polish.instruction
      if (settings.demoMode || !settings.chatApiKey || !settings.chatBaseUrl) {
        polish.result = `${polish.source}\n\n${polish.instruction}`
        polish.status = referenceCount ? '演示建议（未分析参考图）' : '演示建议'
      } else {
        const references = [...generationReferences, ...polish.references]
        const prepared = await prepareReferences(references, settings, true)
        request.signal.throwIfAborted()
        const labels = [
          ...(polish.useGenerationReferences
            ? polish.generationReferences.map(
                (_, index) => `生成参考图 ${index + 1}`,
              )
            : []),
          ...polish.references.map((_, index) => `润色参考图 ${index + 1}`),
        ]
        const referenceNote = labels.length
          ? `\n\n后续图片依次标记为: ${labels.join(', ')}. 用户可能使用这些名称指代具体图片. 生成参考图会继续用于最终生图, 润色参考图只用于辅助生成关键词.`
          : ''
        const text = `原始关键词:\n${source || '未提供, 请根据参考图生成完整的生图关键词'}\n\n润色要求:\n${instruction}${referenceNote}`
        const messages: ChatRequestMessage[] = [
          { role: 'system', content: settings.imagePolishSystemPrompt },
          {
            role: 'user',
            content: prepared.length
              ? [
                  { type: 'text', text },
                  ...prepared.map<ImagePart>((item) => ({
                    type: 'image_url',
                    image_url: { url: item.data },
                  })),
                ]
              : text,
          },
        ]
        const result = await requestChat(
          { ...settings, chatStream: false, chatWebSearch: false },
          messages,
          request.signal,
        )
        polish.result = result.content
        polish.status = '已生成建议'
      }
    } catch (error) {
      if (ui.polishOpen) {
        polish.status = '生成失败'
        ui.notify(errorMessage(error), 'error')
      }
    } finally {
      clearTimeout(timeout)
      polish.busy = false
      controller = null
    }
  }
  function applyPolish() {
    if (!polish.result.trim()) {
      ui.notify('还没有可使用的润色结果', 'error')
      return
    }
    if (!workspace.state.settings.activeImagePolishTemplateId)
      workspace.state.settings.imagePolishInstruction = polish.instruction
    image.prompt = polish.result
    image.references = [...polish.generationReferences]
    closePolish()
    ui.notify('已使用润色结果')
  }
  function dispose() {
    controller?.abort()
  }
  return {
    polish,
    selectPrompt,
    savePrompt,
    deletePrompt,
    selectPolish,
    savePolish,
    deletePolish,
    openPolish,
    closePolish,
    addPolishReferences,
    removeReference,
    moveReference,
    replaceReference,
    clearReferences,
    generatePolish,
    applyPolish,
    dispose,
  }
})
