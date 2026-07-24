<script setup lang="ts">
import { resume } from '~/data/resume'

const route = useRoute()
const p = resume.projects.find((x) => x.id === route.params.id)
if (!p) throw createError({ statusCode: 404, statusMessage: 'Project not found', fatal: true })

useHead({ title: `${p.name} — Project | NetSuite` })

const detailGroup = {
  title: 'Project Details',
  fields: [
    { label: 'Internal ID', value: p.code, mono: true },
    { label: 'Name', value: p.name },
    { label: 'Category', value: p.category },
    { label: 'Status', value: p.status, tone: p.statusTone },
    { label: 'Featured', value: p.featured ? 'Yes' : 'No' },
    { label: 'Repository', value: p.links.length ? 'See Links subtab' : 'Private / internal' },
  ],
}

const actions = [
  { label: 'Edit', toast: 'Read-only — but the source is on GitHub if it has a repo.' },
  { label: 'View All Projects', to: '/projects' },
  { label: 'Back to Home', to: '/' },
]
</script>

<template>
  <div data-section="project">
    <NsBreadcrumb
      :items="[{ label: 'Home', to: '/' }, { label: 'Projects', to: '/projects' }, { label: p.name }]"
    />

    <div class="ns-record">
      <NsRecordHeader
        type="Project"
        :name="p.name"
        :subtitle="p.category"
        glyph="📦"
        :status-tone="p.statusTone"
        :status-label="p.status"
      >
        <template #actions>
          <a v-if="p.links[0]" :href="p.links[0].href" target="_blank" rel="noopener" class="ns-btn ns-btn--primary">
            ↗ {{ p.links[0].label }}
          </a>
          <NsActionMenu :items="actions" />
        </template>
      </NsRecordHeader>

      <NsFieldGroup :group="detailGroup" />

      <div class="ns-fieldgroup">
        <div class="ns-fieldgroup__title">Description</div>
        <div class="ns-prose" style="max-width: 74ch; padding-bottom: 6px">
          <p>{{ p.blurb }}</p>
        </div>
      </div>

      <NsSubtabs :tabs="['Specifications', 'Links']" v-slot="{ active }">
        <div v-show="active === 0" class="ns-subpanel">
          <div class="ns-tags">
            <span v-for="s in p.specs" :key="s" class="ns-tag">{{ s }}</span>
          </div>
        </div>

        <div v-show="active === 1" class="ns-subpanel">
          <div v-if="p.links.length" style="display: flex; gap: 8px; flex-wrap: wrap">
            <a v-for="l in p.links" :key="l.href" :href="l.href" target="_blank" rel="noopener" class="ns-btn">
              ↗ {{ l.label }}
            </a>
          </div>
          <p v-else class="ns-subtitle">No public repository — this one was built for internal or family use.</p>
        </div>
      </NsSubtabs>
    </div>

    <div style="margin-top: 14px">
      <NuxtLink to="/projects" class="ns-btn">← Back to Projects</NuxtLink>
    </div>
  </div>
</template>
