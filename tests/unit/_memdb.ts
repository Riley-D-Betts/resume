// Shared helper for the WP4 unit tests: an in-memory SQLite migrated
// every numbered migration in order, with foreign keys on (the engine under
// D1). The statement
// splitter is copied from migrations.test.ts (importing a test file would
// register its tests twice). Not a test file itself (no `.test.ts`).
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ''
  let state: 'code' | 'string' | 'line' | 'block' = 'code'
  const push = (): void => {
    const s = buf.trim()
    if (s.length > 0) out.push(s)
    buf = ''
  }
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i] as string
    const next = sql[i + 1]
    if (state === 'code') {
      if (ch === '-' && next === '-') {
        state = 'line'
        i++
      } else if (ch === '/' && next === '*') {
        state = 'block'
        i++
      } else if (ch === "'") {
        state = 'string'
        buf += ch
      } else if (ch === ';') {
        push()
      } else {
        buf += ch
      }
    } else if (state === 'string') {
      buf += ch
      if (ch === "'") {
        if (next === "'") {
          buf += next
          i++
        } else {
          state = 'code'
        }
      }
    } else if (state === 'line') {
      if (ch === '\n') {
        state = 'code'
        buf += '\n'
      }
    } else if (ch === '*' && next === '/') {
      state = 'code'
      i++
    }
  }
  if (state !== 'code') throw new Error('unterminated string literal or comment')
  push()
  return out
}

/** Fresh `:memory:` database with every migration applied and PRAGMA foreign_keys = ON. */
export function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
  for (const f of files) {
    for (const s of splitStatements(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))) db.exec(s)
  }
  return db
}

/** Insert a visitor + session pair (FK order) with sensible defaults; returns the sid. */
export function seedSession(
  db: DatabaseSync,
  sid: string,
  opts: { vid?: string; startedAt?: number; device?: string; isBot?: number; browser?: string; asOrg?: string | null } = {},
): string {
  const vid = opts.vid ?? `v-${sid}`
  const startedAt = opts.startedAt ?? 1_700_000_000_000
  db.prepare('INSERT OR IGNORE INTO visitors (vid, first_seen_at, last_seen_at) VALUES (?, ?, ?)').run(vid, startedAt, startedAt)
  db.prepare(
    'INSERT INTO sessions (sid, vid, started_at, last_seen_at, device_type, browser, is_bot, as_org, pageviews) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
  ).run(sid, vid, startedAt, startedAt + 1000, opts.device ?? 'desktop', opts.browser ?? 'Chrome', opts.isBot ?? 0, opts.asOrg ?? null)
  return sid
}
