import type { Schema, SchemaColumn, SchemaTable } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { opsCached } from '../../utils/opsCache'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, toNum, toStr } from '../../utils/opsDb'

const SCHEMA_TTL_MS = 5 * 60_000
const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/

/**
 * GET /api/ops/schema — the console's schema browser: every user table with
 * its columns (PRAGMA table_info), indexes (sqlite_master) and an `≈` row
 * estimate (MAX(rowid), never COUNT(*)). d1_migrations and _cf_* are
 * hidden. Cached 5 minutes.
 */
export default defineEventHandler(async (event): Promise<Schema> => {
  await requireAdmin(event)
  return opsCached(event, SCHEMA_TTL_MS, async () => {
    const db = getDb(event)
    const { results: master } = await db
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' "
          + "AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND tbl_name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name <> 'd1_migrations' AND tbl_name <> 'd1_migrations' ORDER BY name",
      )
      .all<{ type: string; name: string; tbl_name: string; sql: string | null }>()
    const tables = master.filter((r) => r.type === 'table' && NAME_RE.test(r.name)).map((r) => r.name)
    const indexes = master.filter((r) => r.type === 'index')

    const res = await batchAll<Row>(db, [
      ...tables.map((t) => bindStmt(db, `PRAGMA table_info("${t}")`)),
      ...tables.map((t) => bindStmt(db, `SELECT COALESCE(MAX(rowid), 0) AS n FROM "${t}"`)),
    ])
    const out: SchemaTable[] = tables.map((name, i) => {
      const cols = (res[i] ?? []).map(
        (c): SchemaColumn => ({ name: String(c.name), type: toStr(c.type) ?? '', notnull: toNum(c.notnull) === 1, pk: toNum(c.pk) > 0 }),
      )
      return {
        name,
        rowsApprox: toNum(res[tables.length + i]?.[0]?.n),
        columns: cols,
        indexes: indexes.filter((x) => x.tbl_name === name).map((x) => ({ name: x.name, sql: x.sql ?? null })),
      }
    })
    return { tables: out }
  })
})
