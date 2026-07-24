import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { getPool } from '../src/db.js'

const COLLECTION = 'appConfig'
const DOC_ID = 'appCheck'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const db = getDb()
console.log(`${APPLY ? 'Apply' : 'Dry run'}: migrate-app-config-to-postgres`)

const doc = await db.collection(COLLECTION).doc(DOC_ID).get()
if (!doc.exists) {
  console.log(`Firestore ${COLLECTION}/${DOC_ID}: not found — nothing to migrate.`)
  process.exit(0)
}

const data = doc.data()
console.log(`Firestore ${COLLECTION}/${DOC_ID}:`, {
  hasDebugToken: Boolean(data.debugToken),
  updatedAt: data.updatedAt ?? null,
  updatedBy: data.updatedBy ?? null,
})

if (!APPLY) {
  console.log('\nDry run only — no Postgres writes made. Re-run with --apply to migrate.')
  process.exit(0)
}

const pool = getPool()
const { rows: existing } = await pool.query('SELECT count(*)::int AS count FROM app_config WHERE key = $1', [DOC_ID])
if (existing[0].count > 0 && !FORCE) {
  console.error(`\nRefusing to --apply: app_config already has a '${DOC_ID}' row. Pass --force to overwrite.`)
  process.exit(1)
}

const value = { debugToken: data.debugToken ?? null }
await pool.query(
  `INSERT INTO app_config (key, value, updated_at, updated_by)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3, updated_by = $4`,
  [DOC_ID, JSON.stringify(value), data.updatedAt ?? new Date().toISOString(), JSON.stringify(data.updatedBy ?? null)],
)

console.log(`\nMigrated ${COLLECTION}/${DOC_ID} into app_config.`)
await pool.end()
