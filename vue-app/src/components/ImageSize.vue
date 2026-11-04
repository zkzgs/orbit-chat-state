<script setup lang="ts">
import { RATIOS } from '../constants/workspace'
import { useImageSizeStore } from '../stores/image-size'
import { useInterfaceStore } from '../stores/interface'
import CustomSelect from './CustomSelect.vue'
const ui = useInterfaceStore()
const size = useImageSizeStore()
function selectRatio(ratio: string) {
  size.setMode('ratio')
  size.draft.ratio = ratio
}
</script>

<template>
  <div :hidden="!ui.sizeOpen" class="modal-backdrop" id="imageSizeBackdrop">
    <section
      class="settings-modal image-size-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="imageSizeTitle"
    >
      <div class="modal-header">
        <div>
          <div class="eyebrow">Image size</div>
          <h2 id="imageSizeTitle">设置图像尺寸</h2>
          <p class="modal-subtitle" id="imageSizeCurrent">
            当前: {{ size.preview }}
          </p>
        </div>
        <button
          class="icon-button"
          id="closeImageSize"
          title="关闭尺寸设置"
          aria-label="关闭尺寸设置"
          @click="size.cancel()"
        >
          ×
        </button>
      </div>
      <div class="size-dialog-body">
        <div class="size-mode-tabs" role="tablist">
          <button
            type="button"
            data-size-mode="auto"
            :class="{ active: size.draft.sizeMode === 'auto' }"
            @click="size.setMode('auto')"
          >
            自动</button
          ><button
            type="button"
            data-size-mode="ratio"
            :class="{ active: size.draft.sizeMode === 'ratio' }"
            @click="size.setMode('ratio')"
          >
            按比例</button
          ><button
            type="button"
            data-size-mode="custom"
            :class="{ active: size.draft.sizeMode === 'custom' }"
            @click="size.setMode('custom')"
          >
            自定义宽高
          </button>
        </div>
        <div
          class="size-panel"
          data-size-panel="auto"
          :hidden="size.draft.sizeMode !== 'auto'"
        >
          <p>让模型根据提示词自动选择合适尺寸。</p>
        </div>
        <div
          class="size-panel"
          data-size-panel="ratio"
          :hidden="size.draft.sizeMode !== 'ratio'"
        >
          <label class="field-label"
            >基准分辨率<CustomSelect
              v-model="size.draft.resolution"
              id="imageResolution"
              :options="[
                { value: '1K', label: '1K' },
                { value: '2K', label: '2K' },
                { value: '4K', label: '4K' },
              ]"
          /></label>
          <div class="ratio-grid" id="ratioGrid">
            <button
              v-for="ratio in RATIOS"
              :key="ratio"
              type="button"
              class="ratio-choice"
              :data-ratio="ratio"
              :class="{ active: size.draft.ratio === ratio }"
              @click="selectRatio(ratio)"
            >
              <span class="ratio-shape"></span>
              <span>{{ ratio }}</span>
            </button>
          </div>
          <button
            class="secondary-button custom-size-button"
            id="customSizeFromRatio"
            type="button"
            @click="size.setMode('custom')"
          >
            自定义比例
          </button>
        </div>
        <div
          class="size-panel"
          data-size-panel="custom"
          :hidden="size.draft.sizeMode !== 'custom'"
        >
          <p class="size-help">
            输入像素值，生成时会按模型支持的合法尺寸规整。
          </p>
          <div class="size-input-row">
            <label class="field-label"
              >宽度 (Width)<input
                v-model.number="size.draft.width"
                id="imageWidth"
                type="number"
                min="16"
                max="3840"
                step="16" /></label
            ><span>×</span
            ><label class="field-label"
              >高度 (Height)<input
                v-model.number="size.draft.height"
                id="imageHeight"
                type="number"
                min="16"
                max="3840"
                step="16"
            /></label>
          </div>
          <div class="size-info">
            最终输出尺寸由实际模型限制决定，详情弹窗会展示接口返回的实际分辨率。
          </div>
        </div>
        <div class="size-preview">
          <span>将使用</span
          ><strong id="imageSizePreview">{{ size.preview }}</strong>
        </div>
      </div>
      <div class="modal-footer">
        <button
          class="secondary-button"
          id="cancelImageSize"
          type="button"
          @click="size.cancel()"
        >
          取消
        </button>
        <div>
          <button
            class="primary-button"
            id="saveImageSize"
            type="button"
            @click="size.save()"
          >
            确定
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
