import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import { migrate } from './migrate'

let db: Database | null = null

/** Absolute path of the runtime data directory (DB, replays, geo). */
export function getDataDir(): string {
  const cfg = useRuntimeConfig()
  return resolve(cfg.dataDir || './data')
}

/** Lazily-opened singleton SQLite handle (single-process deployment). */
export function getDb(): Database {
  if (!db) {
    const dir = getDataDir()
    mkdirSync(dir, { recursive: true })
    db = new BetterSqlite3(join(dir, 'analytics.db'))
    migrate(db)
  }
  return db
}
