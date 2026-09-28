<script setup>
import { X } from '@lucide/vue'

defineProps({ title: { type: String, required: true }, wide: Boolean })
defineEmits(['close'])
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="$emit('close')">
    <section class="modal" :class="{ 'modal--wide': wide }" role="dialog" aria-modal="true" :aria-label="title">
      <header class="modal__header">
        <h2>{{ title }}</h2>
        <button class="icon-button" type="button" title="关闭" aria-label="关闭" @click="$emit('close')">
          <X :size="20" />
        </button>
      </header>
      <div class="modal__body"><slot /></div>
    </section>
  </div>
</template>
