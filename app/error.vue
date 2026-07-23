<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const is404 = computed(() => props.error.statusCode === 404)
</script>

<template>
  <main class="fault">
    <div class="fault__panel">
      <p class="fault__code display">{{ error.statusCode }}</p>
      <p class="fault__title">
        <span class="fault__lamp" aria-hidden="true" />
        {{ is404 ? 'SIGNAL LOST — NO SUCH SEGMENT' : 'FAULT DETECTED — LINE STOPPED' }}
      </p>
      <p class="fault__hint label">
        {{ is404 ? 'THE ROUTE YOU POLLED DOES NOT REPORT.' : 'AN OPERATOR HAS BEEN NOTIFIED. PROBABLY.' }}
      </p>
      <button class="fault__btn" @click="clearError({ redirect: '/' })">[ RETURN TO CONSOLE ]</button>
    </div>
  </main>
</template>

<style scoped>
.fault {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--bg-0);
  font-family: var(--font-mono);
}

.fault__panel {
  text-align: center;
  padding: var(--space-4);
}

.fault__code {
  font-size: clamp(4rem, 18vw, 10rem);
  color: var(--red);
  opacity: 0.9;
}

.fault__title {
  margin-top: var(--space-2);
  color: var(--text);
  letter-spacing: 0.1em;
  font-size: var(--fs-body);
}

.fault__lamp {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--red);
  box-shadow: 0 0 8px 2px rgba(255, 69, 69, 0.5);
  animation: lamp-pulse 1.2s ease-in-out infinite;
  margin-right: 6px;
}

@keyframes lamp-pulse {
  50% {
    opacity: 0.4;
  }
}

.fault__hint {
  margin-top: var(--space-2);
}

.fault__btn {
  margin-top: var(--space-4);
  border: 1px solid var(--hairline-lit);
  color: var(--text);
  padding: var(--space-2) var(--space-3);
  letter-spacing: 0.08em;
  transition: border-color 0.2s, color 0.2s;
}

.fault__btn:hover {
  border-color: var(--teal-hot);
  color: var(--teal-hot);
}

@media (prefers-reduced-motion: reduce) {
  .fault__lamp {
    animation: none;
  }
}
</style>
