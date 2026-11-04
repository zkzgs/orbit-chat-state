<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
import { useImageGenerationStore } from '../stores/image-generation'
import { useChatStore } from '../stores/chat'
import { useImageInfo } from '../composables/useImageInfo'
import { copyImage, downloadImage } from '../utils/images'
import {
  formatBytes,
  formatDuration,
  formatTime,
  errorMessage,
} from '../utils/format'
import { createId } from '../utils/id'
import MetadataComparison from './MetadataComparison.vue'
import {
  actualRatio,
  sizeToRatio,
  formatImageConfig,
} from '../utils/image-details'
import { imageSize } from '../utils/image-options'
import type { ImageConfig } from '../types/models'

const workspace = useWorkspaceStore()
const ui = useInterfaceStore()
const generator = useImageGenerationStore()
const chat = useChatStore()
const batch = computed(() =>
  workspace.batches.find((item) => item.id === ui.details.batchId),
)
const task = computed(() =>
  workspace.tasks.find((item) => item.id === ui.details.taskId),
)
const images = computed(() =>
  batch.value
    ? workspace.batchImages(batch.value)
    : workspace.messageImages(ui.details.imageId ? [ui.details.imageId] : []),
)
const image = computed(() => images.value[ui.details.index])
const config = computed(
  () => image.value?.config || batch.value?.config || task.value?.config,
)
const references = computed(() =>
  workspace.messageImages(
    batch.value?.referenceImageIds || task.value?.referenceImageIds || [],
  ),
)
const info = useImageInfo(() => (ui.details.open ? image.value?.src || '' : ''))
type MetadataRow = {
  label: string
  value?: string
  full?: boolean
  comparison?: {
    requested: string
    actual: string
    actualLabel: string
    ratio?: boolean
  }
}
const response = computed(
  () =>
    ({
      ...batch.value?.responseMeta,
      ...image.value?.responseMeta,
      ...(task.value
        ? {
            requestLog: task.value.requestLog,
            responses: task.value.responses,
            error: task.value.error,
          }
        : {}),
    }) as Record<string, any>,
)
const rawRequest = computed(() =>
  ui.details.open && response.value.requestLog
    ? JSON.stringify(response.value.requestLog, null, 2)
    : '',
)
const rawResponse = computed(() => {
  if (!ui.details.open) return ''
  const record =
    response.value.upstreamResponse ||
    (response.value.responses?.length
      ? response.value.responses
      : response.value.apiResponse)
  return record ? JSON.stringify(record, null, 2) : ''
})
const metadata = computed<MetadataRow[]>(() => {
  const current = image.value
  const options: Partial<ImageConfig> = config.value || {}
  const result = response.value
  const dimensions = String(result.size || '').match(/^(\d+)x(\d+)$/i)
  const width =
    info.value?.width ||
    current?.width ||
    result.width ||
    result.output_width ||
    Number(dimensions?.[1])
  const height =
    info.value?.height ||
    current?.height ||
    result.height ||
    result.output_height ||
    Number(dimensions?.[2])
  const requestSize = options.size || imageSize(options as ImageConfig)
  const size = width && height ? `${width} × ${height}` : ''
  const ratio = width && height ? actualRatio(width, height) : ''
  const formatValue =
    info.value?.detectedFormat ||
    info.value?.format ||
    current?.format ||
    result.format ||
    result.output_format ||
    ''
  const format =
    formatValue === 'jpg'
      ? 'jpeg'
      : formatValue === 'svg+xml'
        ? 'svg'
        : formatValue
  const model = result.model || result.apiResponse?.model || ''
  const background =
    info.value?.hasTransparency === undefined
      ? ''
      : info.value.hasTransparency
        ? 'transparent'
        : 'opaque'
  const source = current?.src || ''
  const dataKind = !current
    ? '未生成图片'
    : result.delivery === 'b64_json'
      ? result.providedUrl
        ? 'b64_json（同时返回 URL）'
        : 'b64_json'
      : result.delivery === 'url'
        ? source.startsWith('data:')
          ? '接口 URL（已保存为本地 Base64）'
          : '接口 URL'
        : source.startsWith('data:')
          ? '本地 Base64 数据'
          : '本地对象'
  const compare = (
    label: string,
    requested: string,
    actual: string,
    actualLabel = actual || '响应未提供',
    ratio = false,
    full = false,
  ): MetadataRow => ({
    label,
    comparison: { requested, actual, actualLabel, ratio },
    full,
  })
  const rows: MetadataRow[] = [
    compare(
      '请求 / 实际模型',
      options.model || workspace.state.settings.imageModel || '未知',
      model,
      model || '响应未提供',
      false,
      true,
    ),
    {
      label: '来源',
      value:
        result.source || workspace.state.settings.imageBaseUrl || '演示模式',
      full: true,
    },
  ]
  if (!current)
    rows.push({
      label: '错误信息',
      value: task.value?.error?.message || task.value?.detail || '生成失败',
      full: true,
    })
  rows.push(
    compare('请求 / 实际尺寸', requestSize, size),
    compare(
      '请求 / 实际比例',
      options.ratio && options.ratio !== 'auto'
        ? options.ratio
        : sizeToRatio(requestSize) || '自动',
      ratio,
      ratio || '响应未提供',
      true,
    ),
    compare('请求 / 实际格式', options.format || 'png', format),
    compare(
      '请求 / 实际数量',
      String(options.count || 1),
      images.value.length ? String(images.value.length) : '',
      images.value.length ? String(images.value.length) : '未生成',
    ),
    { label: '质量', value: options.quality || 'auto' },
    {
      label: '压缩',
      value: ['jpeg', 'webp'].includes(options.format || '')
        ? `${options.compression ?? 'auto'}${options.compression === undefined ? '' : '%'}`
        : 'PNG 不支持',
    },
    compare(
      '选项 / 实际透明度',
      options.background || 'auto',
      background,
      background || '未检测',
    ),
    {
      label: '审核',
      value:
        result.moderationSent === false
          ? '演示模式未发送'
          : options.moderation || 'auto',
    },
    { label: '参考图', value: `${references.value.length} 张` },
    { label: '数据来源', value: dataKind },
    {
      label: '文件大小',
      value: !current
        ? '未生成'
        : formatBytes(info.value?.fileSize || current.fileSize || 0),
    },
    {
      label: '创建时间',
      value: formatTime(
        batch.value?.startedAt ||
          batch.value?.createdAt ||
          task.value?.startedAt ||
          current?.createdAt ||
          0,
      ),
    },
    {
      label: '耗时',
      value: formatDuration(
        batch.value?.durationMs ||
          (task.value?.finishedAt || task.value?.startedAt || 0) -
            (task.value?.startedAt || 0),
      ),
    },
    {
      label: '完整请求配置',
      value: formatImageConfig(
        options,
        current?.prompt || batch.value?.prompt || task.value?.prompt || '',
      ),
      full: true,
    },
  )
  if (result.revised_prompt)
    rows.push({
      label: '接口修订提示词',
      value: result.revised_prompt,
      full: true,
    })
  rows.push({
    label: '接口响应',
    full: true,
    value: JSON.stringify({
      status: result.status || (!current ? 'error' : ''),
      requestId: result.requestId || result.apiResponse?.requestId || '',
      id: result.id || result.apiResponse?.id || '',
      created: result.created || result.apiResponse?.created || '',
      model,
      usage: result.usage || result.apiResponse?.usage || undefined,
    }),
  })
  return rows
})
function move(direction: number) {
  if (images.value.length)
    ui.details.index =
      (ui.details.index + direction + images.value.length) % images.value.length
}
function reuse() {
  if (config.value)
    generator.applyConfig(
      config.value,
      batch.value?.prompt || task.value?.prompt || '',
      references.value.map((item) => item.id),
    )
}
async function action(kind: 'copy' | 'download' | 'all' | 'chat' | 'edit') {
  const current = image.value
  if (!current) return
  try {
    if (kind === 'copy') {
      await copyImage(current.src)
      ui.notify('图片已复制')
    }
    if (kind === 'download' || kind === 'all')
      for (const item of kind === 'all' ? images.value : [current])
        await downloadImage(item.src)
    if (kind === 'chat') {
      chat.attachments.push({
        id: createId(),
        imageId: current.id,
        data: current.src,
        name: current.name || '生成图片',
      })
      ui.activeView = 'chat'
      ui.details.open = false
    }
    if (kind === 'edit') {
      await generator.editOutput(images.value)
    }
  } catch (error) {
    ui.notify(errorMessage(error), 'error')
  }
}
</script>
<template>
  <div
    id="imageLightbox"
    class="image-lightbox"
    :hidden="!ui.details.open"
    @click.self="ui.details.open = false"
  >
    <section
      class="lightbox-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lightboxTitle"
    >
      <div class="lightbox-header">
        <div>
          <div class="eyebrow">Image details</div>
          <h2 id="lightboxTitle">
            {{
              !image
                ? '生成失败'
                : images.length > 1
                  ? `生成详情 · ${ui.details.index + 1}/${images.length}`
                  : '生成详情'
            }}
          </h2>
        </div>
        <button
          id="closeLightbox"
          class="icon-button"
          aria-label="关闭详情"
          @click="ui.details.open = false"
        >
          ×
        </button>
      </div>
      <div class="lightbox-body">
        <div
          id="lightboxImageWrap"
          class="lightbox-image-wrap"
          :class="{ 'is-error': !image }"
        >
          <template v-if="image"
            ><img
              id="lightboxImage"
              :src="image.src"
              alt="生成图片全图"
              draggable="false"
              @click="
                ui.openViewer(
                  images.map((item) => item.src),
                  ui.details.index,
                )
              "
            />
            <button
              v-if="images.length > 1"
              id="lightboxPrevious"
              class="detail-nav detail-nav-prev"
              aria-label="上一张"
              @click="move(-1)"
            >
              ‹
            </button>
            <button
              v-if="images.length > 1"
              id="lightboxNext"
              class="detail-nav detail-nav-next"
              aria-label="下一张"
              @click="move(1)"
            >
              ›
            </button></template
          >
          <div v-else id="lightboxErrorState" class="lightbox-error-state">
            <span class="lightbox-error-state-symbol">!</span
            ><strong>{{
              task?.status === 'running' ? '生成中' : '生成失败'
            }}</strong>
            <p id="lightboxErrorMessage">
              {{ task?.error?.message || task?.detail }}
            </p>
          </div>
        </div>
        <aside class="lightbox-details">
          <div
            v-if="references.length"
            id="lightboxReferenceSection"
            class="lightbox-reference-section"
          >
            <div class="details-section-title">参考图</div>
            <div
              id="lightboxReferenceThumbnails"
              class="lightbox-reference-thumbnails"
            >
              <button
                v-for="(item, index) in references"
                :key="item.id"
                class="lightbox-reference-button"
                @click="
                  ui.openViewer(
                    references.map((item) => item.src),
                    index,
                  )
                "
              >
                <img :src="item.src" :alt="`参考图 ${index + 1}`" />
              </button>
            </div>
          </div>
          <div id="lightboxThumbnails" class="lightbox-thumbnails">
            <button
              v-for="(item, index) in images"
              :key="item.id"
              class="lightbox-thumb"
              :class="{ active: index === ui.details.index }"
              :data-lightbox-index="index"
              @click="ui.details.index = index"
            >
              <img
                :src="item.src"
                :alt="`第 ${index + 1} 张图片`"
                loading="lazy"
              />
            </button>
          </div>
          <dl id="imageMetadata" class="image-metadata">
            <div
              v-for="row in metadata"
              :key="row.label"
              class="metadata-card"
              :class="{ full: row.full }"
            >
              <dt>{{ row.label }}</dt>
              <dd>
                <MetadataComparison
                  v-if="row.comparison"
                  v-bind="row.comparison"
                />
                <template v-else>{{ row.value }}</template>
              </dd>
              <details
                v-if="row.label === '完整请求配置' && rawRequest"
                class="metadata-disclosure"
              >
                <summary>查看实际请求</summary>
                <pre>{{ rawRequest }}</pre>
              </details>
              <details
                v-if="row.label === '接口响应' && rawResponse"
                class="metadata-disclosure"
              >
                <summary>查看上游响应</summary>
                <pre>{{ rawResponse }}</pre>
              </details>
            </div>
          </dl>
        </aside>
      </div>
      <div class="lightbox-footer">
        <span id="lightboxPrompt">{{ batch?.prompt || task?.prompt }}</span>
        <div class="lightbox-actions">
          <button
            id="lightboxReuse"
            class="secondary-button"
            :disabled="!config"
            @click="reuse"
          >
            {{ image ? '复用配置' : '恢复配置' }}
          </button>
          <button
            id="lightboxCopyImage"
            class="secondary-button"
            :disabled="!image"
            :hidden="!image"
            @click="action('copy')"
          >
            复制图片
          </button>
          <button
            id="lightboxDownload"
            class="secondary-button"
            :disabled="!image"
            :hidden="!image"
            @click="action('download')"
          >
            下载原图
          </button>
          <button
            v-if="images.length > 1"
            id="lightboxDownloadAll"
            class="secondary-button"
            @click="action('all')"
          >
            下载全部
          </button>
          <button
            id="lightboxCopyChat"
            class="secondary-button"
            :disabled="!image"
            :hidden="!image"
            @click="action('chat')"
          >
            发到对话
          </button>
          <button
            id="lightboxEdit"
            class="primary-button"
            :disabled="!image"
            :hidden="!image"
            @click="action('edit')"
          >
            编辑输出
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
