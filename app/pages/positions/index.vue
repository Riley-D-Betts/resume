<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'Employment History | NetSuite' })

const toast = useToast()

const allRows = resume.positions.map((p) => ({
  id: p.id,
  company: p.company,
  subtitle: p.subtitle ?? '',
  title: p.titles[p.titles.length - 1]!.title,
  titles: p.titles.length,
  location: p.location,
  period: p.periodLabel,
  periodSort: p.start,
  status: p.status,
  statusTone: p.statusTone,
}))

const columns = [
  { key: 'act', label: 'Edit | View', sortable: false },
  { key: 'company', label: 'Company' },
  { key: 'title', label: 'Title' },
  { key: 'location', label: 'Location' },
  { key: 'periodSort', label: 'Period' },
  { key: 'status', label: 'Status' },
]

const q = ref('')
const statusFilter = ref('- All -')
const statuses = ['- All -', ...Array.from(new Set(resume.positions.map((p) => p.status)))]

const rows = computed(() =>
  allRows.filter((r) => {
    const matchesQ =
      !q.value || `${r.company} ${r.title} ${r.location} ${r.subtitle}`.toLowerCase().includes(q.value.toLowerCase())
    const matchesS = statusFilter.value === '- All -' || r.status === statusFilter.value
    return matchesQ && matchesS
  }),
)
</script>

<template>
  <div data-section="positions">
    <NsBreadcrumb :items="[{ label: 'Home', to: '/' }, { label: 'Activities' }, { label: 'Employment History' }]" />

    <NsPageTitle
      title="Employment History"
      subtitle="Every role Riley has held, in order — the phones to the ERP core."
    />

    <div class="ns-buttonbar">
        <button
          type="button"
          class="ns-btn ns-btn--primary"
          @click="toast.show('New positions are filled by hiring managers. Know one? Send a message.')"
        >
          New Position
        </button>
        <button type="button" class="ns-btn" @click="toast.show('View customization is disabled on this account.')">
          Customize View
        </button>
        <button type="button" class="ns-btn" @click="toast.show('Export queued — check your downloads. Or just read the page.')">
          Export - CSV
        </button>
      <span class="ns-buttonbar__spacer" />
      <span class="ns-buttonbar__note">{{ allRows.length }} record(s)</span>
    </div>

    <div class="ns-listwrap">
      <div class="ns-listbar">
        <span class="ns-listbar__label">View</span>
        <select class="ns-select" aria-label="View">
          <option>Default</option>
          <option>Most Recent First</option>
        </select>
        <span class="ns-listbar__label">Style</span>
        <select class="ns-select" aria-label="Style">
          <option>Normal</option>
          <option>Report</option>
          <option>Grid</option>
        </select>
        <span class="ns-listbar__label">Status</span>
        <select v-model="statusFilter" class="ns-select" aria-label="Status filter">
          <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
        </select>
        <span class="ns-listbar__spacer" />
        <span class="ns-listbar__label">Quick Find</span>
        <input v-model="q" class="ns-input" type="search" placeholder="" style="width: 170px" aria-label="Quick find" />
      </div>

      <NsTable :columns="columns" :rows="rows" initial-sort="periodSort" initial-dir="desc">
        <template #default="{ rows: sorted }">
          <tr v-for="r in sorted" :key="String(r.id)">
            <td class="ns-table__actions">
              <button type="button" class="ns-linkish" @click="toast.show('Read-only access to this record.')">Edit</button>
              <span class="ns-table__sep">|</span>
              <NuxtLink :to="`/positions/${r.id}`">View</NuxtLink>
            </td>
            <td class="ns-table__name">
              <NuxtLink :to="`/positions/${r.id}`">{{ r.company }}</NuxtLink>
              <div style="color: var(--ns-muted); font-size: 10.5px">{{ r.subtitle }}</div>
            </td>
            <td>
              {{ r.title }}
              <span v-if="Number(r.titles) > 1" style="color: var(--ns-muted)">
                (+{{ Number(r.titles) - 1 }} prior)
              </span>
            </td>
            <td>{{ r.location }}</td>
            <td class="ns-mono">{{ r.period }}</td>
            <td><NsStatusPill :tone="r.statusTone as any" :label="String(r.status)" /></td>
          </tr>
        </template>
      </NsTable>

      <div class="ns-listfoot">
        <span>1 - {{ rows.length }} of {{ rows.length }}</span>
        <span class="ns-listfoot__spacer" />
        <span class="ns-pager">
          <button disabled title="Previous">◄</button>
          <button disabled>1</button>
          <button disabled title="Next">►</button>
        </span>
      </div>
    </div>
  </div>
</template>
