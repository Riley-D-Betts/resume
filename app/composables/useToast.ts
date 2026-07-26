/**
 * Fire a Bettsuite-style confirmation toast from anywhere.
 * The <NsToaster> component (mounted once in the layout) listens for
 * the `ns:toast` window event and renders the banner.
 */
export interface ToastOptions {
  icon?: string
  timeout?: number
}

export function useToast() {
  return {
    show(message: string, opts: ToastOptions = {}): void {
      if (!import.meta.client) return
      window.dispatchEvent(
        new CustomEvent('ns:toast', { detail: { message, icon: opts.icon ?? '✓', timeout: opts.timeout ?? 4200 } }),
      )
    },
  }
}
