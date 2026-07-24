<script setup lang="ts">
interface Toast {
  id: number
  message: string
  icon: string
}

const toasts = ref<Toast[]>([])
let seq = 0

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

function onToast(e: Event): void {
  const detail = (e as CustomEvent).detail as { message: string; icon?: string; timeout?: number }
  const id = ++seq
  toasts.value = [...toasts.value, { id, message: detail.message, icon: detail.icon ?? '✓' }]
  setTimeout(() => dismiss(id), detail.timeout ?? 4200)
}

onMounted(() => window.addEventListener('ns:toast', onToast))
onBeforeUnmount(() => window.removeEventListener('ns:toast', onToast))
</script>

<template>
  <div class="ns-toast-wrap" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="ns-toast">
      <span class="ns-toast__icon">{{ t.icon }}</span>
      <span>{{ t.message }}</span>
      <button type="button" class="ns-toast__close" aria-label="Dismiss" @click="dismiss(t.id)">×</button>
    </div>
  </div>
</template>
