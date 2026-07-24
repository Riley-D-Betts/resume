<script setup lang="ts">
import { resume } from '~/data/resume'

/**
 * Hidden feature: a working terminal. Opens with the backtick key, or
 * five taps on the HUD version number (mobile path). Command dialogue
 * lives here rather than resume.ts — it's console behavior, not
 * résumé copy.
 */
interface TermLine {
  kind: 'cmd' | 'out'
  text: string
}

const open = ref(false)
const input = ref('')
const lines = ref<TermLine[]>([])
const drawer = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const screen = ref<HTMLElement | null>(null)

const PROMPT = 'guest@riley-ops:~$'
let cmdHistory: string[] = []
let histPos = -1

function out(text: string) {
  lines.value.push({ kind: 'out', text })
}

function scrollDown() {
  void nextTick(() => {
    if (screen.value) screen.value.scrollTop = screen.value.scrollHeight
  })
}

const MILK = [
  '      ______',
  '     |______|',
  '     |      |',
  '     | MILK |',
  '     | 100% |',
  '     |______|',
  '   poured. stay calcium-strong.',
]

const COMMANDS: Record<string, (arg?: string) => void> = {
  help() {
    out('available commands:')
    out('  whoami      riley       uptime      history')
    out('  projects    fobech      contact     hire')
    out('  milk        andon       degauss     lights')
    out('  reboot      clear       exit')
    out('(some commands are not listed. that is the point.)')
  },
  whoami() {
    out('guest — probably a hiring manager. welcome.')
  },
  riley() {
    out(`${resume.identity.name.join(' ')} — ${resume.identity.role}`)
    out(`${resume.identity.location} · founder of ${resume.fobech.name}`)
  },
  uptime() {
    const epoch = new Date(`${resume.identity.hiredISO}T08:00:00-07:00`).getTime()
    const days = ((Date.now() - epoch) / 86400000).toFixed(2)
    out(`career uptime: ${days} days. zero unplanned outages.`)
  },
  history() {
    for (const role of resume.roles) {
      out(`— ${role.org}`)
      for (const t of role.titles) out(`    ${t.title.toLowerCase()}`)
    }
  },
  projects() {
    for (const p of resume.projects) out(`${p.bay}  ${p.name.padEnd(14)} ${p.status}`)
    out('links are in segment 05.')
  },
  fobech() {
    out(resume.fobech.taglines[0])
    out(resume.fobech.taglines[1])
    out(`→ ${resume.fobech.url}`)
  },
  contact() {
    out(`opening channel to ${resume.identity.email} …`)
    setTimeout(() => (location.href = `mailto:${resume.identity.email}`), 600)
  },
  hire() {
    COMMANDS.contact!()
  },
  sudo(arg?: string) {
    if (arg?.startsWith('hire')) {
      out('permission granted. root access to the candidate pipeline…')
      setTimeout(
        () => (location.href = `mailto:${resume.identity.email}?subject=${encodeURIComponent('Job offer: God King of NetSuite')}`),
        900,
      )
    } else {
      out('guest is not in the sudoers file. this incident will be reported.')
      out('(it will genuinely show up in the analytics.)')
    }
  },
  milk() {
    MILK.forEach((l, i) => setTimeout(() => { out(l); scrollDown() }, i * 110))
  },
  moo() {
    out('this console has super dairy powers.')
  },
  andon() {
    out('DRILL INITIATED — watch the lamps.')
    ;(window.ops?.andon as (() => void) | undefined)?.()
  },
  degauss() {
    out('degaussing…')
    window.dispatchEvent(new CustomEvent('rb:egg-degauss'))
  },
  lights() {
    out('cutting plant power. find the flashlight.')
    close()
    window.dispatchEvent(new CustomEvent('rb:egg-lights'))
  },
  reboot() {
    out('rebooting console…')
    sessionStorage.removeItem('rb_booted')
    setTimeout(() => location.reload(), 700)
  },
  clear() {
    lines.value = []
  },
  exit() {
    close()
  },
}

function run(raw: string) {
  const text = raw.trim()
  lines.value.push({ kind: 'cmd', text: `${PROMPT} ${text}` })
  if (text) {
    cmdHistory.push(text)
    histPos = cmdHistory.length
    const [cmd, ...rest] = text.toLowerCase().split(/\s+/)
    const fn = cmd ? COMMANDS[cmd] : undefined
    if (fn) {
      window.__rbTrack?.('easter_egg', `term:${cmd}`)
      fn(rest.join(' '))
    } else {
      out(`command not found: ${cmd} — try help`)
    }
  }
  input.value = ''
  scrollDown()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter') run(input.value)
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (histPos > 0) input.value = cmdHistory[--histPos] ?? ''
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (histPos < cmdHistory.length - 1) input.value = cmdHistory[++histPos] ?? ''
    else input.value = ''
  } else if (e.key === 'Escape') close()
}

async function openDrawer() {
  if (open.value) return
  open.value = true
  window.__rbTrack?.('easter_egg', 'terminal')
  if (!lines.value.length) {
    out('RILEY.BETTS/OPS maintenance interface. type help to begin.')
  }
  await nextTick()
  inputEl.value?.focus()
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduced && drawer.value) {
    const { gsap } = await import('gsap')
    gsap.fromTo(drawer.value, { yPercent: 100 }, { yPercent: 0, duration: 0.35, ease: 'console' })
  }
  scrollDown()
}

async function close() {
  if (!open.value) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reduced && drawer.value) {
    const { gsap } = await import('gsap')
    await gsap.to(drawer.value, { yPercent: 100, duration: 0.25, ease: 'power2.in' }).then()
  }
  open.value = false
}

function onGlobalKey(e: KeyboardEvent) {
  if (e.key === '`' && !open.value) {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    e.preventDefault()
    void openDrawer()
  }
}

// mobile path: five taps on the HUD version number
let taps = 0
let tapTimer: ReturnType<typeof setTimeout> | undefined
function onBrandTap(e: Event) {
  const t = (e.target as HTMLElement | null)?.closest('.hud__ver')
  if (!t) return
  taps += 1
  clearTimeout(tapTimer)
  tapTimer = setTimeout(() => (taps = 0), 1600)
  if (taps >= 5) {
    taps = 0
    void openDrawer()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
  document.addEventListener('pointerdown', onBrandTap, { passive: true })
  if (window.ops) window.ops.terminal = () => (openDrawer(), 'opening…')
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey)
  document.removeEventListener('pointerdown', onBrandTap)
  clearTimeout(tapTimer)
})
</script>

<template>
  <div v-if="open" ref="drawer" class="term" role="dialog" aria-label="Maintenance terminal">
    <div class="term__bar">
      <span class="label">MAINTENANCE TERMINAL — CLEARANCE: GUEST</span>
      <button class="term__close label" @click="close">[ ESC ]</button>
    </div>
    <div ref="screen" class="term__screen">
      <p v-for="(l, i) in lines" :key="i" class="term__line" :class="`term__line--${l.kind}`">{{ l.text }}</p>
      <div class="term__input-row">
        <span class="term__prompt">{{ PROMPT }}</span>
        <input
          ref="inputEl"
          v-model="input"
          class="term__input"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          @keydown="onKey"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.term {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: min(46vh, 420px);
  z-index: calc(var(--z-boot) - 1);
  background: color-mix(in srgb, var(--bg-0) 96%, transparent);
  border-top: 1px solid var(--teal);
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  font-size: var(--fs-data);
}

.term__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--hairline);
}

.term__close {
  color: var(--text-dim);
  border: 1px solid var(--hairline);
  padding: 2px 8px;
}

.term__close:hover {
  color: var(--teal-hot);
  border-color: var(--teal);
}

.term__screen {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3);
  line-height: 1.7;
}

.term__line {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.term__line--cmd {
  color: var(--text);
}

.term__line--out {
  color: var(--text-dim);
}

.term__input-row {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
}

.term__prompt {
  color: var(--green);
  flex: none;
}

.term__input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text);
  font: inherit;
  caret-color: var(--green);
}
</style>
