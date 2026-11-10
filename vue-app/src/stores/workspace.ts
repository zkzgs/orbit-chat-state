import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type {
  ApiKind,
  GenerationBatch,
  GenerationTask,
  ImageConfig,
  ImageRecord,
  StoredImage,
} from '../types/models'
import {
  loadFavoriteFolders,
  loadState,
  saveFavoriteFolders,
  saveState,
} from '../storage/state'
import { readImages, updateImages } from '../storage/database'
import { createId } from '../utils/id'
import { imageSize } from '../utils/image-options'

export const useWorkspaceStore = defineStore('workspace', () => {
  const state = reactive(loadState())
  const favoriteFolders = ref(loadFavoriteFolders())
  const images = shallowRef<StoredImage[]>([])
  const imageFavoriteFolders = reactive(new Map<string, string[]>())
  const batches = ref<GenerationBatch[]>([])
  const tasks = ref<GenerationTask[]>([])
  const imageDraftIds = ref<string[]>([])
  const modelCatalog = reactive<Record<ApiKind, string[]>>({
    chat:
      state.connectionProfiles.chat.find(
        (item) => item.id === state.activeConnectionProfiles.chat,
      )?.models || [],
    image:
      state.connectionProfiles.image.find(
        (item) => item.id === state.activeConnectionProfiles.image,
      )?.models || [],
  })
  const ready = ref(false)
  let initialization: Promise<void> | undefined
  const generation = ref(0)
  const activeConversation = computed(
    () =>
      state.conversations.find(
        (item) => item.id === state.activeConversationId,
      ) || state.conversations[0],
  )
  const imageMap = computed(
    () => new Map(images.value.map((image) => [image.id, image])),
  )
  watch(
    images,
    (value) => {
      imageFavoriteFolders.clear()
      value.forEach((image) =>
        imageFavoriteFolders.set(image.id, image.favoriteFolderIds || []),
      )
    },
    { immediate: true, flush: 'sync' },
  )
  const imageConfig = computed<ImageConfig>(() => ({
    ...state.settings.imageOptions,
    model: state.settings.imageModel,
    size: imageSize(state.settings.imageOptions),
    countMode: state.settings.imageCountMode,
    backgroundMode: state.settings.imageBackgroundMode,
    compressReferences: state.settings.compressRequestImages,
    referenceCompressionLimitMb: state.settings.requestImageCompressionLimitMb,
  }))
  watch(state, saveState, { deep: true })
  watch(favoriteFolders, saveFavoriteFolders, { deep: true })
  function batchImages(batch?: GenerationBatch) {
    return (batch?.imageIds || []).flatMap((id) => {
      const image = imageMap.value.get(id)
      return image ? [image] : []
    })
  }
  function messageImages(ids: string[]) {
    return ids.flatMap((id) => {
      const image = imageMap.value.get(id)
      return image ? [image] : []
    })
  }
  function setImageFavoriteFolders(id: string, folderIds: string[]) {
    const image = imageMap.value.get(id)
    if (image) image.favoriteFolderIds = folderIds
    imageFavoriteFolders.set(id, folderIds)
  }
  async function persistRecords(
    records: ImageRecord[],
    deleted: string[] = [],
    replace = false,
  ) {
    try {
      await updateImages(records, deleted, replace)
      return true
    } catch {
      /* IndexedDB 禁用时继续使用页面内数据；清理重试旧记录须确认新结果已落盘。 */
      return false
    }
  }
  function initialize(): Promise<void> {
    if (initialization) return initialization
    initialization = (async () => {
      try {
        await readImages((records) => {
          const newImages = records.filter(
            (item): item is StoredImage => item.type === 'image',
          )
          const newBatches = records.filter(
            (item): item is GenerationBatch => item.type === 'generation-batch',
          )
          const newTasks = records
            .filter(
              (item): item is GenerationTask => item.type === 'generation-task',
            )
            .map((task) =>
              task.status === 'running'
                ? {
                    ...task,
                    status: 'error' as const,
                    finishedAt: Date.now(),
                    detail: '页面刷新后无法确认上次请求结果',
                  }
                : task,
            )
          if (newImages.length) images.value = [...images.value, ...newImages]
          if (newBatches.length)
            batches.value = [...batches.value, ...newBatches].sort(
              (a, b) => b.createdAt - a.createdAt,
            )
          if (newTasks.length)
            tasks.value = [...tasks.value, ...newTasks].sort(
              (a, b) => b.startedAt - a.startedAt,
            )
        })
      } catch {
        /* IndexedDB 禁用时保留页面内数据 */
      } finally {
        ready.value = true
      }
    })()
    return initialization
  }
  async function saveImage(
    src: string,
    name: string,
    metadata: Partial<StoredImage> = {},
  ) {
    if (!ready.value) await initialize()
    const identity = (source: string) =>
      source.startsWith('data:')
        ? source.slice(source.indexOf(',') + 1)
        : source
    const existing = images.value.find(
      (item) => identity(item.src) === identity(src),
    )
    if (existing) return existing.id
    const image: StoredImage = {
      id: createId(),
      type: 'image',
      src,
      name,
      createdAt: Date.now(),
      ...metadata,
    }
    images.value = [...images.value, image]
    await persistRecords([image])
    return image.id
  }
  async function collectUnusedImages() {
    if (!ready.value) await initialize()
    const used = new Set<string>(imageDraftIds.value)
    state.conversations.forEach((item) =>
      item.messages.forEach((message) =>
        message.imageIds.forEach((id) => used.add(id)),
      ),
    )
    batches.value.forEach((item) =>
      [...item.imageIds, ...item.referenceImageIds].forEach((id) =>
        used.add(id),
      ),
    )
    tasks.value.forEach((item) =>
      item.referenceImageIds.forEach((id) => used.add(id)),
    )
    for (const template of [
      ...state.settings.imagePromptTemplates,
      ...state.settings.imagePolishTemplates,
    ])
      template.referenceImageIds.forEach((id) => used.add(id))
    const deleted = images.value
      .filter(
        (image) => !used.has(image.id) && !image.favoriteFolderIds?.length,
      )
      .map((image) => image.id)
    images.value = images.value.filter((image) => !deleted.includes(image.id))
    await persistRecords([], deleted)
  }
  async function saveAllImages() {
    if (!ready.value) await initialize()
    await persistRecords(
      [...images.value, ...batches.value, ...tasks.value],
      [],
      true,
    )
  }
  return {
    state,
    favoriteFolders,
    images,
    batches,
    tasks,
    imageDraftIds,
    modelCatalog,
    ready,
    generation,
    activeConversation,
    imageMap,
    imageFavoriteFolders,
    imageConfig,
    batchImages,
    messageImages,
    setImageFavoriteFolders,
    persistRecords,
    initialize,
    saveImage,
    collectUnusedImages,
    saveAllImages,
  }
})
