<script setup lang="ts">
import { resume } from '~/data/resume'
import { useTrack } from '~/composables/useTrack'

useHead({ title: 'Message | Bettsuite' })

const c = resume.contact
const toast = useToast()
const track = useTrack()

const author = ref('')
const subject = ref(c.subjects[0]!)
const body = ref('')

// ---- form funnel (contract B.7) --------------------------------------
// Steps only, never values: focus → input → field → submit | invalid,
// plus reset. "submit" means this page composed a mailto: and handed off
// to the visitor's mail client — nothing is ever sent from here.
type FormField = 'author' | 'subject' | 'body'
let focusedAt = 0
let focusSent = false
let inputSent = false
const fieldsDone = new Set<FormField>()

function facts(): Record<string, unknown> {
  return {
    bodyLen: body.value.trim().length,
    authorFilled: author.value.trim().length > 0,
    ...(focusedAt ? { msSinceFocus: Date.now() - focusedAt } : {}),
  }
}

/** First focus on any field, once per visit. */
function onFocus(): void {
  if (focusSent) return
  focusSent = true
  focusedAt = Date.now()
  track('form', 'focus', { step: 'focus' })
}

/** First keystroke / selection in any field, once per visit. */
function onInput(): void {
  if (inputSent) return
  inputSent = true
  track('form', 'input', { step: 'input' })
}

/** A field completed — left with a value (the select: changed). Once per field. */
function onFieldDone(field: FormField): void {
  const value = field === 'author' ? author.value : field === 'subject' ? subject.value : body.value
  if (!value.trim() || fieldsDone.has(field)) return
  fieldsDone.add(field)
  track('form', 'field', {
    step: 'field',
    field,
    ...(field === 'subject' ? { subject: subject.value.slice(0, 40) } : {}),
    ...facts(),
  })
}

function onSubjectChange(): void {
  onInput()
  onFieldDone('subject')
}

function send(): void {
  if (!body.value.trim()) {
    track('form', 'invalid', { step: 'invalid', ...facts() })
    toast.show('Please enter a value for Message.', { icon: '⚠' })
    return
  }
  const s = encodeURIComponent(subject.value)
  const b = encodeURIComponent(`${body.value}\n\n${author.value ? `— ${author.value}` : ''}`.trim())
  // the mail handoff — the funnel's terminal step
  track('form', 'submit', { step: 'submit', subject: subject.value.slice(0, 40), ...facts() })
  toast.show('Message composed — opening your mail client…')
  window.location.href = `mailto:${c.email}?subject=${s}&body=${b}`
}

function reset(): void {
  track('form', 'reset', { step: 'reset', ...facts() })
  author.value = ''
  subject.value = c.subjects[0]!
  body.value = ''
  fieldsDone.clear()
  toast.show('Form reset.')
}
</script>

<template>
  <div data-page="contact">

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
        <div class="ns-fieldgroup" data-section="contact.form">
          <div class="ns-fields ns-fields--one">
            <div class="ns-field">
              <span class="ns-field__label">Recipient</span>
              <span class="ns-field__value">
                <a :href="`mailto:${c.email}`" data-track-hover="email">{{ c.email }}</a>
              </span>
            </div>
            <div class="ns-field">
              <label class="ns-field__label" for="msg-author">Your Name</label>
              <span class="ns-field__value">
                <input
                  id="msg-author"
                  v-model="author"
                  class="ns-input"
                  style="width: 100%; max-width: 340px"
                  placeholder="Optional"
                  @focus="onFocus"
                  @input="onInput"
                  @blur="onFieldDone('author')"
                />
              </span>
            </div>
            <div class="ns-field">
              <label class="ns-field__label" for="msg-subject">Subject</label>
              <span class="ns-field__value">
                <select
                  id="msg-subject"
                  v-model="subject"
                  class="ns-select"
                  style="width: 100%; max-width: 340px"
                  @focus="onFocus"
                  @change="onSubjectChange"
                >
                  <option v-for="s in c.subjects" :key="s" :value="s">{{ s }}</option>
                </select>
              </span>
            </div>
            <div class="ns-field">
              <label class="ns-field__label" for="msg-body">Message<span class="ns-req">*</span></label>
              <span class="ns-field__value">
                <textarea
                  id="msg-body"
                  v-model="body"
                  class="ns-textarea"
                  placeholder="What can I build for you?"
                  @focus="onFocus"
                  @input="onInput"
                  @blur="onFieldDone('body')"
                />
              </span>
            </div>
          </div>
        </div>

        <div class="ns-buttonbar ns-buttonbar--secondary" data-zone="record-actions">
          <button type="button" class="ns-btn ns-btn--primary" @click="send">Save &amp; Send</button>
          <button type="button" class="ns-btn" @click="reset">Reset</button>
          <span class="ns-buttonbar__spacer" />
          <span class="ns-buttonbar__note">* Required</span>
        </div>
      </div>

      <div>
        <div class="ns-secbar">Contact Information</div>
        <div class="ns-fieldgroup" data-section="contact.info">
          <div class="ns-fields ns-fields--one">
            <div class="ns-field">
              <span class="ns-field__label">Email</span>
              <span class="ns-field__value"><a :href="`mailto:${c.email}`" data-track-hover="email">{{ c.email }}</a></span>
            </div>
            <div class="ns-field">
              <span class="ns-field__label">GitHub</span>
              <span class="ns-field__value">
                <a :href="c.githubUrl" target="_blank" rel="noopener" data-track-hover="github">{{ c.github }}</a>
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
