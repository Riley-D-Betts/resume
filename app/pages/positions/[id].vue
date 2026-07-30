<script setup lang="ts">
import { resume } from '~/data/resume'

const route = useRoute()
const p = resume.positions.find((x) => x.id === route.params.id)
if (!p) throw createError({ statusCode: 404, statusMessage: 'Position not found', fatal: true })

useHead({ title: `Position: ${p.company} | Bettsuite` })

const toast = useToast()

// a stable internal id for the title line, the way Bettsuite shows one
const internalId = String(resume.positions.findIndex((x) => x.id === p.id) + 201)

const detailGroup = {
  title: 'Primary Information',
  fields: [
    { label: 'Company', value: p.company },
    ...(p.subtitle ? [{ label: 'Also Known As', value: p.subtitle }] : []),
    { label: 'Location', value: p.location },
    { label: 'Period', value: p.periodLabel },
    { label: 'Current Title', value: p.titles[p.titles.length - 1]!.title },
    { label: 'Titles Held', value: String(p.titles.length) },
    { label: 'Status', value: p.status },
  ],
}

const actions = [
  { label: 'View Employee', to: '/employee' },
  { label: 'Back to List', to: '/positions' },
  { label: 'Request Reference', toast: 'Reference check queued. Spoiler: it goes well.' },
]
</script>

<template>
  <div data-section="position">

    <NsRecordHeader type="Position" :name="p.company" :record-id="internalId" :status-label="p.status">
      <template #actions>
        <button type="button" class="ns-btn" @click="toast.show('Read-only — this position is a matter of record.')">
          Edit
        </button>
        <NuxtLink to="/positions" class="ns-btn">Back</NuxtLink>
        <NsActionMenu :items="actions" />
      </template>
    </NsRecordHeader>

    <NsFieldGroup :group="detailGroup" />

    <div class="ns-secbar">Summary</div>
    <div class="ns-fieldgroup">
      <div class="ns-prose">
        <p><NsLinkifyFobech :text="p.summary" /></p>
      </div>
    </div>

    <NsSubtabs :tabs="['Milestones', 'Title History', 'Classification']" v-slot="{ active }">
        <div v-show="active === 0" class="ns-subpanel">
          <ul class="ns-milestones">
            <li v-for="(m, i) in p.milestones" :key="i" class="ns-milestone">
              <span class="ns-milestone__stamp">{{ m.type }}</span>
              <span class="ns-milestone__note"><NsLinkifyFobech :text="m.note" /></span>
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
                <tr v-for="(t, i) in p.titles" :key="t.title">
                  <td class="ns-table__name">{{ t.title }}</td>
                  <td>{{ t.period }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-show="active === 2" class="ns-subpanel">
          <p>{{ p.tags.join(', ') }}</p>
        </div>
    </NsSubtabs>

    <div class="ns-buttonbar ns-buttonbar--secondary">
      <NuxtLink to="/positions" class="ns-btn">Back</NuxtLink>
      <NuxtLink to="/employee" class="ns-btn">View Employee</NuxtLink>
    </div>
  </div>
</template>
