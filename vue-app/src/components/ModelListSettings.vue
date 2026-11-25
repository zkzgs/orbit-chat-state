<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'
import type { ApiKind } from '../types/models'

const props = defineProps<{ kind: ApiKind }>()
const value = defineModel<string>({ default: '' })
const settings = useSettingsStore()
const workspace = useWorkspaceStore()
const mode = ref<'' | 'select' | 'manual'>('')
const query = ref('')
const manual = ref('')
const picked = ref<string[]>([])
const models = computed(() => [...new Set(value.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))])
const source = computed(() => workspace.modelCatalog[props.kind])
const visible = computed(() => source.value.filter((id) => id.toLowerCase().includes(query.value.trim().toLowerCase())))
const allPicked = computed(() => source.value.length > 0 && source.value.every((id) => picked.value.includes(id)))
const anyPicked = computed(() => source.value.some((id) => picked.value.includes(id)))

function selectAll(selected: boolean) {
  picked.value = selected
    ? [...new Set([...picked.value, ...source.value])]
    : picked.value.filter((id) => !source.value.includes(id))
}
watch(() => [settings.draft[`${props.kind}BaseUrl`], settings.draft[`${props.kind}ApiKey`], props.kind === 'image' ? settings.draft.imageProvider : '', workspace.state.activeConnectionProfiles[props.kind]], () => { mode.value = ''; manual.value = '' })
watch(() => [props.kind === 'image' ? settings.draft.imageProvider : '', workspace.state.activeConnectionProfiles[props.kind]], () => settings.ensureModels(props.kind))

function save(items: string[]) {
  value.value = [...new Set(items)].join('\n')
  mode.value = ''
}
function choose() {
  if (mode.value === 'select') { mode.value = ''; return }
  picked.value = [...models.value]
  query.value = ''
  mode.value = 'select'
}
function add() {
  const id = manual.value.trim()
  if (!id || /[\r\n]/.test(id)) return
  save([...models.value, id])
  manual.value = ''
}
</script>

<template>
  <section class="configured-models" :aria-label="kind === 'chat' ? '对话模型列表' : '生图模型列表'">
    <div class="configured-models-bar">
      <strong>模型列表</strong>
      <button type="button" class="secondary-button" @click="choose">选择模型</button>
      <button type="button" class="secondary-button" @click="mode = mode === 'manual' ? '' : 'manual'">手动添加</button>
    </div>
    <div v-if="mode === 'select'" class="model-source-picker">
      <div class="configured-models-bar model-source-toolbar">
        <input v-model="query" type="search" aria-label="搜索接口模型" placeholder="搜索接口模型" />
        <div class="model-source-actions">
        <button type="button" class="secondary-button" :disabled="settings.loadingModels[kind]" @click="settings.loadModels(kind)">{{ settings.loadingModels[kind] ? '获取中...' : '获取模型' }}</button>
        <button type="button" class="secondary-button" :disabled="!source.length || allPicked" @click="selectAll(true)">全选</button>
        <button type="button" class="secondary-button" :disabled="!anyPicked" @click="selectAll(false)">全不选</button>
        </div>
      </div>
      <div class="model-source-options">
        <label v-for="id in visible" :key="id"><input v-model="picked" type="checkbox" :value="id" /> <span>{{ id }}</span></label>
        <div v-if="!visible.length" class="model-menu-status" role="status">{{ settings.loadingModels[kind] ? '正在获取模型…' : settings.modelStatus[kind] || '没有匹配的模型' }}</div>
      </div>
      <div class="configured-models-bar">
        <button type="button" class="secondary-button" @click="mode = ''">取消</button>
        <button type="button" class="secondary-button" @click="save(picked)">应用</button>
      </div>
    </div>
    <div v-if="mode === 'manual'" class="configured-models-bar">
      <input v-model="manual" type="text" aria-label="模型 ID" placeholder="填写实际请求的模型 ID" spellcheck="false" @keydown.enter.prevent="add" />
      <button type="button" class="secondary-button" :disabled="!manual.trim()" @click="add">添加</button>
    </div>
    <ul v-if="models.length" class="configured-model-items">
      <li v-for="id in models" :key="id"><span>{{ id }}</span><button type="button" class="secondary-button" :aria-label="`移除 ${id}`" @click="save(models.filter((item) => item !== id))">移除</button></li>
    </ul>
  </section>
</template>
