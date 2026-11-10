import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from './workspace'
import { useInterfaceStore } from './interface'
import { useImageGenerationStore } from './image-generation'
import type {
  GenerationBatch,
  GenerationTask,
  StoredImage,
  TaskStatus,
} from '../types/models'
import { createId } from '../utils/id'
import { downloadImage } from '../utils/images'

export interface HistoryCard {
  id: string
  key: string
  kind: 'image' | 'task'
  taskId: string
  batchId: string
  index: number
  status: TaskStatus
  title: string
  detail: string
  isGroup: boolean
  images: StoredImage[]
  image: StoredImage | null
  favoriteImageIds: string[]
  startedAt: number
  finishedAt: number
  createdAt: number
  durationMs: number
}
export const useHistoryStore = defineStore('history', () => {
  const workspace = useWorkspaceStore()
  const ui = useInterfaceStore()
  const generator = useImageGenerationStore()
  const library = ref<'history' | 'favorites'>('history')
  const mode = ref<'group' | 'single'>('group')
  const folderId = ref('')
  const query = ref('')
  const status = ref('all')
  const selected = ref(new Set<string>())
  const isFolderIndex = computed(
    () => library.value === 'favorites' && !folderId.value,
  )
  const title = computed(() =>
    library.value === 'history'
      ? '生成记录'
      : workspace.favoriteFolders.find((folder) => folder.id === folderId.value)
          ?.name || '收藏夹',
  )
  const orderedFolderImages = computed(() => {
    const linked = new Set(workspace.batches.flatMap((batch) => batch.imageIds))
    const tasksById = new Map(workspace.tasks.map((task) => [task.id, task]))
    const tasksByBatch = new Map(
      workspace.tasks.map((task) => [task.batchId, task]),
    )
    const entries = workspace.batches.flatMap((batch) => {
      const task = tasksById.get(batch.taskId) || tasksByBatch.get(batch.id)
      return workspace.batchImages(batch).map((image) => ({
        image,
        time: task?.startedAt || batch.startedAt || batch.createdAt,
      }))
    })
    entries.push(
      ...workspace.images
        .filter((image) => !linked.has(image.id))
        .map((image) => ({ image, time: image.createdAt })),
    )
    return [
      ...new Map(
        entries
          .sort((a, b) => b.time - a.time)
          .map(({ image }) => [image.id, image]),
      ).values(),
    ]
  })
  function folderImages(id: string) {
    return orderedFolderImages.value.filter((image) =>
      workspace.imageFavoriteFolders.get(image.id)?.includes(id),
    )
  }
  function effectiveCoverId(id: string) {
    const folder = workspace.favoriteFolders.find((item) => item.id === id)
    if (!folder) return ''
    const images = folderImages(id)
    return (
      images.find((image) => image.id === folder.coverImageId)?.id ||
      (folder.coverImageId !== null && !folder.hidden
        ? images[0]?.id || ''
        : '')
    )
  }
  const folders = computed(() =>
    workspace.favoriteFolders
      .map((folder) => {
        const images = folderImages(folder.id)
        const explicit = images.find(
          (image) => image.id === folder.coverImageId,
        )
        const cover =
          explicit ||
          (folder.coverImageId !== null && !folder.hidden
            ? images[0]
            : undefined)
        return {
          ...folder,
          coverId: cover?.id || '',
          imageCount: images.length,
          taskCount: workspace.tasks.filter((task) =>
            task.favoriteFolderIds?.includes(folder.id),
          ).length,
        }
      })
      .filter((folder) =>
        folder.name
          .toLocaleLowerCase()
          .includes(query.value.toLocaleLowerCase()),
      ),
  )
  // Drop invalid explicit choices, so adding that image back later does not resurrect the old cover.
  watch(
    () =>
      workspace.ready
        ? workspace.favoriteFolders.filter(
            (folder) =>
              typeof folder.coverImageId === 'string' &&
              !folderImages(folder.id).some(
                (image) => image.id === folder.coverImageId,
              ),
          )
        : [],
    (invalid) =>
      invalid.forEach((folder) => {
        delete folder.coverImageId
      }),
    { immediate: true },
  )
  const hiddenFolderIds = computed(
    () =>
      new Set(
        workspace.favoriteFolders
          .filter((folder) => folder.hidden)
          .map((folder) => folder.id),
      ),
  )
  function isImageHidden(image: StoredImage) {
    return (
      workspace.imageFavoriteFolders
        .get(image.id)
        ?.some((id) => hiddenFolderIds.value.has(id)) || false
    )
  }
  function viewImages(batch: GenerationBatch) {
    const images = workspace.batchImages(batch)
    return library.value === 'history'
      ? images.filter((image) => !isImageHidden(image))
      : images
  }
  const hasGroups = computed(() =>
    workspace.batches.some((batch) => viewImages(batch).length > 1),
  )
  const cards = computed<HistoryCard[]>(() => {
    const result: HistoryCard[] = []
    const make = (
      batch?: GenerationBatch,
      task?: GenerationTask,
      image?: StoredImage,
      index = 0,
      isGroup = false,
      batchImages?: StoredImage[],
    ): HistoryCard => {
      const images =
        batchImages ||
        (batch ? workspace.batchImages(batch) : image ? [image] : [])
      const key =
        batch && image
          ? `${batch.id}:${isGroup ? 'all' : index}`
          : image
            ? `image:${image.id}`
            : `task:${task!.id}`
      const ids = isGroup
        ? images.map((item) => item.id)
        : image
          ? [image.id]
          : []
      return {
        id: key,
        key: task?.status === 'running' && !image ? '' : key,
        kind: image ? 'image' : 'task',
        taskId: task?.id || batch?.taskId || '',
        batchId: batch?.id || '',
        index,
        status: task?.status || 'success',
        title:
          task?.prompt || batch?.prompt || image?.prompt || '未命名生成任务',
        detail: task?.detail || '',
        isGroup,
        images,
        image: image || null,
        favoriteImageIds: ids,
        startedAt: task?.startedAt || batch?.startedAt || image?.createdAt || 0,
        finishedAt: task?.finishedAt || 0,
        createdAt: batch?.createdAt || task?.startedAt || image?.createdAt || 0,
        durationMs: batch?.durationMs || 0,
      }
    }
    const taskById = new Map(workspace.tasks.map((task) => [task.id, task]))
    const taskByBatchId = new Map<string, GenerationTask>()
    workspace.tasks.forEach((task) => {
      if (task.batchId && !taskByBatchId.has(task.batchId))
        taskByBatchId.set(task.batchId, task)
    })
    const linkedTaskIds = new Set<string>()
    workspace.batches.forEach((batch) => {
      const task = taskById.get(batch.taskId) || taskByBatchId.get(batch.id)
      if (task) linkedTaskIds.add(task.id)
      const images = viewImages(batch)
      if (
        library.value === 'history' &&
        mode.value === 'group' &&
        images.length > 1
      )
        result.push(make(batch, task, images[0], 0, true, images))
      else
        images.forEach((image, index) => {
          if (
            library.value === 'history' ||
            workspace.imageFavoriteFolders
              .get(image.id)
              ?.includes(folderId.value)
          )
            result.push(make(batch, task, image, index, false, images))
        })
    })
    if (library.value === 'favorites') {
      const linked = new Set(
        workspace.batches.flatMap((batch) => batch.imageIds),
      )
      workspace.images
        .filter(
          (image) =>
            !linked.has(image.id) &&
            workspace.imageFavoriteFolders
              .get(image.id)
              ?.includes(folderId.value),
        )
        .forEach((image) => result.push(make(undefined, undefined, image)))
    }
    workspace.tasks
      .filter((task) => !linkedTaskIds.has(task.id))
      .forEach((task) => {
        if (
          library.value === 'history' ||
          task.favoriteFolderIds?.includes(folderId.value)
        )
          result.push(make(undefined, task))
      })
    return result
      .sort((a, b) => b.startedAt - a.startedAt)
      .filter(
        (card) =>
          `${card.title} ${card.detail}`
            .toLocaleLowerCase()
            .includes(query.value.toLocaleLowerCase()) &&
          (status.value === 'all' || card.status === status.value),
      )
  })
  watch(cards, (items) => {
    const keys = new Set(items.map((card) => card.key))
    if ([...selected.value].some((key) => !keys.has(key)))
      selected.value = new Set(
        [...selected.value].filter((key) => keys.has(key)),
      )
  })
  function setLibrary(value: 'history' | 'favorites') {
    library.value = value
    folderId.value = ''
    selected.value = new Set()
    query.value = ''
    status.value = 'all'
  }
  function setMode(value: 'group' | 'single') {
    mode.value = value
    selected.value = new Set()
  }
  function openFolder(id: string) {
    folderId.value = id
    selected.value = new Set()
    query.value = ''
  }
  function toggleSelection(key: string, checked: boolean) {
    const next = new Set(selected.value)
    if (checked) next.add(key)
    else next.delete(key)
    selected.value = next
  }
  function openCard(card: HistoryCard) {
    ui.openDetails(
      workspace.batches.find((item) => item.id === card.batchId),
      workspace.tasks.find((item) => item.id === card.taskId),
      card.index,
      card.image?.id,
    )
  }
  async function deleteCards(items: HistoryCard[]) {
    if (!items.length || !confirm(`删除选中的 ${items.length} 条记录?`)) return
    await workspace.initialize()
    const removed: string[] = []
    const changedImages: StoredImage[] = []
    for (const card of items) {
      if (card.kind === 'task') {
        workspace.tasks = workspace.tasks.filter(
          (task) => task.id !== card.taskId,
        )
        removed.push(card.taskId)
        continue
      }
      card.favoriteImageIds.forEach((id) => {
        const image = workspace.imageMap.get(id)
        if (!image) return
        workspace.setImageFavoriteFolders(id, [])
        changedImages.push(image)
      })
      const batch = workspace.batches.find((batch) => batch.id === card.batchId)
      if (!batch) continue
      const ids = new Set(card.favoriteImageIds)
      batch.imageIds = batch.imageIds.filter((id) => !ids.has(id))
      batch.imageCount = batch.imageIds.length
      if (!batch.imageIds.length) {
        workspace.batches = workspace.batches.filter(
          (item) => item.id !== batch.id,
        )
        workspace.tasks = workspace.tasks.filter(
          (task) => task.id !== batch.taskId,
        )
        removed.push(batch.id, batch.taskId)
      }
    }
    selected.value = new Set()
    await workspace.persistRecords(
      [...changedImages, ...workspace.batches, ...workspace.tasks],
      removed,
    )
    await workspace.collectUnusedImages()
  }
  function selectAll() {
    selected.value = new Set(
      cards.value.map((card) => card.key).filter(Boolean),
    )
  }
  function invertSelection() {
    selected.value = new Set(
      cards.value
        .filter((card) => card.key && !selected.value.has(card.key))
        .map((card) => card.key),
    )
  }
  function openFavorite(imageIds: string[] = [], taskIds: string[] = []) {
    imageIds = imageIds.flatMap((id) => {
      const image =
        workspace.imageMap.get(id) ||
        workspace.images.find((item) => String(item.id) === String(id))
      return image ? [image.id] : []
    })
    taskIds = taskIds.flatMap((id) => {
      const task = workspace.tasks.find(
        (item) => String(item.id) === String(id),
      )
      return task ? [task.id] : []
    })
    const targets = imageIds.length
      ? imageIds.map(
          (id) => workspace.imageMap.get(id)?.favoriteFolderIds || [],
        )
      : taskIds.map(
          (id) =>
            workspace.tasks.find((task) => task.id === id)?.favoriteFolderIds ||
            [],
        )
    const hasExistingFavorite = targets.some((ids) => ids.length)
    const saved = workspace.favoriteFolders
      .filter(
        (folder) =>
          targets.length && targets.every((ids) => ids.includes(folder.id)),
      )
      .map((folder) => folder.id)
    Object.assign(ui.favorite, {
      open: true,
      imageIds,
      taskIds,
      selected: [
        ...new Set(
          hasExistingFavorite
            ? saved
            : workspace.favoriteFolders
                .filter((folder) => folder.isDefault)
                .map((folder) => folder.id),
        ),
      ],
      name: '',
    })
  }
  async function saveFavorite() {
    await workspace.initialize()
    const changed: (StoredImage | GenerationTask)[] = []
    ui.favorite.imageIds.forEach((id) => {
      const image = workspace.imageMap.get(id)
      if (!image) return
      workspace.setImageFavoriteFolders(id, [...ui.favorite.selected])
      changed.push(image)
    })
    workspace.tasks.forEach((task) => {
      if (ui.favorite.taskIds.includes(task.id)) {
        task.favoriteFolderIds = [...ui.favorite.selected]
        changed.push(task)
      }
    })
    // 收藏只写目标记录, 避免复制整库图片和覆盖另一个页面新增的数据。
    await workspace.persistRecords(changed)
    selected.value = new Set()
    ui.favorite.open = false
    ui.notify('收藏夹已更新')
  }
  async function removeFavorite() {
    ui.favorite.selected = []
    await saveFavorite()
    ui.notify('已取消收藏')
  }
  function createFolder() {
    const name = ui.favorite.name.trim()
    if (!name) return
    if (workspace.favoriteFolders.some((folder) => folder.name === name)) {
      ui.notify('收藏夹名称已存在', 'error')
      return
    }
    const id = createId()
    workspace.favoriteFolders.push({ id, name, isDefault: false })
    ui.favorite.selected.push(id)
    ui.favorite.name = ''
  }
  function folderAction(action: string, id: string) {
    const folder = workspace.favoriteFolders.find((folder) => folder.id === id)
    if (!folder) return
    if (action === 'hidden') {
      folder.hidden = !folder.hidden
      selected.value = new Set()
      ui.details.open = false
      ui.viewer.open = false
    }
    if (action === 'default')
      workspace.favoriteFolders.forEach((item) => {
        item.isDefault = item.id === id
      })
    if (action === 'rename') {
      const name = prompt('收藏夹名称', folder.name)?.trim()
      if (name) folder.name = name
    }
    if (action === 'delete')
      Object.assign(ui.favoriteDelete, {
        open: true,
        folderId: id,
        deleteImages: false,
      })
  }
  async function confirmDeleteFolder() {
    await workspace.initialize()
    const id = ui.favoriteDelete.folderId
    const changed: (StoredImage | GenerationTask | GenerationBatch)[] = []
    const deleted: string[] = []
    const removedImages = new Set(
      workspace.images
        .filter((image) => image.favoriteFolderIds?.includes(id))
        .map((image) => image.id),
    )
    if (ui.favoriteDelete.deleteImages) {
      workspace.batches.forEach((batch) => {
        if (!batch.imageIds.some((imageId) => removedImages.has(imageId)))
          return
        batch.imageIds = batch.imageIds.filter(
          (imageId) => !removedImages.has(imageId),
        )
        batch.imageCount = batch.imageIds.length
        if (batch.imageIds.length) changed.push(batch)
      })
      const removedBatches = new Set(
        workspace.batches
          .filter((batch) => !batch.imageIds.length)
          .map((batch) => batch.id),
      )
      workspace.tasks = workspace.tasks.filter((task) => {
        if (!removedBatches.has(task.batchId || '')) return true
        deleted.push(task.id)
        return false
      })
      deleted.push(...removedBatches)
      workspace.batches = workspace.batches.filter(
        (batch) => batch.imageIds.length,
      )
    }
    workspace.images = workspace.images.map((image) => {
      if (!removedImages.has(image.id)) return image
      const updated = {
        ...image,
        favoriteFolderIds:
          ui.favoriteDelete.deleteImages && removedImages.has(image.id)
            ? []
            : image.favoriteFolderIds?.filter((folder) => folder !== id),
      }
      changed.push(updated)
      return updated
    })
    workspace.tasks.forEach((task) => {
      if (!task.favoriteFolderIds?.includes(id)) return
      task.favoriteFolderIds = task.favoriteFolderIds?.filter(
        (folder) => folder !== id,
      )
      changed.push(task)
    })
    workspace.favoriteFolders = workspace.favoriteFolders.filter(
      (folder) => folder.id !== id,
    )
    if (!workspace.favoriteFolders.length)
      workspace.favoriteFolders.push({
        id: 'favorites-default',
        name: '默认收藏夹',
        isDefault: true,
      })
    if (!workspace.favoriteFolders.some((folder) => folder.isDefault))
      workspace.favoriteFolders[0].isDefault = true
    ui.favoriteDelete.open = false
    folderId.value = ''
    await workspace.persistRecords(changed, deleted)
    await workspace.collectUnusedImages()
  }
  async function action(action: string, card: HistoryCard) {
    await workspace.initialize()
    const batch = workspace.batches.find((item) => item.id === card.batchId)
    const task = workspace.tasks.find((item) => item.id === card.taskId)
    if (action === 'cover' && card.image && library.value === 'favorites') {
      const folder = workspace.favoriteFolders.find(
        (item) => item.id === folderId.value,
      )
      if (folder)
        folder.coverImageId =
          effectiveCoverId(folder.id) === card.image.id ? null : card.image.id
    } else if (action === 'favorite') openFavorite(card.favoriteImageIds)
    else if (action === 'favorite-task') openFavorite([], [card.taskId])
    else if (action === 'reuse-task' && task) generator.reuseTask(task)
    else if (action === 'retry-task' && task) await generator.retryTask(task)
    else if (action === 'config' && batch)
      generator.applyConfig(batch.config, batch.prompt, batch.referenceImageIds)
    else if (action === 'edit' && batch) {
      await generator.editOutput(card.images)
    } else if (action === 'download' || action === 'download-all') {
      for (const image of action === 'download-all'
        ? card.images
        : card.image
          ? [card.image]
          : [])
        await downloadImage(image.src)
    } else if (action === 'delete' || action === 'delete-task')
      await deleteCards([card])
  }
  async function downloadSelected() {
    for (const card of cards.value.filter((card) =>
      selected.value.has(card.key),
    ))
      await action(card.isGroup ? 'download-all' : 'download', card)
  }
  return {
    library,
    mode,
    folderId,
    query,
    status,
    selected,
    isFolderIndex,
    title,
    folders,
    hasGroups,
    cards,
    viewImages,
    effectiveCoverId,
    setLibrary,
    setMode,
    openFolder,
    toggleSelection,
    openCard,
    deleteCards,
    selectAll,
    invertSelection,
    openFavorite,
    saveFavorite,
    removeFavorite,
    createFolder,
    folderAction,
    confirmDeleteFolder,
    action,
    downloadSelected,
  }
})
