<script setup lang="ts">
import { historyActionIcon } from '../utils/icons'

defineProps<{ action: string; label: string; active?: boolean }>()
</script>

<template>
  <button
    type="button"
    class="history-action-button"
    :class="{
      'is-favorite': active && action.startsWith('favorite'),
      'is-default': action === 'default' && active,
    }"
    :data-tooltip="label"
    :aria-label="label"
    v-html="
      historyActionIcon(
        action === 'favorite-task'
          ? 'favorite'
          : action === 'delete-task'
            ? 'delete'
            : action,
      )
    "
  />
</template>
