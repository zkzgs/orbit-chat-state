<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  requested: string
  actual: string
  actualLabel: string
  ratio?: boolean
}>()
const missing = computed(
  () => !props.actual || ['响应未提供', '未检测'].includes(props.actualLabel),
)
const same = computed(
  () =>
    ['自动', 'auto'].includes(props.requested) ||
    props.requested === props.actual ||
    (props.ratio && props.requested === props.actual.split('≈').pop()!.trim()),
)
</script>

<template>
  <div class="metadata-value-row">
    <span>{{ requested }}</span>
    <span v-if="!missing" class="metadata-separator">→</span>
    <span class="metadata-tag" :class="{ neutral: missing || same }">{{
      actualLabel || '响应未提供'
    }}</span>
  </div>
</template>
