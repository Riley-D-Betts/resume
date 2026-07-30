<script setup lang="ts">
import { resume } from '~/data/resume'

const route = useRoute()
const p = resume.projects.find((x) => x.id === route.params.id)
if (!p) throw createError({ statusCode: 404, statusMessage: 'Project not found', fatal: true })

useHead({ title: `Project: ${p.name} | Bettsuite` })

const toast = useToast()

const detailGroup = {
  title: 'Primary Information',
  fields: [
    { label: 'Internal ID', value: p.code },
    { label: 'Name', value: p.name },
    { label: 'Category', value: p.category },
    { label: 'Status', value: p.status, tone: p.statusTone },
    { label: 'Featured', value: p.featured ? 'Yes' : 'No' },
    { label: 'Repository', value: p.links.length ? 'See Links subtab' : 'Private / internal' },
  ],
}

const actions = [
  { label: 'View All Projects', to: '/projects' },
  { label: 'Back to Home', to: '/' },
  ...(p.links[0] ? [{ label: `Open ${p.links[0].label}`, href: p.links[0].href }] : []),
]
</script>

<template>
  <div data-section="project">

    <NsRecordHeader type="Project" :name="p.name" :record-id="p.code" :status-label="p.status">
      <template #actions>
        <button type="button" class="ns-btn" @click="toast.show('Read-only — but the source is on GitHub if it has a repo.')">
          Edit
        </button>
        <NuxtLink to="/projects" class="ns-btn">Back</NuxtLink>
        <NsActionMenu :items="actions" />
        <a v-if="p.links[0]" :href="p.links[0].href" target="_blank" rel="noopener" class="ns-btn ns-btn--primary">
          {{ p.links[0].label }}
        </a>
      </template>
    </NsRecordHeader>

    <NsFieldGroup :group="detailGroup" />

    <div class="ns-secbar">Description</div>
    <div class="ns-fieldgroup">
      <div class="ns-prose">
        <p><NsLinkifyFobech :text="p.blurb" /></p>
      </div>
    </div>

    <NsSubtabs :tabs="['Specifications', 'Links']" v-slot="{ active }">
        <div v-show="active === 0" class="ns-subpanel">
          <div class="ns-tablescroll">
            <table class="ns-table">
              <thead>
                <tr>
                  <th class="ns-nosort">Specification</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="spec in p.specs" :key="spec">
                  <td>{{ spec }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-show="active === 1" class="ns-subpanel">
          <div v-if="p.links.length" class="ns-tablescroll">
            <table class="ns-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>URL</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(l, i) in p.links" :key="l.href">
                  <td class="ns-table__name">{{ l.label }}</td>
                  <td>
                    <a :href="l.href" target="_blank" rel="noopener">{{ l.href }}</a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="ns-subtitle">
            No public repository — this one was built for internal or family use.
          </p>
        </div>
    </NsSubtabs>

    <div class="ns-buttonbar ns-buttonbar--secondary">
      <NuxtLink to="/projects" class="ns-btn">Back</NuxtLink>
      <NuxtLink to="/employee" class="ns-btn">View Employee</NuxtLink>
    </div>
  </div>
</template>
