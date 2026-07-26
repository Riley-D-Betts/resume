<script setup lang="ts">
/**
 * A Bettsuite record page title block plus its button row.
 *
 * Bettsuite's layout, which is the opposite of the obvious one:
 *   line 1 — a 30px record icon + the record TYPE as a big bold
 *            slate-blue heading ("Employee")
 *   line 2 — the record ID in bold slate, then the record NAME at
 *            the same size but LIGHTER weight and gray, then a
 *            square uppercase status block
 * The button row underneath sits directly on the white page: no
 * background, no border, no gradient strip.
 */
withDefaults(
  defineProps<{
    type: string
    name: string
    recordId?: string
    glyph?: string
    statusLabel?: string
    statusWarn?: boolean
  }>(),
  { statusWarn: false },
)
</script>

<template>
  <div class="ns-pagetitle">
    <div class="ns-pagetitle__first">
      <span v-if="glyph" class="ns-record-icon" aria-hidden="true">{{ glyph }}</span>
      <h1 class="ns-record-type">{{ type }}</h1>
      <div v-if="$slots.titlemenu" class="ns-pagetitle__menu">
        <slot name="titlemenu" />
      </div>
    </div>
    <div class="ns-pagetitle__second">
      <span v-if="recordId" class="ns-record-id">{{ recordId }}</span>
      <span class="ns-record-name">{{ name }}</span>
      <span
        v-if="statusLabel"
        class="ns-record-status"
        :class="{ 'ns-record-status--warn': statusWarn }"
        >{{ statusLabel }}</span
      >
    </div>
  </div>

  <div class="ns-buttonbar">
    <slot name="actions" />
  </div>
</template>
