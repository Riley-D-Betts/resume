<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'Employee: Riley Betts | NetSuite' })

const emp = resume.employee
const toast = useToast()

const actions = [
  { label: 'Edit', toast: 'This record is read-only — you have Administrator (look-but-don’t-touch) access.' },
  { label: 'Send Email', href: 'mailto:rbetts@idamilk.com' },
  { label: 'Open Fobech Subsidiary', to: '/fobech' },
  { label: 'Back to Home', to: '/' },
]

// a faux audit trail, built from the real career facts
const systemNotes = [
  { date: '11/18/2024', field: 'Employee', change: 'created → Active', by: 'System' },
  { date: '11/18/2024', field: 'Job Title', change: '— → IT Supervisor', by: 'HR' },
  { date: '2025', field: 'Job Title', change: 'IT Supervisor → IT Manager', by: 'Executive Team' },
  { date: '2025', field: 'Access · ERP', change: 'User → Administrator', by: 'System' },
  { date: '2026', field: 'Subsidiary', change: 'added → Fobech (Founder)', by: resume.identity.name },
]
</script>

<template>
  <div data-section="employee">
    <NsBreadcrumb :items="[{ label: 'Home', to: '/' }, { label: 'Employees', to: '/employee' }, { label: emp.groups[0]!.fields[0]!.value }]" />

    <div class="ns-record">
      <NsRecordHeader
        type="Employee"
        :name="resume.identity.name"
        :subtitle="emp.title"
        glyph="👤"
        :status-tone="emp.statusTone"
        :status-label="emp.status"
      >
        <template #actions>
          <NuxtLink to="/contact" class="ns-btn ns-btn--primary">✉ Message</NuxtLink>
          <NsActionMenu :items="actions" />
        </template>
      </NsRecordHeader>

      <NsFieldGroup :group="emp.groups[0]!" />
      <NsFieldGroup :group="emp.groups[1]!" />

      <NsSubtabs :tabs="['Human Resources', 'Access & Roles', 'Bio', 'System Notes']" v-slot="{ active }">
        <!-- Human Resources: skills sublist -->
        <div v-show="active === 0" class="ns-subpanel">
          <p class="ns-subtitle" style="margin-bottom: 10px">
            Skills &amp; proficiency — {{ emp.skills.length }} disciplines on file.
          </p>
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
                <tr v-for="s in emp.skills" :key="s.category">
                  <td class="ns-table__name">{{ s.category }}</td>
                  <td>
                    <NsStatusPill
                      :tone="s.proficiency === 'Expert' ? 'green' : s.proficiency === 'Advanced' ? 'blue' : 'gray'"
                      :label="s.proficiency"
                    />
                  </td>
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

        <!-- Access & Roles -->
        <div v-show="active === 1" class="ns-subpanel" style="padding: 0">
          <NsFieldGroup :group="emp.groups[2]!" />
        </div>

        <!-- Bio -->
        <div v-show="active === 2" class="ns-subpanel">
          <div class="ns-prose" style="max-width: 68ch">
            <p v-for="(para, i) in emp.bio" :key="i">{{ para }}</p>
          </div>
        </div>

        <!-- System Notes -->
        <div v-show="active === 3" class="ns-subpanel">
          <div class="ns-tablescroll">
            <table class="ns-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Field</th>
                  <th>Change</th>
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
    </div>

    <div style="margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap">
      <NuxtLink to="/positions" class="ns-btn">🗂 View Employment History</NuxtLink>
      <NuxtLink to="/projects" class="ns-btn">📦 View Projects</NuxtLink>
      <button type="button" class="ns-btn" @click="toast.show('Employee record exported to PDF (just kidding — hire the guy).', { icon: '📄' })">
        Export
      </button>
    </div>
  </div>
</template>
