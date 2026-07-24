<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'Subsidiary: Fobech | NetSuite' })

const f = resume.fobech

const actions = [
  { label: 'Edit', toast: 'Read-only — Fobech ships software, not résumé edits.' },
  { label: 'Visit fobech.com', href: f.url },
  { label: 'View Principal (Riley Betts)', to: '/employee' },
]
</script>

<template>
  <div data-section="fobech">
    <NsBreadcrumb :items="[{ label: 'Home', to: '/' }, { label: 'Subsidiaries', to: '/fobech' }, { label: f.name }]" />

    <div class="ns-record">
      <NsRecordHeader type="Subsidiary" :name="f.name" :subtitle="f.legalName" glyph="🏢" status-tone="teal" status-label="Active">
        <template #actions>
          <a :href="f.url" target="_blank" rel="noopener" class="ns-btn ns-btn--primary">↗ {{ f.cta }}</a>
          <NsActionMenu :items="actions" />
        </template>
      </NsRecordHeader>

      <div class="ns-note" style="margin: 12px 16px; background: var(--ns-teal-bg); border-color: #b6dde2; border-left-color: var(--ns-teal); color: #0c5763">
        <b>{{ f.taglines[0] }}</b> — {{ f.taglines[1] }}
      </div>

      <NsFieldGroup :group="f.groups[0]!" />

      <NsSubtabs :tabs="['Capabilities', 'About', 'Stack']" v-slot="{ active }">
        <div v-show="active === 0" class="ns-subpanel">
          <div class="ns-tablescroll">
            <table class="ns-table">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th class="ns-nosort">What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in f.capabilities" :key="c.title">
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
            style="height: 34px; width: auto; margin-bottom: 12px"
            onerror="this.style.display='none'"
          />
          <div class="ns-prose" style="max-width: 74ch">
            <p>{{ f.blurb }}</p>
          </div>
        </div>

        <div v-show="active === 2" class="ns-subpanel" style="padding: 0">
          <NsFieldGroup :group="f.groups[1]!" />
        </div>
      </NsSubtabs>
    </div>

    <div style="margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap">
      <NuxtLink to="/positions/fobech" class="ns-btn">💼 View Founder Position</NuxtLink>
      <a :href="f.url" target="_blank" rel="noopener" class="ns-btn">↗ {{ f.cta }}</a>
    </div>
  </div>
</template>
