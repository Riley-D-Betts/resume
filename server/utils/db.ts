import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import type { H3Event } from 'h3'

/** Bindings declared in wrangler.jsonc. */
export interface CfBindings {
  DB: D1Database
  REPLAYS: R2Bucket
}

/**
 * Cloudflare env for the current request. Present in production (Workers)
 * and in `nuxt dev` via nitro-cloudflare-dev; anywhere else this throws.
 */
export function getCfEnv(event: H3Event): CfBindings {
  const env = (event.context.cloudflare as { env?: CfBindings } | undefined)?.env
  if (!env?.DB) {
    throw new Error(
      'Cloudflare bindings unavailable. In dev, run `npm run db:migrate:local` once and use `npm run dev` (nitro-cloudflare-dev provides the bindings).',
    )
  }
  return env
}

/** The D1 analytics database for the current request. */
export function getDb(event: H3Event): D1Database {
  return getCfEnv(event).DB
}

/** The R2 bucket holding rrweb replay chunks. */
export function getReplayBucket(event: H3Event): R2Bucket {
  return getCfEnv(event).REPLAYS
}
