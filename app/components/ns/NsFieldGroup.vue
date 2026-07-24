<script setup lang="ts">
import type { FieldGroup } from '~/data/resume'

defineProps<{ group: FieldGroup }>()

function isInternal(href?: string): boolean {
  return !!href && href.startsWith('/')
}
</script>

<template>
  <div class="ns-fieldgroup">
    <div class="ns-fieldgroup__title">{{ group.title }}</div>
    <div class="ns-fields">
      <div v-for="f in group.fields" :key="f.label" class="ns-field">
        <div class="ns-field__label" :class="{ 'ns-field__label--help': f.help }" :title="f.help">
          {{ f.label }}
        </div>
        <div class="ns-field__value" :class="{ 'ns-mono': f.mono }">
          <template v-if="f.href">
            <NuxtLink v-if="isInternal(f.href)" :to="f.href">{{ f.value }}</NuxtLink>
            <a
              v-else
              :href="f.href"
              :target="f.href.startsWith('mailto:') ? undefined : '_blank'"
              rel="noopener"
              >{{ f.value }}</a
            >
          </template>
          <NsStatusPill v-else-if="f.tone" :tone="f.tone" :label="f.value" />
          <span v-else>{{ f.value }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
