<script setup lang="ts">
import type { Kpi } from '~/data/resume'

defineProps<{ kpis: Kpi[] }>()
const NsLink = resolveComponent('NuxtLink')

function deltaClass(k: Kpi): string {
  if (k.direction === 'flat') return 'ns-flat'
  const good = k.direction === 'up' || k.goodWhenDown
  return good ? 'ns-up' : 'ns-down'
}
function arrow(k: Kpi): string {
  return k.direction === 'up' ? '▲' : k.direction === 'down' ? '▼' : '▬'
}
</script>

<template>
  <table class="ns-kpi">
    <thead>
      <tr>
        <th>Key Performance Indicator</th>
        <th class="ns-num">Value</th>
        <th class="ns-num">Δ</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="k in kpis" :key="k.label">
        <td class="ns-kpi__label">
          <component :is="k.to ? NsLink : 'span'" v-bind="k.to ? { to: k.to } : {}">
            <b>{{ k.label }}</b>
          </component>
          <span>{{ k.period }} · {{ k.compare }}</span>
        </td>
        <td class="ns-num ns-kpi__value">{{ k.value }}</td>
        <td class="ns-num ns-kpi__delta" :class="deltaClass(k)">{{ arrow(k) }} {{ k.delta }}</td>
      </tr>
    </tbody>
  </table>
</template>
