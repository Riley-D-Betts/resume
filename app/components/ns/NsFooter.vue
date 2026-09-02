<script setup lang="ts">
import { resume } from '~/data/resume'

const account = resume.account
const contact = resume.contact

// The notice names `?optout=1`; render that token as a real link. A plain
// <a> on purpose: a full document load re-runs the analytics plugin, which
// reads the flag from location.search at init (a router push would not).
// The relative href keeps the visitor on the page they were reading.
const OPTOUT = '?optout=1'
const cut = contact.privacyNotice.indexOf(OPTOUT)
const privacy =
  cut === -1
    ? { before: contact.privacyNotice, link: '', after: '' }
    : {
        before: contact.privacyNotice.slice(0, cut),
        link: OPTOUT,
        after: contact.privacyNotice.slice(cut + OPTOUT.length),
      }
</script>

<template>
  <footer class="ns-footer" data-zone="footer">
    <div class="ns-footer__inner">
      <span class="ns-footer__badge">Powered by Bettsuite</span>
      <span>Release {{ account.release }}</span>
      <span>{{ account.accountId }}</span>
      <span>Role: {{ account.roleLabel }}</span>
      <span>{{ account.environment }}</span>
      <span class="ns-footer__spacer" />
      <span>{{ contact.footer }}</span>
      <p class="ns-footer__privacy">{{ privacy.before }}<a v-if="privacy.link" :href="privacy.link">{{ privacy.link }}</a>{{ privacy.after }}</p>
      <!-- Honeypot (K5): no human can see, focus or click this; a crawler
           that ignores robots.txt follows it and flags itself. -->
      <a class="void-link" href="/void.html" tabindex="-1" aria-hidden="true" rel="nofollow">void</a>
    </div>
  </footer>
</template>
