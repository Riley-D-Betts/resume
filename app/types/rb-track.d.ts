// The single global declaration of the analytics bridge (audit A41 / contract
// B4). `app/plugins/analytics.client.ts` installs `window.__rbTrack`; page
// components reach it through `useTrack()` and `egg.client.ts` reports the
// easter eggs. `ns` is the Bettsuite easter-egg namespace (egg.client.ts).
// Nothing else may re-declare these members.
export {}

declare global {
  interface Window {
    __rbTrack?: (type: string, name?: string | null, p?: Record<string, unknown>) => void
    ns?: Record<string, unknown>
  }
}
