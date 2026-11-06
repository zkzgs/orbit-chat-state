<script setup lang="ts">
import { ref } from 'vue'
import { useImageGenerationStore } from '../stores/image-generation'
import { usePromptTemplatesStore } from '../stores/prompt-templates'
import { useImageSizeStore } from '../stores/image-size'
import { inputFiles, pastedImages } from '../utils/events'
import ReferenceImages from '../components/ReferenceImages.vue'
import PromptEditor from '../components/PromptEditor.vue'
import CustomSelect from '../components/CustomSelect.vue'
import { useWorkspaceStore } from '../stores/workspace'
const workspace = useWorkspaceStore()
const image = useImageGenerationStore()
const templates = usePromptTemplatesStore()
const size = useImageSizeStore()
const promptEditor = ref<InstanceType<typeof PromptEditor> | null>(null)
function paste(event: ClipboardEvent) {
  const files = pastedImages(event)
  if (files.length) {
    event.preventDefault()
    void image.addReferences(files)
  }
}
function drop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length) {
    event.preventDefault()
    void image.addReferences(files)
  }
}
</script>

<template>
  <div class="image-generator-column">
    <div class="image-copy">
      <div class="welcome-kicker">
        <span class="sparkle">✦</span> Image studio
      </div>
      <h2>把描述, 变成<br /><em>一张画面</em></h2>
    </div>
    <div class="image-generator-panel" @dragover.prevent @drop="drop">
      <div class="panel-label-row">
        <span>描述你想要的画面</span>
        <div class="panel-label-actions">
          <span class="panel-label-hint">支持中文, 可粘贴参考图</span
          ><button
            class="field-action"
            id="polishImagePrompt"
            type="button"
            @click="templates.openPolish()"
          >
            润色关键词
          </button>
        </div>
      </div>
      <div class="profile-manager image-prompt-template-manager">
        <label class="profile-select-label"
          >关键词模板<CustomSelect
            id="imagePromptTemplateSelect"
            aria-label="选择生图关键词模板"
            :model-value="workspace.state.settings.activeImagePromptTemplateId"
            :options="[
              { value: '', label: '临时关键词(未保存)' },
              ...workspace.state.settings.imagePromptTemplates.map(
                (template) => ({ value: template.id, label: template.name }),
              ),
            ]"
            @change="templates.selectPrompt($event)"
        /></label>
        <div class="profile-actions">
          <button
            class="secondary-button"
            id="saveImagePromptTemplate"
            type="button"
            @click="templates.savePrompt()"
          >
            另存为</button
          ><button
            :disabled="!workspace.state.settings.activeImagePromptTemplateId"
            class="secondary-button"
            id="updateImagePromptTemplate"
            type="button"
            @click="templates.savePrompt(true)"
          >
            更新</button
          ><button
            :disabled="!workspace.state.settings.activeImagePromptTemplateId"
            class="secondary-button profile-delete"
            id="deleteImagePromptTemplate"
            type="button"
            title="删除当前关键词模板"
            aria-label="删除当前关键词模板"
            @click="templates.deletePrompt()"
          >
            ×
          </button>
        </div>
        <small class="profile-help"
          >模板保存关键词和生成参考图, 不保存尺寸, 质量等生成参数</small
        >
      </div>
      <PromptEditor
        ref="promptEditor"
        id="imagePrompt"
        v-model="image.prompt"
        :images="image.references"
        placeholder="例如: 雨后的上海街头, 霓虹倒影, 35mm 胶片质感, 电影感构图"
        @paste="paste"
        @drop="image.addReferences($event)"
      />
      <div class="reference-row">
        <div class="reference-upload-actions">
          <label class="reference-upload"
            ><span>⊕</span> 添加参考图<input
              type="file"
              id="imageReferenceUpload"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              @change="image.addReferences(inputFiles($event))" /></label
          ><button
            class="reference-clear"
            id="clearImageReferences"
            type="button"
            :disabled="!image.references.length"
            @click="image.clearReferences()"
          >
            清空
          </button>
        </div>
        <div class="reference-options">
          <span
            v-if="image.references.length"
            id="imageReferenceCount"
            class="panel-label-hint"
          >
            {{ image.references.length }} 张参考图
          </span>
          <div
            id="imageRequestType"
            class="image-request-toggle"
            role="radiogroup"
            aria-label="请求接口"
          >
            <label
              ><input
                v-model="image.requestType"
                type="radio"
                name="imageRequestType"
                value="generation"
              /><span>生图</span></label
            >
            <label
              ><input
                v-model="image.requestType"
                type="radio"
                name="imageRequestType"
                value="edit"
              /><span>改图</span></label
            >
          </div>
        </div>
      </div>
      <ReferenceImages
        id="imageReferencePreview"
        :images="image.references"
        @remove="image.removeReference"
        @replace="image.replaceReference"
        @move="image.moveReference"
        @mention="promptEditor?.insertReference($event)"
      />
      <div class="image-controls">
        <label class="select-control image-size-control"
          ><span>尺寸</span
          ><button
            class="size-button"
            id="imageSizeButton"
            type="button"
            @click="size.open()"
          >
            {{ size.label }}</button
          ><select
            v-model="workspace.state.settings.imageOptions.ratio"
            id="imageRatio"
            hidden
          >
            <option value="auto">自动</option>
            <option value="1:1">1:1 方形</option>
            <option value="3:2">3:2 横向</option>
            <option value="2:3">2:3 竖向</option>
            <option value="16:9">16:9 横向</option>
            <option value="9:16">9:16 竖向</option>
            <option value="4:3">4:3 横向</option>
            <option value="3:4">3:4 竖向</option>
            <option value="21:9">21:9 超宽</option>
          </select></label
        >
        <label class="select-control"
          ><span>质量</span
          ><CustomSelect
            v-model="workspace.state.settings.imageOptions.quality"
            id="imageQuality"
            :options="[
              { value: 'auto', label: '自动' },
              { value: 'low', label: '低' },
              { value: 'medium', label: '中' },
              { value: 'high', label: '高' },
              { value: 'xhigh', label: '极高' },
              { value: 'max', label: '最高' },
              { value: 'standard', label: '标准, DALL-E' },
              { value: 'hd', label: 'HD, DALL-E' },
            ]"
        /></label>
        <label class="select-control"
          ><span>思考</span
          ><CustomSelect
            v-model="workspace.state.settings.imageOptions.reasoningEffort"
            id="imageReasoningEffort"
            :options="[
              { value: 'auto', label: '自动' },
              { value: 'low', label: '低' },
              { value: 'medium', label: '中' },
              { value: 'high', label: '高' },
            ]"
        /></label>
        <label class="select-control"
          ><span>格式</span
          ><CustomSelect
            v-model="workspace.state.settings.imageOptions.format"
            id="imageFormat"
            :options="[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG（JPG）' },
              { value: 'webp', label: 'WebP' },
              { value: 'gif', label: 'GIF' },
              { value: 'svg', label: 'SVG' },
            ]"
        /></label>
        <label class="select-control compression-control"
          ><span>输出压缩 (%)</span
          ><input
            v-model.number="workspace.state.settings.imageOptions.compression"
            id="imageCompression"
            type="number"
            min="0"
            max="100"
            step="1"
            inputmode="numeric"
        /></label>
        <label class="select-control"
          ><span>输出透明度</span
          ><CustomSelect
            v-model="workspace.state.settings.imageOptions.background"
            id="imageBackground"
            :options="[
              { value: 'auto', label: '自动' },
              { value: 'opaque', label: '不透明' },
              { value: 'transparent', label: '透明' },
            ]"
        /></label>
        <label class="select-control"
          ><span>审核</span
          ><CustomSelect
            v-model="workspace.state.settings.imageOptions.moderation"
            id="imageModeration"
            :options="[
              { value: 'auto', label: '自动' },
              { value: 'low', label: '宽松' },
            ]"
        /></label>
        <label class="select-control count-control"
          ><span>数量</span
          ><input
            v-model.number="workspace.state.settings.imageOptions.count"
            id="imageCount"
            type="number"
            min="1"
            max="10"
        /></label>
      </div>
      <div class="image-controls-foot">
        <button
          class="primary-button"
          id="generateImage"
          :disabled="!workspace.ready"
          @click="image.generate()"
        >
          <span>✦</span> 生成图片
        </button>
      </div>
    </div>
  </div>
</template>
