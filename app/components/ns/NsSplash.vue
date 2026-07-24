<script setup lang="ts">
import { resume } from '~/data/resume'
</script>

<template>
  <div class="ns-splash" aria-hidden="true">
    <div class="ns-splash__box">
      <div class="ns-splash__logo">
        <span class="ns-logo__tile">N</span>
        <span class="ns-logo__word">Net<b>Suite</b></span>
      </div>
      <div class="ns-spinner" />
      <p class="ns-splash__msg">Loading {{ resume.account.personName }}'s account…</p>
    </div>
  </div>
</template>
