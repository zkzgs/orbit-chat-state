import { defineStore } from 'pinia'
import { reactive, computed } from 'vue'
import { useWorkspaceStore } from './workspace'
import { useInterfaceStore } from './interface'
import {
  imageSize,
  imageSizeLabel,
  normalizeDimensions,
} from '../utils/image-options'

export const useImageSizeStore = defineStore('image-size', () => {
  const workspace = useWorkspaceStore()
  const ui = useInterfaceStore()
  const draft = reactive({ ...workspace.state.settings.imageOptions })
  const label = computed(() =>
    imageSizeLabel(workspace.state.settings.imageOptions),
  )
  const preview = computed(() => imageSize(draft))
  function open() {
    Object.assign(draft, workspace.state.settings.imageOptions)
    ui.sizeOpen = true
  }
  function cancel() {
    Object.assign(draft, workspace.state.settings.imageOptions)
    ui.sizeOpen = false
  }
  function setMode(mode: 'auto' | 'ratio' | 'custom') {
    if (mode === 'ratio' && draft.ratio === 'auto') draft.ratio = '1:1'
    draft.sizeMode = mode
  }
  function save() {
    const dimensions =
      draft.sizeMode === 'custom'
        ? normalizeDimensions(draft.width, draft.height)
        : { width: draft.width, height: draft.height }
    Object.assign(workspace.state.settings.imageOptions, draft, dimensions)
    ui.sizeOpen = false
  }
  return { draft, label, preview, open, setMode, cancel, save }
})
