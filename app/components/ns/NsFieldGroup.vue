<script setup lang="ts">
import type { FieldGroup } from '~/data/resume'

defineProps<{
  group: FieldGroup
  /** analytics section name (`employee.primary` …) — rendered as `data-section` */
  section?: string
}>()

function isInternal(href?: string): boolean {
  return !!href && href.startsWith('/')
}

/** Hover-intent key for the two outbound links a recruiter cares about. */
function hoverKey(href: string): string | undefined {
  if (href.startsWith('mailto:')) return 'email'
  if (/^https?:\/\/(www\.)?github\.com(\/|$)/i.test(href)) return 'github'
  return undefined
}
</script>

<template>
  <div class="ns-secbar">{{ group.title }}</div>
  <div class="ns-fieldgroup" :data-section="section">
    <div class="ns-fields">
      <div v-for="f in group.fields" :key="f.label" class="ns-field">
        <div class="ns-field__label" :class="{ 'ns-field__label--help': f.help }" :title="f.help">
          {{ f.label }}
        </div>
        <div class="ns-field__value">
          <template v-if="f.href">
            <NuxtLink v-if="isInternal(f.href)" :to="f.href">{{ f.value }}</NuxtLink>
            <a
              v-else
              :href="f.href"
              :target="f.href.startsWith('mailto:') ? undefined : '_blank'"
              rel="noopener"
              :data-track-hover="hoverKey(f.href)"
              >{{ f.value }}</a
            >
          </template>
          <span v-else>{{ f.value }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
