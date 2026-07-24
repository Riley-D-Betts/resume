<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'Employee: Betts, Riley | NetSuite' })

const emp = resume.employee
const toast = useToast()

const actions = [
  { label: 'Send Email', href: 'mailto:rbetts@idamilk.com' },
  { label: 'Open Subsidiary: Fobech', to: '/fobech' },
  { label: 'View Employment History', to: '/positions' },
  { label: 'Make Copy', toast: 'There is only one of him.' },
]

// a faux change history, built from the real career facts
const systemNotes = [
  { date: '11/18/2024', field: 'Employee', change: 'created → Active', by: 'System' },
  { date: '11/18/2024', field: 'Job Title', change: '— → IT Supervisor', by: 'Human Resources' },
  { date: '2025', field: 'Job Title', change: 'IT Supervisor → Information Technology Manager', by: 'Executive Team' },
  { date: '2025', field: 'Role', change: 'User → Administrator', by: 'System' },
  { date: '2026', field: 'Subsidiary', change: 'added → Fobech (Founder)', by: resume.identity.name },
]

function proficiencyTone(p: string) {
  return p === 'Expert' ? 'green' : p === 'Advanced' ? 'blue' : 'gray'
}

const readOnly = () => toast.show('This record is read-only — you have look-but-don’t-touch Administrator access.')
</script>

<template>
  <div data-section="employee">
    <NsBreadcrumb
      :items="[{ label: 'Home', to: '/' }, { label: 'Lists' }, { label: 'Employees', to: '/employee' }, { label: 'Betts, Riley' }]"
    />

    <NsRecordHeader type="Employee" name="Betts, Riley" record-id="1042" glyph="👤" :status-label="emp.status">
      <template #actions>
        <button type="button" class="ns-btn" @click="readOnly">Edit</button>
        <NuxtLink to="/" class="ns-btn">Back</NuxtLink>
        <button type="button" class="ns-btn ns-btn--icon" title="Print" aria-label="Print" @click="toast.show('Sent to the printer down the hall. It is out of toner.')">
          ⎙
        </button>
        <NsActionMenu :items="actions" />
        <NuxtLink to="/contact" class="ns-btn ns-btn--primary">New Message</NuxtLink>
      </template>
    </NsRecordHeader>

    <NsFieldGroup :group="emp.groups[0]!" />
    <NsFieldGroup :group="emp.groups[1]!" />

    <NsSubtabs
      :tabs="['Human Resources', 'Access', 'Communication', 'Related Records', 'System Information']"
      v-slot="{ active }"
    >
      <!-- Human Resources: the skills sublist -->
      <div v-show="active === 0" class="ns-subpanel">
        <div class="ns-tablescroll">
          <table class="ns-table">
            <thead>
              <tr>
                <th>Discipline</th>
                <th>Proficiency</th>
                <th>Experience</th>
                <th class="ns-nosort">Skills</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in emp.skills" :key="s.category">
                <td class="ns-table__name">{{ s.category }}</td>
                <td><NsStatusPill :tone="proficiencyTone(s.proficiency) as any" :label="s.proficiency" /></td>
                <td class="ns-mono">{{ s.years }}</td>
                <td>
                  <div class="ns-tags">
                    <span v-for="k in s.skills" :key="k" class="ns-tag">{{ k }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Access -->
      <div v-show="active === 1" class="ns-subpanel" style="padding: 0">
        <NsFieldGroup :group="emp.groups[2]!" />
      </div>

      <!-- Communication -->
      <div v-show="active === 2" class="ns-subpanel">
        <div class="ns-prose" style="max-width: 74ch">
          <p v-for="(para, i) in emp.bio" :key="i">{{ para }}</p>
        </div>
      </div>

      <!-- Related Records -->
      <div v-show="active === 3" class="ns-subpanel">
        <div class="ns-tablescroll">
          <table class="ns-table">
            <thead>
              <tr>
                <th class="ns-nosort">Action</th>
                <th>Type</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="ns-table__actions"><NuxtLink to="/fobech">View</NuxtLink></td>
                <td>Subsidiary</td>
                <td class="ns-table__name"><NuxtLink to="/fobech">Fobech</NuxtLink></td>
              </tr>
              <tr v-for="(p, i) in resume.positions" :key="p.id">
                <td class="ns-table__actions"><NuxtLink :to="`/positions/${p.id}`">View</NuxtLink></td>
                <td>Position</td>
                <td class="ns-table__name">
                  <NuxtLink :to="`/positions/${p.id}`">{{ p.company }}</NuxtLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- System Information -->
      <div v-show="active === 4" class="ns-subpanel">
        <div class="ns-tablescroll">
          <table class="ns-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Field</th>
                <th>Old Value → New Value</th>
                <th>Set By</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(n, i) in systemNotes" :key="i">
                <td class="ns-mono">{{ n.date }}</td>
                <td class="ns-table__name">{{ n.field }}</td>
                <td class="ns-mono">{{ n.change }}</td>
                <td>{{ n.by }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </NsSubtabs>

    <div class="ns-buttonbar ns-buttonbar--secondary">
      <button type="button" class="ns-btn" @click="readOnly">Edit</button>
      <NuxtLink to="/" class="ns-btn">Back</NuxtLink>
      <NuxtLink to="/positions" class="ns-btn">Employment History</NuxtLink>
      <NuxtLink to="/projects" class="ns-btn">Projects</NuxtLink>
    </div>
  </div>
</template>
