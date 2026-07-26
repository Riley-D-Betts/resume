<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'Employment History | Bettsuite' })

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
const filtersOpen = ref(true)

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
    <!-- Bettsuite list pages carry no breadcrumb and no subtitle: just the
         record icon and the list name as the page heading. -->
    <div class="ns-pagetitle">
      <div class="ns-pagetitle__first">
        <h1 class="ns-record-type">Employment History</h1>
      </div>
    </div>

    <!-- Control bar order is Bettsuite's: View → select → Customize View →
         separator → the New button (which is never first). -->
    <div class="ns-controlbar">
      <span class="ns-listbar__label">View</span>
      <select class="ns-select" aria-label="View">
        <option>Default</option>
        <option>Most Recent First</option>
      </select>
      <button type="button" class="ns-btn" @click="toast.show('View customization is disabled on this account.')">
        Customize View
      </button>
      <span class="ns-controlbar__sep" aria-hidden="true" />
      <button
        type="button"
        class="ns-btn ns-btn--primary"
        @click="toast.show('New positions are filled by hiring managers. Know one? Send a message.')"
      >
        New Position
      </button>
    </div>

    <div class="ns-filters">
      <button type="button" class="ns-filters__head" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen">
        <span class="ns-filters__box" aria-hidden="true">{{ filtersOpen ? '−' : '+' }}</span>
        Filters
      </button>
      <div v-show="filtersOpen" class="ns-filters__body">
        <label class="ns-filter">
          <span class="ns-filter__label">Status</span>
          <select v-model="statusFilter" class="ns-select">
            <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label class="ns-filter">
          <span class="ns-filter__label">Quick Find</span>
          <input v-model="q" class="ns-input" type="search" style="width: 200px" />
        </label>
      </div>
    </div>

    <div class="ns-listwrap">
      <div class="ns-listbar">
        <span class="ns-listbar__label">Style</span>
        <select class="ns-select" aria-label="Style">
          <option>Normal</option>
          <option>Report</option>
          <option>Grid</option>
        </select>
        <span class="ns-listbar__label">Quick Sort</span>
        <select class="ns-select" aria-label="Quick Sort">
          <option>Period</option>
          <option>Company</option>
          <option>Status</option>
        </select>
        <span class="ns-listbar__spacer" />
        <span class="ns-listbar__label">{{ allRows.length }} record(s)</span>
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
              <div style="color: var(--ns-muted); font-size: 11px">{{ r.subtitle }}</div>
            </td>
            <td>
              {{ r.title }}
              <span v-if="Number(r.titles) > 1" style="color: var(--ns-muted)">
                (+{{ Number(r.titles) - 1 }} prior)
              </span>
            </td>
            <td>{{ r.location }}</td>
            <td>{{ r.period }}</td>
            <td>{{ r.status }}</td>
          </tr>
        </template>
      </NsTable>

      <div class="ns-listfoot">
        <span class="ns-pager">
          <button disabled title="Previous">◄</button>
          <select class="ns-select" aria-label="Page range">
            <option>1 - {{ rows.length }} of {{ rows.length }}</option>
          </select>
          <button disabled title="Next">►</button>
        </span>
        <span class="ns-listfoot__spacer" />
        <button type="button" class="ns-linkish" @click="toast.show('Export queued — or just read the page.')">
          Export - CSV
        </button>
      </div>
    </div>
  </div>
</template>
