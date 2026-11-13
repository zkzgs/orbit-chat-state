<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
import { useViewerStore } from '../stores/viewer'
import { usePanzoom } from '../composables/usePanzoom'
import { useImageInfo } from '../composables/useImageInfo'
import { formatBytes } from '../utils/format'

const ui = useInterfaceStore()
const viewer = useViewerStore()
const workspace = useWorkspaceStore()
const image = ref<HTMLImageElement | null>(null)
const wrap = ref<HTMLElement | null>(null)
const source = computed(() => ui.viewer.sources[ui.viewer.index] || '')
const isVideo = computed(() => storedImage.value?.mediaType === 'video')
const storedImage = computed(() =>
  workspace.images.find((image) => image.src === source.value),
)
const info = useImageInfo(() => (ui.viewer.open ? source.value : ''))
const details = computed(() =>
  info.value
    ? [
        info.value.width + '×' + info.value.height,
        formatBytes(info.value.fileSize),
        info.value.format,
      ].join(' · ')
    : '读取图片信息中',
)
const zoom = usePanzoom(
  image,
  wrap,
  () => ui.viewer.open,
  () => source.value,
)
const scale = zoom.scale
const centered = computed(
  () =>
    scale.value <= 1.001 &&
    Math.abs(zoom.pan.value.x) < 1 &&
    Math.abs(zoom.pan.value.y) < 1,
)
</script>
<template>
  <div
    id="chatImageViewer"
    class="image-viewer"
    :hidden="!ui.viewer.open"
    @click.self="viewer.close"
    @wheel="!isVideo && zoom.wheel($event)"
  >
    <div
      id="viewerImageWrap"
      ref="wrap"
      class="viewer-image-wrap"
      @click.self="viewer.close"
      @dblclick="zoom.reset"
    >
      <img
        v-show="!isVideo"
        id="viewerImage"
        ref="image"
        v-image-source.full="ui.viewer.open && !isVideo ? source : undefined"
        alt="图片预览"
        draggable="false"
        @load="zoom.initialize"
      /><video
        v-if="ui.viewer.open && isVideo"
        id="viewerVideo"
        v-image-source.full="source"
        controls
        playsinline
        preload="metadata"
      ></video
      ><button
        v-if="ui.viewer.sources.length > 1"
        id="viewerPrevious"
        class="viewer-nav viewer-nav-prev panzoom-exclude"
        type="button"
        aria-label="上一张"
        :hidden="!centered"
        @click="viewer.next(-1)"
      >
        ‹</button
      ><button
        v-if="ui.viewer.sources.length > 1"
        id="viewerNext"
        class="viewer-nav viewer-nav-next panzoom-exclude"
        type="button"
        aria-label="下一张"
        :hidden="!centered"
        @click="viewer.next(1)"
      >
        ›
      </button>
      <div class="viewer-actions panzoom-exclude">
        <button
          id="viewerCopy"
          v-show="!isVideo"
          class="viewer-action"
          type="button"
          aria-label="复制图片"
          @click="viewer.copy"
        >
          ⧉</button
        ><button
          id="viewerDownload"
          class="viewer-action"
          type="button"
          aria-label="下载原图"
          @click="viewer.download"
        >
          ↓</button
        ><button
          id="closeImageViewer"
          class="viewer-action viewer-close"
          type="button"
          aria-label="关闭图片预览"
          @click="viewer.close"
        >
          ×
        </button>
      </div>
      <div id="viewerMeta" class="viewer-meta panzoom-exclude">
        {{
          ui.viewer.sources.length > 1
            ? `${ui.viewer.index + 1} / ${ui.viewer.sources.length} · `
            : ''
        }}{{ details }} · 缩放 {{ Math.round(scale * 100) }}%
      </div>
    </div>
  </div>
</template>
