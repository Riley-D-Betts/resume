<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'Employment History | NetSuite' })

const toast = useToast()

const allRows = resume.positions.map((p) => ({
  id: p.id,
  company: p.company,
  subtitle: p.subtitle ?? '',
  title: p.titles[0]!.title,
  titles: p.titles.length,
  location: p.location,
  period: p.periodLabel,
  periodSort: p.start,
  status: p.status,
  statusTone: p.statusTone,
}))

const columns = [
  { key: 'view', label: 'Action', sortable: false },
  { key: 'company', label: 'Company' },
  { key: 'title', label: 'Title' },
  { key: 'location', label: 'Location' },
  { key: 'periodSort', label: 'Period' },
  { key: 'status', label: 'Status' },
]

const q = ref('')
const statusFilter = ref('All')
const statuses = ['All', ...Array.from(new Set(resume.positions.map((p) => p.status)))]

const rows = computed(() =>
  allRows.filter((r) => {
    const matchesQ =
      !q.value || `${r.company} ${r.title} ${r.location} ${r.subtitle}`.toLowerCase().includes(q.value.toLowerCase())
    const matchesS = statusFilter.value === 'All' || r.status === statusFilter.value
    return matchesQ && matchesS
  }),
)
</script>

<template>
  <div data-section="positions">
    <NsBreadcrumb :items="[{ label: 'Home', to: '/' }, { label: 'Employment History' }]" />

    <NsPageTitle title="Employment History" meta="List" subtitle="Every role Riley has held, in order — server room to ERP.">
      <template #actions>
        <button
          type="button"
          class="ns-btn ns-btn--primary"
          @click="toast.show('New positions are filled by hiring managers. Know one? Send a message.', { icon: '＋' })"
        >
          ＋ New Position
        </button>
      </template>
    </NsPageTitle>

    <div class="ns-listwrap">
      <div class="ns-listbar">
        <span class="ns-listbar__label">FILTER</span>
        <input v-model="q" class="ns-input" type="search" placeholder="Search positions…" style="width: 220px" />
        <select v-model="statusFilter" class="ns-select" aria-label="Status filter">
          <option v-for="s in statuses" :key="s" :value="s">{{ s === 'All' ? 'Status: All' : s }}</option>
        </select>
        <span class="ns-listbar__spacer" />
        <span class="ns-listbar__label">VIEW</span>
        <select class="ns-select" aria-label="View">
          <option>Default</option>
          <option>Most Recent First</option>
        </select>
      </div>

      <NsTable :columns="columns" :rows="rows" initial-sort="periodSort" initial-dir="desc">
        <template #default="{ rows: sorted }">
          <tr v-for="r in sorted" :key="String(r.id)">
            <td class="ns-table__actions">
              <NuxtLink :to="`/positions/${r.id}`">View</NuxtLink>
              <span class="ns-table__sep">|</span>
              <button type="button" class="ns-linkish" @click="toast.show('Read-only access to this record.')">Edit</button>
            </td>
            <td class="ns-table__name">
              <NuxtLink :to="`/positions/${r.id}`">{{ r.company }}</NuxtLink>
              <div style="color: var(--ns-muted); font-size: 11px">{{ r.subtitle }}</div>
            </td>
            <td>
              {{ r.title }}
              <span v-if="Number(r.titles) > 1" style="color: var(--ns-muted)"> +{{ Number(r.titles) - 1 }} more</span>
            </td>
            <td>{{ r.location }}</td>
            <td class="ns-mono">{{ r.period }}</td>
            <td><NsStatusPill :tone="r.statusTone as any" :label="String(r.status)" /></td>
          </tr>
        </template>
      </NsTable>

      <div class="ns-listfoot">
        <span>{{ rows.length }} of {{ allRows.length }} record{{ allRows.length === 1 ? '' : 's' }}</span>
        <span class="ns-listfoot__spacer" />
        <span class="ns-pager">
          <button disabled>‹ Prev</button>
          <button disabled>1</button>
          <button disabled>Next ›</button>
        </span>
      </div>
    </div>
  </div>
</template>
