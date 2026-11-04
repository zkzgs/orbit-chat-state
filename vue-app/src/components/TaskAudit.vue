<script setup lang="ts">
import { useInterfaceStore } from '../stores/interface'
const ui = useInterfaceStore()
</script>
<template>
  <div
    id="taskAuditBackdrop"
    class="modal-backdrop"
    :hidden="!ui.audit.open"
    @click.self="ui.audit.open = false"
  >
    <section
      class="settings-modal task-audit-modal"
      role="dialog"
      aria-modal="true"
    >
      <header class="modal-header">
        <h2>请求记录</h2>
        <button
          id="closeTaskAudit"
          class="icon-button"
          aria-label="关闭"
          @click="ui.audit.open = false"
        >
          ×
        </button>
      </header>
      <div class="task-audit-body">
        <pre id="taskAuditContent">{{ ui.audit.content }}</pre>
      </div>
    </section>
  </div>
</template>
