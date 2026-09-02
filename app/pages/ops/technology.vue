<script setup lang="ts">
import type { KN, TechDim, Technology } from '#shared/analytics/ops'

definePageMeta({ layout: 'ops', middleware: 'ops-auth' })

useHead({ title: 'OPS // TECHNOLOGY' })

const filters = useOpsFilters()
const fmt = useOpsFormat()
const { query } = filters

const { data, status, error } = useOpsFetch<Technology>('/api/ops/technology', { query })

interface TechPanel {
  dim: TechDim
  title: string
  keyLabel?: string
}

/** Every dimension the API groups (top 12 + Other). TLS fingerprints are never grouped — no panel for them. */
const PANELS: TechPanel[] = [
  { dim: 'gpuVendor', title: 'GPU VENDOR' },
  { dim: 'gpuRenderer', title: 'GPU RENDERER' },
  { dim: 'webgpu', title: 'WEBGPU ADAPTER' },
  { dim: 'arch', title: 'CPU ARCH // UA-CH' },
  { dim: 'bitness', title: 'BITNESS // UA-CH' },
  { dim: 'platformVer', title: 'PLATFORM VERSION // UA-CH' },
  { dim: 'formFactors', title: 'FORM FACTORS // UA-CH' },
  { dim: 'model', title: 'DEVICE MODEL // UA-CH' },
  { dim: 'brands', title: 'BRANDS // UA-CH' },
  { dim: 'chUa', title: 'SEC-CH-UA // LOW ENTROPY' },
  { dim: 'colorScheme', title: 'COLOR SCHEME' },
  { dim: 'reducedMotion', title: 'REDUCED MOTION' },
  { dim: 'contrast', title: 'CONTRAST' },
  { dim: 'forcedColors', title: 'FORCED COLORS' },
  { dim: 'touchPoints', title: 'TOUCH POINTS' },
  { dim: 'screens', title: 'SCREENS' },
  { dim: 'dpr', title: 'DEVICE PIXEL RATIO' },
  { dim: 'viewports', title: 'VIEWPORTS' },
  { dim: 'display', title: 'DISPLAY MODE' },
  { dim: 'languages', title: 'LANGUAGES // NAVIGATOR' },
  { dim: 'acceptLanguage', title: 'ACCEPT-LANGUAGE // FIRST TAG' },
  { dim: 'netEffective', title: 'NETWORK // EFFECTIVE TYPE' },
  { dim: 'netType', title: 'NETWORK // TYPE' },
  { dim: 'downlink', title: 'DOWNLINK // MBPS' },
  { dim: 'saveData', title: 'SAVE-DATA' },
  { dim: 'pdfViewer', title: 'PDF VIEWER' },
  { dim: 'acceptEncoding', title: 'ACCEPT-ENCODING' },
  { dim: 'protocol', title: 'HTTP PROTOCOL' },
  { dim: 'tls', title: 'TLS VERSION' },
  { dim: 'cipher', title: 'CIPHER' },
  { dim: 'colo', title: 'COLO // EDGE' },
]

function rowsOf(dim: TechDim): KN[] {
  const list = data.value?.[dim]
  return Array.isArray(list) ? list : []
}

const storageRows = computed<KN[]>(() => data.value?.storageQuota ?? [])
const voiceRows = computed<KN[]>(() => data.value?.voices ?? [])

const isEmpty = computed(() => Boolean(data.value) && (data.value?.sampled.total ?? 0) === 0)
</script>

<template>
  <div class="te">
    <FilterBar :show-compare="false" />

    <p v-if="error" class="te__fault">{{ opsFault(error, 'technology') }}</p>
    <p v-else-if="!data && status === 'pending'" class="te__poll label">... POLLING</p>

    <template v-if="data">
      <p class="te__note label">
        SAMPLE {{ fmt.num(data.sampled.n) }} / {{ fmt.num(data.sampled.total) }} NEWEST SESSIONS · TOP 12 + OTHER PER DIMENSION · NO FINGERPRINT HASHES ARE GROUPED
      </p>

      <p v-if="isEmpty" class="te__empty label">NO DATA // TECHNOLOGY</p>

      <div class="te__stats">
        <StatCard
          label="WEBDRIVER"
          :value="fmt.num(data.webdriver.n)"
          :sub="`${fmt.share(data.webdriver.n, data.webdriver.total)} OF ${fmt.num(data.webdriver.total)}`"
          :lamp="data.webdriver.n > 0 ? 'amber' : 'off'"
          :pulse="false"
          hint="navigator.webdriver === true"
          :to="filters.linkTo('/ops/sessions', { webdriver: '1' })"
        />
        <StatCard
          label="TZ OFFSET MISMATCH"
          :value="fmt.num(data.tzMismatch.n)"
          :sub="`${fmt.share(data.tzMismatch.n, data.tzMismatch.total)} OF ${fmt.num(data.tzMismatch.total)} WITH BOTH OFFSETS`"
          :lamp="data.tzMismatch.n > 0 ? 'amber' : 'off'"
          :pulse="false"
          hint="client UTC offset ≠ the offset of Cloudflare’s geo timezone — VPN / proxy hint"
        />
        <StatCard label="GPC" :value="fmt.num(data.gpc.n)" :sub="`${fmt.share(data.gpc.n, data.gpc.total)} OF ${fmt.num(data.gpc.total)}`" hint="Sec-GPC: 1" />
        <StatCard label="DNT" :value="fmt.num(data.dnt.n)" :sub="`${fmt.share(data.dnt.n, data.dnt.total)} OF ${fmt.num(data.dnt.total)}`" />
        <StatCard label="COOKIES OFF" :value="fmt.num(data.cookiesOff)" />
        <StatCard
          label="BATTERY"
          :value="data.battery.n > 0 ? fmt.pct(data.battery.avgLevel, 0) : '—'"
          :sub="data.battery.n > 0 ? `AVG LEVEL · ${fmt.pct(data.battery.chargingPct, 0)} CHARGING · N ${fmt.num(data.battery.n)}` : 'NO BATTERY API'"
        />
        <StatCard
          label="MEDIA DEVICES"
          :value="`${fmt.num(data.media.avgAudioIn, 1)} / ${fmt.num(data.media.avgVideoIn, 1)} / ${fmt.num(data.media.avgAudioOut, 1)}`"
          sub="AVG AUDIO IN / VIDEO IN / AUDIO OUT"
        />
        <StatCard
          label="JS HEAP"
          :value="`${fmt.num(data.memory.avgUsedMb)} / ${fmt.num(data.memory.avgLimitMb)} MB`"
          sub="AVG USED / LIMIT (CHROMIUM)"
        />
      </div>

      <div class="te__grid">
        <div v-for="p in PANELS" :key="p.dim" class="te__panel" data-testid="tech-panel">
          <Panel :title="p.title">
            <BarRows
              :rows="rowsOf(p.dim)"
              table-toggle
              fold-other
              :key-label="p.keyLabel ?? 'VALUE'"
              value-label="SESSIONS"
              :empty="`NO DATA // ${p.title}`"
            />
          </Panel>
        </div>
        <div class="te__panel" data-testid="tech-panel">
          <Panel title="STORAGE QUOTA // BUCKETS">
            <BarRows :rows="storageRows" table-toggle key-label="QUOTA" value-label="SESSIONS" empty="NO DATA // STORAGE" />
          </Panel>
        </div>
        <div class="te__panel" data-testid="tech-panel">
          <Panel title="SPEECH VOICES // COUNT">
            <BarRows :rows="voiceRows" table-toggle fold-other key-label="VOICES" value-label="SESSIONS" empty="NO DATA // VOICES" />
          </Panel>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.te {
  display: grid;
  gap: var(--space-4);
}

.te__poll {
  color: var(--text-faint);
}

.te__empty {
  color: var(--text-faint);
}

.te__note {
  color: var(--text-faint);
}

.te__fault {
  color: var(--red);
  font-size: var(--fs-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.te__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-2);
}

.te__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--space-4) var(--space-3);
  align-items: start;
}

.te__panel {
  min-width: 0;
}
</style>
