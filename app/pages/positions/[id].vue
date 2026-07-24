<script setup lang="ts">
import { resume } from '~/data/resume'
import type { Tone } from '~/data/resume'

const route = useRoute()
const p = resume.positions.find((x) => x.id === route.params.id)
if (!p) throw createError({ statusCode: 404, statusMessage: 'Position not found', fatal: true })

useHead({ title: `${p.company} — Position | NetSuite` })

const toast = useToast()

const detailGroup = {
  title: 'Position Details',
  fields: [
    { label: 'Company', value: p.company },
    { label: 'Location', value: p.location },
    { label: 'Period', value: p.periodLabel, mono: true },
    { label: 'Current Title', value: p.titles[p.titles.length - 1]!.title },
    { label: 'Titles Held', value: String(p.titles.length) },
    { label: 'Status', value: p.status, tone: p.statusTone },
  ],
}

function milestoneTone(t: string): Tone {
  return t === 'Promoted' ? 'green' : t === 'Hired' ? 'blue' : 'gray'
}

const actions = [
  { label: 'Edit', toast: 'Read-only — this position is a matter of record.' },
  { label: 'View Employee', to: '/employee' },
  { label: 'Back to List', to: '/positions' },
]
</script>

<template>
  <div data-section="position">
    <NsBreadcrumb
      :items="[{ label: 'Home', to: '/' }, { label: 'Employment History', to: '/positions' }, { label: p.company }]"
    />

    <div class="ns-record">
      <NsRecordHeader
        type="Position"
        :name="p.company"
        :subtitle="p.subtitle"
        glyph="💼"
        :status-tone="p.statusTone"
        :status-label="p.status"
      >
        <template #actions>
          <NsActionMenu :items="actions" />
        </template>
      </NsRecordHeader>

      <NsFieldGroup :group="detailGroup" />

      <div class="ns-fieldgroup">
        <div class="ns-fieldgroup__title">Summary</div>
        <div class="ns-prose" style="max-width: 74ch; padding-bottom: 6px">
          <p>{{ p.summary }}</p>
        </div>
      </div>

      <NsSubtabs :tabs="['Milestones', 'Title History', 'Tags']" v-slot="{ active }">
        <div v-show="active === 0" class="ns-subpanel">
          <ul class="ns-milestones">
            <li v-for="(m, i) in p.milestones" :key="i" class="ns-milestone">
              <span class="ns-milestone__stamp">
                <NsStatusPill :tone="milestoneTone(m.type)" :label="m.type" />
              </span>
              <span class="ns-milestone__note">{{ m.note }}</span>
            </li>
          </ul>
        </div>

        <div v-show="active === 1" class="ns-subpanel">
          <div class="ns-tablescroll">
            <table class="ns-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Phase</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in p.titles" :key="t.title">
                  <td class="ns-table__name">{{ t.title }}</td>
                  <td class="ns-mono">{{ t.period }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-show="active === 2" class="ns-subpanel">
          <div class="ns-tags">
            <span v-for="tag in p.tags" :key="tag" class="ns-tag">{{ tag }}</span>
          </div>
        </div>
      </NsSubtabs>
    </div>

    <div style="margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap">
      <NuxtLink to="/positions" class="ns-btn">← Back to Employment History</NuxtLink>
      <button type="button" class="ns-btn" @click="toast.show('Reference check queued. Spoiler: it goes well.', { icon: '☎' })">
        Request Reference
      </button>
    </div>
  </div>
</template>
