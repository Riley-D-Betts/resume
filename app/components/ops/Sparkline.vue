<script setup lang="ts">
const props = defineProps<{ data: { day: string; n: number }[] }>()

const W = 300
const H = 56
const PAD = 3

const maxN = computed(() =>
  props.data.length ? Math.max(...props.data.map(d => d.n)) : 0,
)
const minN = computed(() =>
  props.data.length ? Math.min(...props.data.map(d => d.n)) : 0,
)

const pts = computed<[number, number][]>(() => {
  const scale = Math.max(1, maxN.value)
  return props.data.map((d, i) => {
    const x =
      props.data.length > 1 ? PAD + (i * (W - PAD * 2)) / (props.data.length - 1) : W / 2
    const y = H - PAD - (d.n / scale) * (H - PAD * 2)
    return [Number(x.toFixed(1)), Number(y.toFixed(1))]
  })
})

const line = computed(() => pts.value.map(p => `${p[0]},${p[1]}`).join(' '))

const area = computed(() => {
  if (pts.value.length < 2) return ''
  const first = pts.value[0]!
  const last = pts.value[pts.value.length - 1]!
  const body = pts.value.map(p => `L ${p[0]} ${p[1]}`).join(' ')
  return `M ${first[0]} ${H - PAD} ${body} L ${last[0]} ${H - PAD} Z`
})
</script>

<template>
  <div class="spark" data-testid="sparkline">
    <svg class="spark__svg" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" aria-label="Sessions per day, last 30 days">
      <path v-if="area" :d="area" class="spark__area" />
      <polyline v-if="pts.length > 1" :points="line" class="spark__line" />
    </svg>
    <div class="spark__labels label">
      <span>MIN {{ minN }}</span>
      <span class="spark__max">MAX {{ maxN }}</span>
    </div>
  </div>
</template>

<style scoped>
.spark {
  min-width: 0;
}

.spark__svg {
  display: block;
  width: 100%;
  height: 56px;
}

.spark__area {
  fill: rgba(0, 180, 200, 0.12);
  stroke: none;
}

.spark__line {
  fill: none;
  stroke: var(--teal-hot);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
}

.spark__labels {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-1);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.spark__max {
  color: var(--text-dim);
}
</style>
