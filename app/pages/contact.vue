<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({ title: 'Message | Bettsuite' })

const c = resume.contact
const toast = useToast()

const author = ref('')
const subject = ref(c.subjects[0]!)
const body = ref('')

function send(): void {
  if (!body.value.trim()) {
    toast.show('Please enter a value for Message.', { icon: '⚠' })
    return
  }
  const s = encodeURIComponent(subject.value)
  const b = encodeURIComponent(`${body.value}\n\n${author.value ? `— ${author.value}` : ''}`.trim())
  toast.show('Message composed — opening your mail client…')
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

    <NsRecordHeader type="Message" name="New Message" status-label="Draft">
      <template #actions>
        <button type="button" class="ns-btn ns-btn--primary" @click="send">Save &amp; Send</button>
        <button type="button" class="ns-btn" @click="reset">Reset</button>
        <NuxtLink to="/" class="ns-btn">Cancel</NuxtLink>
      </template>
    </NsRecordHeader>

    <div class="ns-cols">
      <div>
        <div class="ns-secbar">Primary Information</div>
        <div class="ns-fieldgroup">
          <div class="ns-fields ns-fields--one">
            <div class="ns-field">
              <span class="ns-field__label">Recipient</span>
              <span class="ns-field__value">
                <a :href="`mailto:${c.email}`">{{ c.email }}</a>
              </span>
            </div>
            <div class="ns-field">
              <label class="ns-field__label" for="msg-author">Your Name</label>
              <span class="ns-field__value">
                <input id="msg-author" v-model="author" class="ns-input" style="width: 100%; max-width: 340px" placeholder="Optional" />
              </span>
            </div>
            <div class="ns-field">
              <label class="ns-field__label" for="msg-subject">Subject</label>
              <span class="ns-field__value">
                <select id="msg-subject" v-model="subject" class="ns-select" style="width: 100%; max-width: 340px">
                  <option v-for="s in c.subjects" :key="s" :value="s">{{ s }}</option>
                </select>
              </span>
            </div>
            <div class="ns-field">
              <label class="ns-field__label" for="msg-body">Message<span class="ns-req">*</span></label>
              <span class="ns-field__value">
                <textarea id="msg-body" v-model="body" class="ns-textarea" placeholder="What can I build for you?" />
              </span>
            </div>
          </div>
        </div>

        <div class="ns-buttonbar ns-buttonbar--secondary">
          <button type="button" class="ns-btn ns-btn--primary" @click="send">Save &amp; Send</button>
          <button type="button" class="ns-btn" @click="reset">Reset</button>
          <span class="ns-buttonbar__spacer" />
          <span class="ns-buttonbar__note">* Required</span>
        </div>
      </div>

      <div>
        <div class="ns-secbar">Contact Information</div>
        <div class="ns-fieldgroup">
          <div class="ns-fields ns-fields--one">
            <div class="ns-field">
              <span class="ns-field__label">Email</span>
              <span class="ns-field__value"><a :href="`mailto:${c.email}`">{{ c.email }}</a></span>
            </div>
            <div class="ns-field">
              <span class="ns-field__label">GitHub</span>
              <span class="ns-field__value">
                <a :href="c.githubUrl" target="_blank" rel="noopener">{{ c.github }}</a>
              </span>
            </div>
            <div class="ns-field">
              <span class="ns-field__label">Studio</span>
              <span class="ns-field__value">
                <a href="https://fobech.com" target="_blank" rel="noopener">{{ c.fobech }}</a>
              </span>
            </div>
            <div class="ns-field">
              <span class="ns-field__label">Location</span>
              <span class="ns-field__value">{{ resume.identity.location }} · {{ resume.identity.timezone }}</span>
            </div>
          </div>
        </div>

        <div class="ns-note">{{ c.intro }}</div>
      </div>
    </div>
  </div>
</template>
