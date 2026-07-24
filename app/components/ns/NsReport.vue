<script setup lang="ts">
import type { ReportRow } from '~/data/resume'

defineProps<{ rows: ReportRow[] }>()

const shown = ref(false)
onMounted(() => requestAnimationFrame(() => (shown.value = true)))
</script>

<template>
  <div class="ns-report">
    <div v-for="r in rows" :key="r.label" class="ns-report__row">
      <div class="ns-report__top">
        <b>{{ r.label }}</b>
        <span class="ns-report__pct">{{ r.pct }}%</span>
      </div>
      <div class="ns-report__track">
        <div class="ns-report__fill" :style="{ width: (shown ? r.pct : 0) + '%' }" />
      </div>
      <div class="ns-report__note">{{ r.note }}</div>
    </div>
  </div>
</template>
