<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: resume.meta.title })

/**
 * The Home dashboard — Bettsuite's "Role Center".
 * Bettsuite's Home page deliberately has NO breadcrumb, NO page-title
 * bar and NO action buttons: the menu bar sits directly above the
 * portlet grid, with only a right-aligned link row for chrome.
 */
const d = resume.dashboard
const account = resume.account
const toast = useToast()
const NsLink = resolveComponent('NuxtLink')

// Client-only date so SSR/CSR hydration never mismatches on timezone.
const asOf = ref('—')
onMounted(() => {
  asOf.value = new Intl.DateTimeFormat('en-US', {
    timeZone: resume.identity.timezone,
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date())
})

function externalAttrs(href?: string) {
  return href ? { href, target: '_blank', rel: 'noopener' } : {}
}

const locked = () => toast.show('This dashboard is Locked — content and layout cannot be changed.')
</script>

<template>
  <div data-section="home">
    <div class="ns-dashbar">
      <span class="ns-dashbar__spacer ns-dashbar__greet">
        <b>{{ d.greeting }}</b> — {{ account.edition }} · {{ account.roleLabel }}
      </span>
      <button type="button" class="ns-linkish" @click="locked">Personalize</button>
      <button type="button" class="ns-linkish" @click="locked">Layout</button>
      <NuxtLink to="/colophon">Set Up Custom Tab</NuxtLink>
    </div>

    <div class="ns-note" style="margin-bottom: 8px">
      <b>Release {{ account.release }} is now available.</b> {{ d.tip }}
    </div>

    <div class="ns-dash">
      <!-- Narrow left column -->
      <div class="ns-dash__col">
        <NsPortlet title="Reminders">
          <ul class="ns-remind">
            <component
              :is="r.to ? NsLink : 'div'"
              v-for="r in d.reminders"
              :key="r.label"
              v-bind="r.to ? { to: r.to } : {}"
              class="ns-remind__item"
            >
              <span class="ns-remind__count" :class="`ns-remind__count--${r.tone}`">{{ r.count }}</span>
              <span class="ns-remind__label">{{ r.label }}</span>
            </component>
          </ul>
          <template #foot>
            <span style="color: var(--ns-muted)">Last refreshed {{ asOf }}</span>
          </template>
        </NsPortlet>

        <NsPortlet title="Settings" :refreshable="false">
          <ul class="ns-links">
            <button type="button" class="ns-links__item" style="text-align: left; width: 100%" @click="locked">
              Personalize Dashboard
            </button>
            <NuxtLink to="/employee" class="ns-links__item">Set Preferences</NuxtLink>
            <NuxtLink to="/contact" class="ns-links__item">Change Email</NuxtLink>
            <NuxtLink to="/colophon" class="ns-links__item">Set Up Custom Tab</NuxtLink>
          </ul>
        </NsPortlet>

        <NsPortlet title="Shortcuts" :refreshable="false">
          <ul class="ns-links">
            <component
              :is="s.to ? NsLink : 'a'"
              v-for="s in d.shortcuts"
              :key="s.label"
              v-bind="s.to ? { to: s.to } : externalAttrs(s.href)"
              class="ns-links__item"
            >
              {{ s.label }}
            </component>
          </ul>
          <template #foot>
            <NuxtLink to="/contact">Set Up Shortcuts</NuxtLink>
          </template>
        </NsPortlet>
      </div>

      <!-- Wide middle column -->
      <div class="ns-dash__col">
        <NsPortlet title="Key Performance Indicators">
          <NsKpiTable :kpis="d.kpis" />
          <template #foot>
            <span style="color: var(--ns-muted)">As of {{ asOf }} · Date Range: This Period</span>
          </template>
        </NsPortlet>

        <NsPortlet :title="d.demo.title" flush>
          <template #tools>
            <a
              class="ns-portlet__tool"
              :href="d.demo.url"
              target="_blank"
              rel="noopener"
              title="Open demo in new tab"
              aria-label="Open demo in new tab"
            >↗</a>
          </template>
          <div class="ns-demoframe">
            <iframe :src="d.demo.url" :title="d.demo.title" loading="lazy" />
          </div>
          <template #foot>
            <div class="ns-demoframe__foot">
              <a :href="d.demo.url" target="_blank" rel="noopener">{{ d.demo.cta }} ↗</a>
              <span class="ns-demoframe__note">{{ d.demo.note }}</span>
            </div>
          </template>
        </NsPortlet>

        <NsPortlet title="Trend Graph">
          <NsTrend :title="d.trend.title" :unit="d.trend.unit" :points="d.trend.points" />
          <template #foot>
            <NuxtLink to="/positions">Open Employment History</NuxtLink>
          </template>
        </NsPortlet>
      </div>

      <!-- Narrow right column -->
      <div class="ns-dash__col ns-dash__col--3">
        <NsPortlet title="KPI Meter">
          <NsMeter
            :label="d.meter.label"
            :value="d.meter.value"
            :percent="d.meter.percent"
            :min="d.meter.min"
            :max="d.meter.max"
            :target="d.meter.target"
          />
        </NsPortlet>

        <NsPortlet title="Recent Records">
          <ul class="ns-recent">
            <component
              :is="rec.to ? NsLink : 'a'"
              v-for="rec in d.recent"
              :key="rec.name"
              v-bind="rec.to ? { to: rec.to } : externalAttrs(rec.href)"
              class="ns-recent__item"
            >
              <span class="ns-recent__name">{{ rec.name }}</span>
              <span class="ns-recent__type">{{ rec.type }}</span>
            </component>
          </ul>
        </NsPortlet>

        <NsPortlet title="Report Snapshots">
          <NsReport :rows="d.report.rows" />
          <template #foot>
            <NuxtLink to="/employee">Skills Coverage by Discipline — view full report</NuxtLink>
          </template>
        </NsPortlet>
      </div>
    </div>
  </div>
</template>
