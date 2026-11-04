import { defineStore } from 'pinia'
import { useInterfaceStore } from './interface'
import { copyImage, downloadImage } from '../utils/images'
import { errorMessage } from '../utils/format'

export const useViewerStore = defineStore('image-viewer', () => {
  const ui = useInterfaceStore()
  function open(sources: string[], index = 0) {
    ui.openViewer(sources, index)
  }
  function close() {
    ui.viewer.open = false
  }
  function next(direction: number) {
    const count = ui.viewer.sources.length
    if (count) ui.viewer.index = (ui.viewer.index + direction + count) % count
  }
  async function copy() {
    const source = ui.viewer.sources[ui.viewer.index]
    if (!source) return
    try {
      await copyImage(source)
      ui.notify('图片已复制')
    } catch (error) {
      ui.notify(errorMessage(error), 'error')
    }
  }
  async function download() {
    const source = ui.viewer.sources[ui.viewer.index]
    try {
      if (source) await downloadImage(source)
    } catch (error) {
      ui.notify(errorMessage(error), 'error')
    }
  }
  return { open, close, next, copy, download }
})
