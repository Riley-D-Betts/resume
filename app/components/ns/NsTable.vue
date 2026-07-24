<script setup lang="ts">
interface Column {
  key: string
  label: string
  sortable?: boolean
  align?: 'left' | 'right' | 'center'
}

const props = withDefaults(
  defineProps<{
    columns: Column[]
    rows: Record<string, unknown>[]
    initialSort?: string
    initialDir?: 'asc' | 'desc'
  }>(),
  { initialDir: 'asc' },
)

const sortKey = ref(props.initialSort ?? '')
const sortDir = ref<'asc' | 'desc'>(props.initialDir)

function toggleSort(c: Column): void {
  if (c.sortable === false) return
  if (sortKey.value === c.key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = c.key
    sortDir.value = 'asc'
  }
}

const sortedRows = computed(() => {
  if (!sortKey.value) return props.rows
  const k = sortKey.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...props.rows].sort((a, b) => {
    const av = a[k]
    const bv = b[k]
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    return String(av).localeCompare(String(bv)) * dir
  })
})
</script>

<template>
  <div class="ns-tablescroll">
    <table class="ns-table">
      <thead>
        <tr>
          <th
            v-for="c in columns"
            :key="c.key"
            :class="{ 'ns-nosort': c.sortable === false, 'ns-num': c.align === 'right' }"
            :style="c.align === 'center' ? 'text-align:center' : ''"
            @click="toggleSort(c)"
          >
            {{ c.label }}
            <span v-if="sortKey === c.key" class="ns-table__sort" aria-hidden="true">{{
              sortDir === 'asc' ? '▲' : '▼'
            }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <slot :rows="sortedRows" />
      </tbody>
    </table>
  </div>
</template>
