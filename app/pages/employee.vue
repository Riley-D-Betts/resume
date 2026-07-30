<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'Employee: Betts, Riley | Bettsuite' })

const emp = resume.employee
const toast = useToast()

const actions = [
  { label: 'Send Email', href: `mailto:${resume.identity.email}` },
  { label: 'Open Subsidiary: Fobech', to: '/fobech' },
  { label: 'View Employment History', to: '/positions' },
  { label: 'Make Copy', toast: 'There is only one of him.' },
]

// a faux change history, built from the real career facts — every
// actor is the system or Riley himself, never an invented colleague
const systemNotes = [
  { date: '11/18/2024', field: 'Employee', change: 'created → Active', by: 'System' },
  { date: '11/18/2024', field: 'Job Title', change: '— → Systems Analyst', by: 'System' },
  { date: 'Nov 2025', field: 'Job Title', change: 'Systems Analyst → IT Supervisor', by: 'System' },
  { date: '2026', field: 'Job Title', change: 'IT Supervisor → Information Technology Manager', by: 'System' },
  { date: '2026', field: 'Role', change: 'User → Administrator', by: 'System' },
  { date: '2026', field: 'Subsidiary', change: 'added → Fobech (Founder)', by: resume.identity.name },
]

const readOnly = () => toast.show('This record is read-only — you have look-but-don’t-touch Administrator access.')
</script>

<template>
  <div data-section="employee">

    <NsRecordHeader type="Employee" name="Betts, Riley" record-id="1042" :status-label="emp.status">
      <template #actions>
        <button type="button" class="ns-btn" @click="readOnly">Edit</button>
        <NuxtLink to="/" class="ns-btn">Back</NuxtLink>
        <button
          type="button"
          class="ns-btn ns-btn--icon"
          title="Print"
          aria-label="Print"
          @click="toast.show('Sent to the printer down the hall. It is out of toner.')"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4.5 6V2.2h7V6" fill="none" stroke="currentColor" stroke-width="1.3" />
            <rect x="2" y="6" width="12" height="5.2" fill="none" stroke="currentColor" stroke-width="1.3" />
            <path d="M4.5 9.6h7v4.2h-7z" fill="#fff" stroke="currentColor" stroke-width="1.3" />
          </svg>
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
                <td>{{ s.proficiency }}</td>
                <td>{{ s.years }}</td>
                <td>{{ s.skills.join(', ') }}</td>
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
        <div class="ns-prose">
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
                <td>{{ n.date }}</td>
                <td class="ns-table__name">{{ n.field }}</td>
                <td>{{ n.change }}</td>
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
      <NsActionMenu :items="actions" />
      <NuxtLink to="/contact" class="ns-btn ns-btn--primary">New Message</NuxtLink>
    </div>
  </div>
</template>
