<script setup lang="ts">
useHead({ title: 'Script: How This Site Was Built | Bettsuite' })

const toast = useToast()

const stack = {
  title: 'Primary Information',
  fields: [
    { label: 'Script Type', value: 'Suitelet (allegedly)' },
    { label: 'Framework', value: 'Nuxt 4 · Vue 3 · SSR' },
    { label: 'Language', value: 'TypeScript (strict)' },
    { label: 'Runtime', value: 'Node · Nitro · single process' },
    { label: 'Data Store', value: 'SQLite (WAL) — one file' },
    { label: 'Deployment', value: 'Self-hosted · Docker' },
    { label: 'Owner', value: 'Riley Betts', href: '/employee' },
    { label: 'Status', value: 'Released', tone: 'green' as const },
  ],
}

const notes = [
  'Every visible word comes from one typed file — app/data/resume.ts. Components render from it and nothing hardcodes copy, so the résumé is edited in one place.',
  'The Bettsuite costume is a hand-written stylesheet scoped under a single body class. Behind a password at /ops sits a completely different dark console — first-party analytics with session replay, no third-party trackers, all of it on the same box that serves this page.',
  'No UI kit, no component library, no template. The masthead, the menu bar, the field groups and the subtabs are all hand-rolled CSS, built against Bettsuite’s own published design tokens rather than from memory. Any resemblance to enterprise software you have suffered through is entirely intentional.',
]

const sublist = [
  { file: 'app/data/resume.ts', role: 'Content model — the single source of truth' },
  { file: 'app/assets/css/bettsuite.css', role: 'The costume — tokens, chrome, records, lists' },
  { file: 'app/components/ns/*.vue', role: 'Masthead, menu bar, portlets, subtabs, tables' },
  { file: 'app/pages/**', role: 'Dashboard, records, lists, this page' },
  { file: 'server/**', role: 'Analytics intake, /ops API, SQLite access' },
]
</script>

<template>
  <div data-section="colophon">

    <NsRecordHeader
      type="Script"
      name="customscript_resume_bettsuite"
      record-id="1"
     
      status-label="Released"
    >
      <template #actions>
        <button type="button" class="ns-btn" @click="toast.show('Deployment records are read-only in Production.')">
          Edit
        </button>
        <NuxtLink to="/" class="ns-btn">Back</NuxtLink>
        <a href="https://github.com/Riley-D-Betts" target="_blank" rel="noopener" class="ns-btn ns-btn--primary">
          View Source
        </a>
      </template>
    </NsRecordHeader>

    <NsFieldGroup :group="stack" />

    <NsSubtabs :tabs="['Notes', 'Files', 'Deployments']" v-slot="{ active }">
        <div v-show="active === 0" class="ns-subpanel">
          <div class="ns-prose">
            <p v-for="(n, i) in notes" :key="i">{{ n }}</p>
          </div>
        </div>

        <div v-show="active === 1" class="ns-subpanel">
          <div class="ns-tablescroll">
            <table class="ns-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th class="ns-nosort">Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, i) in sublist" :key="s.file">
                  <td>{{ s.file }}</td>
                  <td>{{ s.role }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-show="active === 2" class="ns-subpanel">
          <div class="ns-tablescroll">
            <table class="ns-table">
              <thead>
                <tr>
                  <th>Deployment</th>
                  <th>Audience</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>/ — Role Center</td>
                  <td>All Roles</td>
                  <td><NsStatusPill tone="green" label="Released" /></td>
                </tr>
                <tr>
                  <td>/ops — Analytics Console</td>
                  <td>Administrator</td>
                  <td><NsStatusPill tone="amber" label="Password Gated" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
    </NsSubtabs>

    <div class="ns-buttonbar ns-buttonbar--secondary">
      <NuxtLink to="/" class="ns-btn">Back</NuxtLink>
    </div>
  </div>
</template>
