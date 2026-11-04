import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import type {
  GenerationBatch,
  GenerationTask,
  WorkspaceView,
} from '../types/models'

export const useInterfaceStore = defineStore('interface', () => {
  const activeView = ref<WorkspaceView>('image')
  const sidebarOpen = ref(false)
  const settingsOpen = ref(false)
  const sizeOpen = ref(false)
  const polishOpen = ref(false)
  const exportMenuOpen = ref(false)
  const toast = reactive({
    open: false,
    message: '',
    kind: 'info' as 'info' | 'error' | 'warning',
  })
  const viewer = reactive({ open: false, sources: [] as string[], index: 0 })
  const details = reactive({
    open: false,
    batchId: '',
    taskId: '',
    imageId: '',
    index: 0,
  })
  const favorite = reactive({
    open: false,
    imageIds: [] as string[],
    taskIds: [] as string[],
    selected: [] as string[],
    name: '',
  })
  const favoriteDelete = reactive({
    open: false,
    folderId: '',
    deleteImages: false,
  })
  const audit = reactive({ open: false, content: '' })
  const dataScope = reactive({
    open: false,
    action: 'export' as 'export' | 'clear',
  })
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  function notify(
    message: string,
    kind: 'info' | 'error' | 'warning' = 'info',
  ) {
    clearTimeout(toastTimer)
    Object.assign(toast, { open: true, message, kind })
    if (kind !== 'error')
      toastTimer = setTimeout(() => {
        toast.open = false
      }, 3200)
  }
  function openViewer(sources: string[], index = 0) {
    Object.assign(viewer, { open: true, sources, index })
  }
  function openDetails(
    batch?: GenerationBatch,
    task?: GenerationTask,
    index = 0,
    imageId = '',
  ) {
    Object.assign(details, {
      open: true,
      batchId: batch?.id || '',
      taskId: task?.id || batch?.taskId || '',
      index,
      imageId,
    })
  }
  function closeTopDialog() {
    if (viewer.open) viewer.open = false
    else if (favoriteDelete.open) favoriteDelete.open = false
    else if (favorite.open) favorite.open = false
    else if (audit.open) audit.open = false
    else if (details.open) details.open = false
    else if (polishOpen.value) polishOpen.value = false
    else if (sizeOpen.value) sizeOpen.value = false
    else if (dataScope.open) dataScope.open = false
    else if (settingsOpen.value) settingsOpen.value = false
    else {
      toast.open = false
      exportMenuOpen.value = false
      sidebarOpen.value = false
    }
  }
  function dispose() {
    clearTimeout(toastTimer)
  }
  return {
    activeView,
    sidebarOpen,
    settingsOpen,
    sizeOpen,
    polishOpen,
    exportMenuOpen,
    toast,
    viewer,
    details,
    favorite,
    favoriteDelete,
    audit,
    dataScope,
    notify,
    openViewer,
    openDetails,
    closeTopDialog,
    dispose,
  }
})
