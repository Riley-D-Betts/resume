<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'Projects | NetSuite' })

const toast = useToast()

const allRows = resume.projects.map((p) => ({
  id: p.id,
  code: p.code,
  name: p.name,
  category: p.category,
  status: p.status,
  statusTone: p.statusTone,
  featured: p.featured ? 1 : 0,
  specs: p.specs.length,
}))

const columns = [
  { key: 'act', label: 'Edit | View', sortable: false },
  { key: 'code', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'specs', label: 'Specs', align: 'right' as const },
  { key: 'status', label: 'Status' },
]

const q = ref('')
const statusFilter = ref('- All -')
const statuses = ['- All -', ...Array.from(new Set(resume.projects.map((p) => p.status)))]

const rows = computed(() =>
  allRows.filter((r) => {
    const matchesQ = !q.value || `${r.name} ${r.category} ${r.code}`.toLowerCase().includes(q.value.toLowerCase())
    const matchesS = statusFilter.value === '- All -' || r.status === statusFilter.value
    return matchesQ && matchesS
  }),
)
</script>

<template>
  <div data-section="projects">
    <NsBreadcrumb :items="[{ label: 'Home', to: '/' }, { label: 'Lists' }, { label: 'Projects' }]" />

    <NsPageTitle
      title="Projects"
      subtitle="Side builds — hardware for the kids, software for the plant and beyond."
    />

    <div class="ns-buttonbar">
        <button
          type="button"
          class="ns-btn ns-btn--primary"
          @click="toast.show('New projects usually start at 11pm. This one is on the backlog.')"
        >
          New Project
        </button>
        <button type="button" class="ns-btn" @click="toast.show('View customization is disabled on this account.')">
          Customize View
        </button>
        <a href="https://github.com/Riley-D-Betts" target="_blank" rel="noopener" class="ns-btn">GitHub</a>
      <span class="ns-buttonbar__spacer" />
      <span class="ns-buttonbar__note">{{ allRows.length }} record(s)</span>
    </div>

    <div class="ns-listwrap">
      <div class="ns-listbar">
        <span class="ns-listbar__label">View</span>
        <select class="ns-select" aria-label="View">
          <option>Default</option>
          <option>Featured First</option>
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

      <NsTable :columns="columns" :rows="rows" initial-sort="code" initial-dir="asc">
        <template #default="{ rows: sorted }">
          <tr v-for="r in sorted" :key="String(r.id)">
            <td class="ns-table__actions">
              <button type="button" class="ns-linkish" @click="toast.show('Read-only access to this record.')">Edit</button>
              <span class="ns-table__sep">|</span>
              <NuxtLink :to="`/projects/${r.id}`">View</NuxtLink>
            </td>
            <td class="ns-mono">{{ r.code }}</td>
            <td class="ns-table__name">
              <NuxtLink :to="`/projects/${r.id}`">{{ r.name }}</NuxtLink>
              <span v-if="r.featured" title="Featured" style="color: var(--ns-amber)"> ★</span>
            </td>
            <td>{{ r.category }}</td>
            <td class="ns-num" style="text-align: right">{{ r.specs }}</td>
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
