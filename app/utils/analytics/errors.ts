// Errors (contract §B.4, B1): capture-phase `error` (element targets become
// `resource_error`), `unhandledrejection`, and a `console.error` wrapper that
// calls the original first. Per-visit caps come from PAGE_CAPS (10 / 10 / 5).
import { selectorPath } from '~/utils/selectorPath'
import type { Core } from './core'
import { safe } from './core'
import type { Pages } from './pages'

/** Browser-extension URLs carry nothing analysable and can identify the visitor. */
function scrub(s: string): string {
  return s.replace(/\b(?:chrome|moz|safari-web|ms-browser)-extension:\/\/[^\s)'"]*/g, '<ext>')
}

function describe(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

export function setupErrors(core: Core, pages: Pages): void {
  const { track } = core

  addEventListener(
    'error',
    safe((ev: Event) => {
      const target = ev.target
      if (target instanceof Element) {
        const src =
          (target as HTMLImageElement).currentSrc ||
          target.getAttribute('src') ||
          target.getAttribute('href') ||
          ''
        track('resource_error', null, {
          tag: target.tagName.toLowerCase(),
          src: scrub(src).slice(0, 200),
          sel: selectorPath(target),
        })
        return
      }
      if (!(ev instanceof ErrorEvent) || typeof ev.message !== 'string') return
      const err: unknown = ev.error
      track('js_error', null, {
        msg: scrub(ev.message).slice(0, 300),
        src: scrub(String(ev.filename ?? '')).slice(0, 200),
        ...(typeof ev.lineno === 'number' && ev.lineno > 0 ? { line: ev.lineno } : {}),
        stack: scrub(err instanceof Error ? (err.stack ?? '') : '').slice(0, 1000),
      })
    }),
    true,
  )

  addEventListener(
    'unhandledrejection',
    safe((ev: PromiseRejectionEvent) => {
      const reason: unknown = ev.reason
      track('js_error', null, {
        msg: scrub(describe(reason)).slice(0, 300),
        src: 'unhandledrejection',
        stack: scrub(reason instanceof Error ? (reason.stack ?? '') : '').slice(0, 1000),
      })
    }),
  )

  try {
    const original = console.error
    const report = safe((args: unknown[]) => {
      pages.visit().consoleErrors++
      track('console_error', null, { msg: scrub(args.map(describe).join(' ')).slice(0, 300) })
    })
    console.error = function (this: unknown, ...args: unknown[]): void {
      original.apply(console, args)
      report(args)
    }
  } catch {
    /* ignore */
  }
}
