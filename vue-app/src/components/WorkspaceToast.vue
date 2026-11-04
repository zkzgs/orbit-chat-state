<script setup lang="ts">
import { useInterfaceStore } from '../stores/interface'
const ui = useInterfaceStore()
</script>
<template>
  <div
    id="toast"
    class="toast"
    :class="[
      ui.toast.kind,
      {
        show: ui.toast.open,
        error: ui.toast.kind === 'error',
        warning: ui.toast.kind === 'warning',
        success: ui.toast.kind === 'info',
      },
    ]"
    role="status"
    :aria-live="ui.toast.kind === 'error' ? 'assertive' : 'polite'"
  >
    <span class="toast-icon">{{ ui.toast.kind === 'error' ? '!' : '✓' }}</span
    ><span class="toast-message">{{ ui.toast.message }}</span
    ><button
      id="closeToast"
      class="toast-close"
      aria-label="关闭通知"
      @click="ui.toast.open = false"
    >
      ×
    </button>
  </div>
</template>
