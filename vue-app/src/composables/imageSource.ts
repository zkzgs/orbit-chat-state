import type { ObjectDirective } from 'vue'
import { imageStorage } from '../storage/database'

export const imageSource: ObjectDirective<
  HTMLImageElement | HTMLVideoElement,
  string | undefined
> = {
  mounted(element, binding) {
    imageStorage.bindImage(element, binding.value, !binding.modifiers.full)
  },
  updated(element, binding) {
    imageStorage.bindImage(element, binding.value, !binding.modifiers.full)
  },
  beforeUnmount(element) {
    imageStorage.unbindImage(element)
  },
}
