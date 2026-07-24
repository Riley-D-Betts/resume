<script setup lang="ts">
import { resume } from '~/data/resume'

const account = resume.account
const contact = resume.contact
</script>

<template>
  <footer class="ns-footer">
    <div class="ns-footer__inner">
      <span class="ns-footer__badge">Powered by NetSuite</span>
      <span>Release {{ account.release }}</span>
      <span>{{ account.accountId }}</span>
      <span>Role: {{ account.roleLabel }}</span>
      <span>{{ account.environment }}</span>
      <span class="ns-footer__spacer" />
      <span>{{ contact.footer }}</span>
      <p class="ns-footer__privacy">{{ contact.privacyNotice }}</p>
    </div>
  </footer>
</template>
