import { imageStorage } from '../storage/database'
import { defineStore } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import { useWorkspaceStore } from './workspace'
import { useInterfaceStore } from './interface'
import {
  requestImages,
  imageRequestBody,
  imageRequestPrompt,
  ImageRequestError,
  type GeneratedResponse,
} from '../api/images'
import type {
  GenerationBatch,
  GenerationTask,
  ImageConfig,
  ReferenceImage,
  Settings,
  StoredImage,
} from '../types/models'
import { cloneData } from '../utils/clone'
import { createId } from '../utils/id'
import { errorMessage, formatDuration } from '../utils/format'
import { prepareReferences, readReference } from '../utils/images'
import { createDemoImage } from '../utils/demo-image'
import {
  remapMentions,
  moveReference as reorderReference,
} from '../utils/references'
import { buildApiEndpoint, resourceFetch } from '../api/client'
import { readDataUrl } from '../utils/files'
import { nativeMediaRequest, mediaAudit } from '../api/native-media.js'
import {
  readImagePromptDraft,
  saveImagePromptDraft,
} from '../storage/input-drafts.js'

export const useImageGenerationStore = defineStore('image-generation', () => {
  const workspace = useWorkspaceStore()
  const ui = useInterfaceStore()
  const prompt = ref(
    workspace.state.settings.persistInputContent ? readImagePromptDraft() : '',
  )
  const references = ref<ReferenceImage[]>([])
  const requestType = ref('generation')
  const draftConfig = computed<ImageConfig>(() => ({
    ...workspace.imageConfig,
    requestType: requestType.value,
  }))
  watch(
    () => references.value.length > 0,
    (hasReferences) => {
      requestType.value = hasReferences ? 'edit' : 'generation'
    },
    { flush: 'sync' },
  )
  watch(
    references,
    (value) => {
      workspace.imageDraftIds = value.flatMap((item) =>
        item.imageId ? [item.imageId] : [],
      )
    },
    { deep: true, flush: 'sync' },
  )
  const controllers = new Map<string, AbortController>()
  const requestPhaseLabels: Record<string, string> = {
    uploading: '上传资源中',
    waiting: '等待上游中',
    parsing: '解析结果中',
    saving: '保存结果中',
    done: '已完成',
    error: '失败',
  }
  watch(
    prompt,
    (value) => {
      if (workspace.state.settings.persistInputContent)
        saveImagePromptDraft(value)
    },
    { flush: 'sync' },
  )
  watch(
    () => workspace.state.settings.persistInputContent,
    (enabled) => saveImagePromptDraft(enabled ? prompt.value : ''),
    { immediate: true, flush: 'sync' },
  )

  function updateRequestPhase(
    task: GenerationTask,
    requestIndex: number,
    phase: string,
  ) {
    task.requestPhases[requestIndex] = phase
    if (task.requestPhases.length === 1) {
      task.detail = requestPhaseLabels[phase] || phase
      return
    }
    const details = [
      'uploading',
      'waiting',
      'parsing',
      'saving',
      'done',
      'error',
    ]
      .map((item) => {
        const count = task.requestPhases.filter(
          (value) => value === item,
        ).length
        return count ? `${requestPhaseLabels[item]} ${count}` : ''
      })
      .filter(Boolean)
    task.detail = `${details.join(' · ')} / 共 ${task.requestPhases.length}`
  }

  async function addReferences(files: File[]) {
    for (const file of files.filter((file) => file.type.startsWith('image/'))) {
      if (references.value.length >= 16) break
      const image = await readReference(file)
      if (!(await imageStorage.includesSource(references.value, image.data)))
        references.value.push(image)
      if (references.value.length >= 16) break
    }
  }
  function removeReference(index: number) {
    const before = [...references.value]
    references.value.splice(index, 1)
    prompt.value = remapMentions(prompt.value, before, references.value)
  }
  function moveReference(from: number, to: number) {
    const before = references.value
    references.value = reorderReference(before, from, to)
    prompt.value = remapMentions(prompt.value, before, references.value)
  }
  async function replaceReference(index: number, file: File) {
    const image = await readReference(file)
    references.value.splice(index, 1, image)
  }
  function clearReferences() {
    if (!references.value.length || !confirm('清空全部生成参考图?')) return
    references.value = []
    prompt.value = prompt.value.replace(/@图\d+/g, '@图?')
  }
  function applyConfig(
    config: ImageConfig,
    text: string,
    ids: string[],
    message = '已复制提示词, 参数和原参考图',
  ) {
    const {
      model: _model,
      size: _size,
      countMode: _count,
      backgroundMode: _background,
      compressReferences: _compress,
      referenceCompressionLimitMb: _limit,
      submittedPrompt: _submitted,
      requestType: _requestType,
      provider: _provider,
      ...options
    } = config
    Object.assign(workspace.state.settings.imageOptions, options, {
      reasoningEffort: config.reasoningEffort || 'auto',
    })
    workspace.state.settings.imageProvider = config.provider || 'openai'
    if (config.model) workspace.state.settings.imageModel = config.model
    prompt.value = text
    references.value = workspace.messageImages(ids).map((image) => ({
      id: createId(),
      data: image.src,
      name: image.name || '原参考图',
      imageId: image.id,
    }))
    requestType.value =
      config.requestType || (references.value.length ? 'edit' : 'generation')
    ui.activeView = 'image'
    ui.details.open = false
    void nextTick(() => document.getElementById('imagePrompt')?.focus())
    ui.notify(message)
  }
  async function editOutput(images: StoredImage[]) {
    if (images.some((image) => image.mediaType === 'video')) {
      ui.notify('视频不能作为图片参考', 'error')
      return
    }
    const available = images.slice(0, Math.max(0, 16 - references.value.length))
    if (!available.length) {
      ui.notify('参考图已经达到 16 张上限', 'error')
      return
    }
    for (const image of available) {
      if (await imageStorage.includesSource(references.value, image.src))
        continue
      references.value.push({
        id: createId(),
        data: image.src,
        name: image.name || '生成图片',
        imageId: image.id,
      })
    }
    ui.activeView = 'image'
    ui.details.open = false
    await nextTick()
    document.getElementById('imagePrompt')?.focus()
    ui.notify(`已将 ${available.length} 张输出图追加到当前参考图列表`)
  }
  async function generate(override?: {
    prompt: string
    config: ImageConfig
    references: ReferenceImage[]
    retryOf?: string
    signal?: AbortSignal
    settings?: Settings
  }) {
    if (!workspace.ready) return
    const text = (override?.prompt || prompt.value).trim()
    if (!text) {
      ui.notify('先写下你想生成的画面', 'error')
      return
    }
    const config = cloneData(override?.config || draftConfig.value)
    const settings = cloneData(override?.settings || workspace.state.settings)
    config.provider ||= 'openai'
    if (
      config.provider === 'gemini' ||
      (config.provider === 'xai' && config.mediaType === 'video')
    )
      config.countMode = 'parallel'
    if (config.provider !== 'openai')
      config.requestType =
        config.mediaType === 'video'
          ? 'video'
          : (override?.references || references.value).length
            ? 'edit'
            : 'generation'
    config.requestType ||= (override?.references || references.value).length
      ? 'edit'
      : 'generation'
    config.count = Math.min(10, Math.max(1, Number(config.count) || 1))
    config.compression = Math.min(
      100,
      Math.max(0, Number(config.compression) || 0),
    )
    if (
      config.provider === 'openai' &&
      config.background === 'transparent' &&
      config.format === 'jpeg'
    ) {
      ui.notify('透明背景只支持 PNG 或 WebP 格式', 'error')
      return
    }
    if (
      /@(?:生成参考图|润色参考图)(?:\d+|\?)/.test(text) ||
      /@图\?/.test(text) ||
      [...text.matchAll(/@图(\d+)/g)].some(
        (match) =>
          Number(match[1]) < 1 ||
          Number(match[1]) > (override?.references || references.value).length,
      )
    ) {
      ui.notify('关键词中有失效的参考图引用', 'error')
      return
    }
    const generation = workspace.generation
    const removeOldRetry =
      workspace.state.settings.deleteRetriedRecordOnSuccess &&
      workspace.tasks.some(
        (task) => task.id === override?.retryOf && task.status === 'error',
      )
    const id = createId()
    const startedAt = Date.now()
    const originals = [...(override?.references || references.value)]
    const submitted = text.replace(
      /@图(\d+)/g,
      (_token: string, number: string) => `[image ${number}]`,
    )
    config.submittedPrompt =
      config.backgroundMode === 'prompt' && config.background === 'transparent'
        ? `${submitted}\n\nUse a transparent background.`
        : submitted
    const requestTotal = config.countMode === 'parallel' ? config.count : 1
    workspace.tasks.unshift({
      id,
      type: 'generation-task',
      title: text.slice(0, 48),
      detail: '准备请求',
      prompt: text,
      config,
      referenceImageIds: [],
      requestPhases: Array<string>(requestTotal).fill('preparing'),
      responses: [],
      startedAt,
      status: 'running',
    })
    // Only normal submission clears the form; retries preserve the current draft.
    if (!override && workspace.state.settings.clearInputAfterSubmit)
      prompt.value = ''
    const task = workspace.tasks.find((item) => item.id === id)!
    const controller = new AbortController()
    const abort = () => controller.abort()
    override?.signal?.addEventListener('abort', abort, { once: true })
    if (override?.signal?.aborted) controller.abort()
    controllers.set(id, controller)
    const timeout = setTimeout(
      () => controller.abort(),
      config.mediaType === 'video' ? 600000 : 300000,
    )
    const persist = () =>
      generation === workspace.generation
        ? workspace.persistRecords([task])
        : Promise.resolve(false)
    let retryCleanup: Promise<void> | undefined
    const onRequestSent = () => {
      if (removeOldRetry && !retryCleanup)
        retryCleanup = removeRetriedRecord(override!.retryOf!, task, generation)
    }
    try {
      for (const reference of originals) {
        if (generation !== workspace.generation) return
        const imageId =
          reference.imageId ||
          (await workspace.saveImage(reference.data, reference.name))
        task.referenceImageIds.push(imageId)
        reference.imageId = imageId
        reference.data = workspace.imageMap.get(imageId)!.src
        reference.file = undefined
      }
      if (generation !== workspace.generation) return
      let images: GeneratedResponse['images']
      let meta: Record<string, unknown> = {}
      let failed = 0
      if (
        settings.demoMode ||
        !settings.imageApiKey ||
        !settings.imageBaseUrl
      ) {
        task.detail = '生成演示图片'
        task.requestLog = { mode: 'demo', config, createdAt: Date.now() }
        await persist()
        onRequestSent()
        await new Promise((resolve) => setTimeout(resolve, 1100))
        images = Array.from({ length: config.count }, (_, index) => ({
          src: createDemoImage(text, index, config.width, config.height),
          responseMeta: { model: 'demo', output_format: 'svg' },
        }))
      } else {
        task.detail = '准备提交副本'
        await persist()
        const prepared = await prepareReferences(
          originals,
          {
            compressRequestImages: config.compressReferences,
            requestImageCompressionLimitMb: config.referenceCompressionLimitMb,
          },
          config.provider !== 'openai' || config.requestType !== 'edit',
        )
        if (generation !== workspace.generation) return
        task.requestLog = {
          config,
          endpoint: buildApiEndpoint(
            settings.imageBaseUrl,
            config.requestType === 'edit'
              ? '/images/edits'
              : '/images/generations',
          ),
          method: 'POST',
          contentType:
            config.requestType === 'edit' && prepared.length
              ? 'multipart/form-data'
              : 'application/json',
          body: {
            ...imageRequestBody(
              config,
              imageRequestPrompt(config.submittedPrompt!, settings, config),
            ),
            image: prepared.map((image) => image.submissionMeta),
          },
          parallelRequests: requestTotal,
          createdAt: Date.now(),
        }
        if (config.provider !== 'openai') {
          const native = nativeMediaRequest(
            settings,
            config,
            imageRequestPrompt(config.submittedPrompt!, settings, config),
            prepared,
          )
          task.requestLog = {
            config,
            endpoint: native.endpoint,
            method: 'POST',
            contentType: 'application/json',
            body: mediaAudit(native.body),
            parallelRequests: requestTotal,
            createdAt: Date.now(),
          }
        }
        await persist()
        const results = await Promise.allSettled(
          Array.from({ length: requestTotal }, async (_, index) => {
            try {
              const result = await requestImages(
                settings,
                config,
                config.submittedPrompt!,
                prepared,
                controller.signal,
                (phase) => updateRequestPhase(task, index, phase),
                onRequestSent,
                async (remote) => {
                  task.requestLog!.remoteRequests = [
                    ...((task.requestLog!.remoteRequests as unknown[]) || []),
                    remote,
                  ]
                  await persist()
                },
              )
              task.responses.push({
                requestIndex: index + 1,
                response: result.upstream,
                receivedAt: Date.now(),
              })
              task.requestPhases[index] = 'done'
              result.meta.requestLog = task.requestLog
              return result
            } catch (error) {
              task.responses.push({
                requestIndex: index + 1,
                response:
                  error instanceof ImageRequestError
                    ? error.upstream
                    : { error: errorMessage(error) },
                receivedAt: Date.now(),
              })
              task.requestPhases[index] = 'error'
              throw error
            }
          }),
        )
        const success = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        )
        images = success.flatMap((result) => result.images)
        failed = results.length - success.length
        meta = {
          ...success[0]?.meta,
          requestLog: task.requestLog,
          responses: task.responses,
        }
        if (!images.length) {
          const first = results.find((result) => result.status === 'rejected')
          throw first?.status === 'rejected'
            ? first.reason
            : new Error('接口没有返回图片地址')
        }
      }
      await retryCleanup
      if (generation !== workspace.generation) return
      task.detail = '保存结果中'
      const batchId = createId()
      const imageIds: string[] = []
      for (const image of images) {
        if (generation !== workspace.generation) return
        if (controller.signal.aborted) throw new Error('请求超时或已中断')
        let source = image.src
        if (/^https?:\/\//i.test(source)) {
          const response = await resourceFetch(source, {
            signal: controller.signal,
          })
          if (!response.ok) throw new Error(`图片下载失败: ${response.status}`)
          source = await readDataUrl(await response.blob())
        }
        if (generation !== workspace.generation) return
        if (controller.signal.aborted) throw new Error('请求超时或已中断')
        imageIds.push(
          await workspace.saveImage(source, '生成图片', {
            batchId,
            taskId: task.id,
            prompt: text,
            config,
            responseMeta: { ...meta, ...image.responseMeta },
            mediaType:
              image.responseMeta.mediaType === 'video' ? 'video' : 'image',
          }),
        )
      }
      if (generation !== workspace.generation) return
      const finishedAt = Date.now()
      const batch: GenerationBatch = {
        id: batchId,
        type: 'generation-batch',
        batchId,
        taskId: id,
        prompt: text,
        config,
        imageIds,
        referenceImageIds: [...task.referenceImageIds],
        responseMeta: meta,
        imageCount: imageIds.length,
        startedAt,
        createdAt: finishedAt,
        completedAt: finishedAt,
        durationMs: finishedAt - startedAt,
      }
      workspace.batches.unshift(batch)
      task.batchId = batchId
      task.status = failed ? 'partial' : 'success'
      task.finishedAt = finishedAt
      task.detail = `${failed ? '部分完成' : '已完成'} · ${formatDuration(finishedAt - startedAt)}`
      await workspace.persistRecords([batch, task])
      if (failed)
        ui.notify(
          `并发请求完成 ${requestTotal - failed}/${requestTotal} 个`,
          'warning',
        )
      return {
        taskId: id,
        status: task.status,
        imageIds,
        batchId,
        error: failed ? '部分请求失败' : undefined,
      }
    } catch (error) {
      await retryCleanup
      if (generation !== workspace.generation) return
      task.status = 'error'
      task.finishedAt = Date.now()
      task.detail = errorMessage(error)
      task.error = { message: task.detail, occurredAt: Date.now() }
      await persist()
      ui.notify(task.detail, 'error')
      return { taskId: id, status: 'error', imageIds: [], batchId: task.batchId, error: task.detail }
    } finally {
      clearTimeout(timeout)
      controllers.delete(id)
      override?.signal?.removeEventListener('abort', abort)
      await retryCleanup
    }
  }
  function reuseTask(task: GenerationTask) {
    applyConfig(
      task.config,
      task.prompt,
      task.referenceImageIds,
      '已恢复原任务配置',
    )
  }
  async function removeRetriedRecord(
    taskId: string,
    newTask: GenerationTask,
    generation: number,
  ) {
    const oldTask = workspace.tasks.find((task) => task.id === taskId)
    if (
      !oldTask ||
      oldTask.status !== 'error' ||
      generation !== workspace.generation
    )
      return
    const batches = workspace.batches.filter(
      (batch) => batch.taskId === taskId || batch.id === oldTask.batchId,
    )
    if (
      oldTask.favoriteFolderIds?.length ||
      batches.some((batch) =>
        workspace
          .batchImages(batch)
          .some((image) => image.favoriteFolderIds?.length),
      )
    ) {
      ui.notify('原记录含收藏内容，已保留')
      return
    }
    if (!(await workspace.persistRecords([newTask]))) {
      ui.notify('新请求记录未能保存到本地，旧记录已保留', 'warning')
      return
    }
    if (generation !== workspace.generation) return
    const removed = new Set([taskId, ...batches.map((batch) => batch.id)])
    if (!(await workspace.persistRecords([], [...removed]))) {
      ui.notify('旧记录无法从本地存储移除，已保留', 'warning')
      return
    }
    if (generation !== workspace.generation) return
    workspace.tasks = workspace.tasks.filter((task) => !removed.has(task.id))
    workspace.batches = workspace.batches.filter(
      (batch) => !removed.has(batch.id),
    )
    // GC retains images used by chat, templates, drafts, favorites or the new result.
    await workspace.collectUnusedImages()
  }
  function retryTask(task: GenerationTask) {
    if (task.status === 'running') return
    return generate({
      retryOf: task.id,
      prompt: task.prompt,
      config: task.config,
      references: workspace
        .messageImages(task.referenceImageIds)
        .map((image) => ({
          id: image.id,
          imageId: image.id,
          data: image.src,
          name: image.name || '原参考图',
        })),
    })
  }
  function dispose() {
    controllers.forEach((controller) => controller.abort())
    controllers.clear()
  }
  return {
    prompt,
    references,
    requestType,
    draftConfig,
    addReferences,
    removeReference,
    moveReference,
    replaceReference,
    clearReferences,
    applyConfig,
    editOutput,
    generate,
    reuseTask,
    retryTask,
    dispose,
  }
})
