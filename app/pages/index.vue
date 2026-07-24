<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: resume.meta.title })

const d = resume.dashboard
const account = resume.account
const toast = useToast()
const NsLink = resolveComponent('NuxtLink')

// Client-only date so SSR/CSR hydration never mismatches on timezone.
const asOf = ref('—')
onMounted(() => {
  asOf.value = new Intl.DateTimeFormat('en-US', {
    timeZone: resume.identity.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date())
})

function externalAttrs(href?: string) {
  return href ? { href, target: '_blank', rel: 'noopener' } : {}
}
</script>

<template>
  <div data-section="home">
    <NsBreadcrumb :items="[{ label: 'Home' }]" />

    <NsPageTitle title="Home" meta="Role Center" :subtitle="`${d.greeting} — welcome back to the account.`">
      <template #actions>
        <button
          type="button"
          class="ns-btn"
          @click="toast.show('Layout is locked — you have read-only Administrator access to this résumé.', { icon: '🔒' })"
        >
          ⚙ Personalize
        </button>
        <NuxtLink to="/contact" class="ns-btn ns-btn--primary">＋ New Message</NuxtLink>
      </template>
    </NsPageTitle>

    <div class="ns-note" style="margin-bottom: 14px">
      <b>New Release {{ account.release }}.</b> {{ d.tip }}
    </div>

    <div class="ns-dash">
      <!-- Column 1 -->
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
              <span class="ns-remind__label" :class="{ 'ns-remind__label--plain': !r.to }">{{ r.label }}</span>
            </component>
          </ul>
          <template #foot>
            <button
              type="button"
              class="ns-linkish"
              @click="toast.show('Reminders refreshed. Everything is on track.')"
            >
              Set Up Reminders
            </button>
          </template>
        </NsPortlet>

        <NsPortlet title="Key Performance Indicators">
          <NsKpiTable :kpis="d.kpis" />
          <template #foot>
            <span style="color: var(--ns-muted)">As of {{ asOf }} · {{ account.environment }}</span>
          </template>
        </NsPortlet>
      </div>

      <!-- Column 2 -->
      <div class="ns-dash__col">
        <NsPortlet title="KPI Meter — Uptime">
          <NsMeter
            :label="d.meter.label"
            :value="d.meter.value"
            :percent="d.meter.percent"
            :min="d.meter.min"
            :max="d.meter.max"
            :target="d.meter.target"
          />
        </NsPortlet>

        <NsPortlet title="Trend Graph">
          <NsTrend :title="d.trend.title" :unit="d.trend.unit" :points="d.trend.points" />
          <template #foot>
            <NuxtLink to="/positions">Open Employment History →</NuxtLink>
          </template>
        </NsPortlet>

        <NsPortlet title="Report Snapshot — Skills Coverage">
          <NsReport :rows="d.report.rows" />
          <template #foot>
            <NuxtLink to="/employee">View full skills matrix →</NuxtLink>
          </template>
        </NsPortlet>
      </div>

      <!-- Column 3 -->
      <div class="ns-dash__col ns-dash__col--3">
        <NsPortlet title="Recent Records">
          <ul class="ns-recent">
            <component
              :is="rec.to ? NsLink : 'a'"
              v-for="rec in d.recent"
              :key="rec.name"
              v-bind="rec.to ? { to: rec.to } : externalAttrs(rec.href)"
              class="ns-recent__item"
            >
              <span class="ns-recent__glyph">{{ rec.glyph }}</span>
              <span class="ns-recent__type">{{ rec.type }}</span>
              <span class="ns-recent__name">{{ rec.name }}</span>
            </component>
          </ul>
        </NsPortlet>

        <NsPortlet title="Shortcuts">
          <div class="ns-tiles">
            <component
              :is="s.to ? NsLink : 'a'"
              v-for="s in d.shortcuts"
              :key="s.label"
              v-bind="s.to ? { to: s.to } : externalAttrs(s.href)"
              class="ns-tile"
            >
              <span class="ns-tile__glyph">{{ s.glyph }}</span>
              <span class="ns-tile__label">{{ s.label }}</span>
            </component>
          </div>
          <template #foot>
            <NuxtLink to="/contact">Add shortcut → New Message</NuxtLink>
          </template>
        </NsPortlet>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ns-linkish {
  color: var(--ns-link);
  font: inherit;
  cursor: pointer;
}
.ns-linkish:hover {
  text-decoration: underline;
}
</style>
