import type { H3Event } from 'h3'

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

/** Strip port / brackets / IPv4-mapped-IPv6 prefix from a raw address. */
function normalizeIp(raw: string): string {
  let ip = raw.trim()
  // bracketed IPv6, optionally with port: [::1]:1234
  const bracket = ip.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (bracket) {
    ip = bracket[1]!
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    // IPv4 with port
    ip = ip.slice(0, ip.lastIndexOf(':'))
  }
  // IPv4-mapped IPv6 (::ffff:1.2.3.4)
  if (ip.toLowerCase().startsWith('::ffff:')) {
    const mapped = ip.slice(7)
    if (IPV4_RE.test(mapped)) ip = mapped
  }
  return ip
}

/** Truncate an (possibly abbreviated) IPv6 address to its /48 prefix. */
function truncateIpv6(ip: string): string {
  const head = ip.split('%')[0]! // drop zone index
  const left = head.split('::')[0]
  const groups = left ? left.split(':').filter(g => g.length > 0) : []
  const first3 = [...groups, '0', '0', '0'].slice(0, 3)
  return `${first3.join(':')}::`
}

/**
 * Real client IP (un-anonymized) — use this for rate limiting and geo lookup.
 * When trustProxy is on, prefers x-real-ip, then the first x-forwarded-for
 * entry, then the socket address.
 */
export function getClientIp(event: H3Event): string {
  const cfg = useRuntimeConfig(event)
  if (cfg.trustProxy) {
    const real = getHeader(event, 'x-real-ip')
    if (real && real.trim()) return normalizeIp(real)
    const fwd = getHeader(event, 'x-forwarded-for')
    if (fwd) {
      const first = fwd.split(',')[0]!.trim()
      if (first) return normalizeIp(first)
    }
  }
  return normalizeIp(event.node.req.socket.remoteAddress ?? '')
}

/** Zero the last IPv4 octet / truncate IPv6 to /48. Pure — always anonymizes. */
export function anonymizeIp(ip: string): string {
  if (!ip) return ip
  if (IPV4_RE.test(ip)) {
    const parts = ip.split('.')
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`
  }
  if (ip.includes(':')) return truncateIpv6(ip)
  return ip
}

/** Client IP as it should be STORED — anonymized when runtimeConfig.ipAnonymize. */
export function getStorageIp(event: H3Event): string {
  const ip = getClientIp(event)
  return useRuntimeConfig(event).ipAnonymize ? anonymizeIp(ip) : ip
}
