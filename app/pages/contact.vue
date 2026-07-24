<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'New Message | NetSuite' })

const c = resume.contact
const toast = useToast()

const author = ref('')
const subject = ref(c.subjects[0]!)
const body = ref('')

function send(): void {
  if (!body.value.trim()) {
    toast.show('Add a message before sending.', { icon: '⚠' })
    return
  }
  const s = encodeURIComponent(subject.value)
  const b = encodeURIComponent(`${body.value}\n\n${author.value ? `— ${author.value}` : ''}`.trim())
  toast.show('Message composed — opening your mail client…', { icon: '✉' })
  window.location.href = `mailto:${c.email}?subject=${s}&body=${b}`
}

function reset(): void {
  author.value = ''
  subject.value = c.subjects[0]!
  body.value = ''
  toast.show('Form reset.')
}
</script>

<template>
  <div data-section="contact">
    <NsBreadcrumb :items="[{ label: 'Home', to: '/' }, { label: 'Support', to: '/contact' }, { label: 'New Message' }]" />

    <NsPageTitle title="New Message" meta="Message" :subtitle="c.intro">
      <template #actions>
        <button type="button" class="ns-btn ns-btn--primary" @click="send">✓ Save &amp; Send</button>
        <button type="button" class="ns-btn" @click="reset">Reset</button>
      </template>
    </NsPageTitle>

    <div class="ns-cols">
      <div class="ns-record">
        <NsRecordHeader type="Message" name="Compose" subtitle="to Riley Betts" glyph="✉" status-tone="blue" status-label="Draft" />

        <div class="ns-fieldgroup">
          <div class="ns-fieldgroup__title">Message</div>
          <div class="ns-fields" style="grid-template-columns: 1fr">
            <div class="ns-field">
              <div class="ns-field__label">To</div>
              <div class="ns-field__value">
                <a :href="`mailto:${c.email}`">{{ c.email }}</a>
              </div>
            </div>
            <div class="ns-field">
              <label class="ns-field__label" for="msg-author">Your Name</label>
              <div class="ns-field__value">
                <input id="msg-author" v-model="author" class="ns-input" style="width: 100%; max-width: 360px" placeholder="Optional" />
              </div>
            </div>
            <div class="ns-field">
              <label class="ns-field__label" for="msg-subject">Subject</label>
              <div class="ns-field__value">
                <select id="msg-subject" v-model="subject" class="ns-select" style="width: 100%; max-width: 360px">
                  <option v-for="s in c.subjects" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>
            </div>
            <div class="ns-field" style="grid-template-columns: 128px 1fr; align-items: start">
              <label class="ns-field__label" for="msg-body">Message<span class="ns-req">*</span></label>
              <div class="ns-field__value">
                <textarea id="msg-body" v-model="body" class="ns-textarea" placeholder="What can I build for you?" />
              </div>
            </div>
          </div>
        </div>

        <div style="padding: 12px 16px">
          <button type="button" class="ns-btn ns-btn--primary" @click="send">✓ Save &amp; Send</button>
        </div>
      </div>

      <div>
        <NsPortlet title="Other Channels" :refreshable="false">
          <ul class="ns-recent">
            <a :href="`mailto:${c.email}`" class="ns-recent__item">
              <span class="ns-recent__glyph">✉</span>
              <span class="ns-recent__type">Email</span>
              <span class="ns-recent__name">{{ c.email }}</span>
            </a>
            <a :href="c.githubUrl" target="_blank" rel="noopener" class="ns-recent__item">
              <span class="ns-recent__glyph">↗</span>
              <span class="ns-recent__type">GitHub</span>
              <span class="ns-recent__name">{{ c.github }}</span>
            </a>
            <a href="https://fobech.com" target="_blank" rel="noopener" class="ns-recent__item">
              <span class="ns-recent__glyph">🏢</span>
              <span class="ns-recent__type">Studio</span>
              <span class="ns-recent__name">{{ c.fobech }}</span>
            </a>
          </ul>
          <template #foot>
            <span style="color: var(--ns-muted)">Based in {{ resume.identity.location }} · {{ resume.identity.timezone }}</span>
          </template>
        </NsPortlet>

        <div class="ns-note">
          <b>Heads up:</b> {{ c.privacyNotice }}
        </div>
      </div>
    </div>
  </div>
</template>
