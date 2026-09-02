<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'Script: How This Site Was Built | Bettsuite' })

const toast = useToast()

// Every word on this page comes from resume.ts too — the Notes subtab
// says so, and it had better be true.
const col = resume.colophon
</script>

<template>
  <div data-page="colophon">

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
        <a
          :href="resume.identity.githubUrl"
          target="_blank"
          rel="noopener"
          class="ns-btn ns-btn--primary"
          data-track-hover="github"
        >
          View Source
        </a>
      </template>
    </NsRecordHeader>

    <NsFieldGroup :group="col.stack" section="colophon.primary" />

    <NsSubtabs :tabs="['Notes', 'Files', 'Deployments']" v-slot="{ active }">
        <div v-show="active === 0" class="ns-subpanel" data-section="colophon.notes">
          <div class="ns-prose">
            <p v-for="(n, i) in col.notes" :key="i">{{ n }}</p>
          </div>
        </div>

        <div v-show="active === 1" class="ns-subpanel" data-section="colophon.files">
          <div class="ns-tablescroll">
            <table class="ns-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th class="ns-nosort">Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in col.files" :key="s.file">
                  <td>{{ s.file }}</td>
                  <td>{{ s.role }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-show="active === 2" class="ns-subpanel" data-section="colophon.deployments">
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
                <tr v-for="d in col.deployments" :key="d.name">
                  <td>{{ d.name }}</td>
                  <td>{{ d.audience }}</td>
                  <td><NsStatusPill :tone="d.tone" :label="d.status" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
    </NsSubtabs>

    <div class="ns-buttonbar ns-buttonbar--secondary" data-zone="record-actions">
      <NuxtLink to="/" class="ns-btn">Back</NuxtLink>
    </div>
  </div>
</template>
