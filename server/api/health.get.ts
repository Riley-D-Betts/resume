export default defineEventHandler(async (event) => {
  let dbOk = false
  try {
    await getDb(event).prepare('SELECT 1').first()
    dbOk = true
  } catch {
    // db unreachable — still report the worker as alive
  }
  return { ok: true, db: dbOk }
})
