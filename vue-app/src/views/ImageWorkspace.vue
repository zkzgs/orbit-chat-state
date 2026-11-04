<script setup lang="ts">
import ImageGenerator from './ImageGenerator.vue'
import ImageHistory from './ImageHistory.vue'
</script>

<template>
  <div class="image-view" id="imageView">
    <div class="image-workspace"><ImageGenerator /><ImageHistory /></div>
  </div>
</template>
