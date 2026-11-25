<script setup lang="ts">
// Bottom sheet dialog. Closes on scrim tap or Escape.
import { onBeforeUnmount, onMounted } from 'vue';
import Icon from './Icon.vue';

defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close'); };
onMounted(() => { document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden'; });
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; });
</script>
<template>
  <Teleport to="body">
    <div class="scrim" @click.self="emit('close')">
      <section class="sheet" role="dialog" aria-modal="true" :aria-label="title">
        <div class="sheet-grip" />
        <header class="sheet-head">
          <h2 class="sheet-title">{{ title }}</h2>
          <button class="icon-btn" type="button" aria-label="Close" @click="emit('close')"><Icon name="close" /></button>
        </header>
        <div class="sheet-body"><slot /></div>
      </section>
    </div>
  </Teleport>
</template>
