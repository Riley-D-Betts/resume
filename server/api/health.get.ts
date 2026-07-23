export default defineEventHandler(() => {
  let dbOk = false
  try {
    getDb().prepare('SELECT 1').get()
    dbOk = true
  } catch {
    // db unreachable — still report the process as alive
  }
  return { ok: true, db: dbOk }
})
