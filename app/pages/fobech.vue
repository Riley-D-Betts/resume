<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'Subsidiary: Fobech | NetSuite' })

const f = resume.fobech
const toast = useToast()

const actions = [
  { label: 'View Principal (Riley Betts)', to: '/employee' },
  { label: 'View Founder Position', to: '/positions/fobech' },
  { label: 'Visit fobech.com', href: f.url },
]
</script>

<template>
  <div data-section="fobech">

    <NsRecordHeader type="Subsidiary" :name="f.name" record-id="2" status-label="Active">
      <template #actions>
        <button type="button" class="ns-btn" @click="toast.show('Read-only — Fobech ships software, not résumé edits.')">
          Edit
        </button>
        <NuxtLink to="/" class="ns-btn">Back</NuxtLink>
        <NsActionMenu :items="actions" />
        <a :href="f.url" target="_blank" rel="noopener" class="ns-btn ns-btn--primary">{{ f.cta }}</a>
      </template>
    </NsRecordHeader>

    <NsFieldGroup :group="f.groups[0]!" />

    <NsSubtabs :tabs="['Capabilities', 'About', 'Preferences']" v-slot="{ active }">
        <div v-show="active === 0" class="ns-subpanel">
          <div class="ns-tablescroll">
            <table class="ns-table">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th class="ns-nosort">Description</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(c, i) in f.capabilities" :key="c.title">
                  <td class="ns-table__name">{{ c.title }}</td>
                  <td>{{ c.desc }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-show="active === 1" class="ns-subpanel">
          <img
            src="/fobech/logo.svg"
            alt="Fobech"
            style="height: 30px; width: auto; margin-bottom: 10px"
            onerror="this.style.display='none'"
          />
          <div class="ns-prose">
            <p><b>{{ f.taglines[0] }}</b> {{ f.taglines[1] }}</p>
            <p>{{ f.blurb }}</p>
          </div>
        </div>

        <div v-show="active === 2" style="padding: 0">
          <NsFieldGroup :group="f.groups[1]!" />
        </div>
    </NsSubtabs>

    <div class="ns-buttonbar ns-buttonbar--secondary">
      <NuxtLink to="/positions/fobech" class="ns-btn">View Founder Position</NuxtLink>
      <a :href="f.url" target="_blank" rel="noopener" class="ns-btn">{{ f.cta }}</a>
    </div>
  </div>
</template>
