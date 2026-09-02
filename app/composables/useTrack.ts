import type { EventType } from '#shared/analytics/events'

export type TrackFn = (type: EventType, name?: string | null, p?: Record<string, unknown>) => void

const noop: TrackFn = () => {}

/**
 * Component-side entry into the analytics pipeline (contract B.7). Forwards to
 * `window.__rbTrack`, which `analytics.client.ts` installs on public pages;
 * a no-op on the server, on /ops, when opted out, or before the plugin ran.
 * Never throws — analytics must never break the page.
 */
export function useTrack(): TrackFn {
  if (import.meta.server) return noop
  return (type, name, p) => {
    try {
      window.__rbTrack?.(type, name ?? null, p)
    } catch {
      /* analytics must never break the page */
    }
  }
}
