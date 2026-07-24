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
    try {
      mkdirSync(dir, { recursive: true })
      db = new BetterSqlite3(join(dir, 'analytics.db'))
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'SQLITE_CANTOPEN' || code === 'EACCES' || code === 'EPERM') {
        throw new Error(
          `data dir ${dir} is not writable by uid ${process.getuid?.() ?? '?'}. ` +
            `In Docker the app runs as the 'node' user (uid 1000) — before first ` +
            `start run: mkdir -p ./data && sudo chown -R 1000:1000 ./data`,
          { cause: err },
        )
      }
      throw err
    }
    migrate(db)
  }
  return db
}
