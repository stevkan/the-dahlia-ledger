import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { getPool, withTransaction } from '../src/db.js'

const COLLECTION = 'companies'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const WRITABLE_COLUMNS = ['garden_id', 'owner_user_id', 'name', 'website', 'email', 'phone', 'notes', 'created_at', 'updated_at']
const INSERT_SQL = `INSERT INTO companies (id, ${WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

function companyToParams(company) {
  return [
    company.gardenId ?? null,
    company.ownerUserId ?? null,
    company.name ?? null,
    company.website ?? null,
    company.email ?? null,
    company.phone ?? null,
    company.notes ?? null,
    company.createdAt ?? null,
    company.updatedAt ?? null,
  ]
}

const db = getDb()
console.log(`${APPLY ? 'Apply' : 'Dry run'}: migrate-companies-to-postgres`)

const snap = await db.collection(COLLECTION).get()
const companies = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
console.log(`Firestore ${COLLECTION}: ${companies.length}`)

if (!APPLY) {
  console.log('\nDry run only — no Postgres writes made. Re-run with --apply to migrate verbatim.')
  process.exit(0)
}

const pool = getPool()
const { rows: existingCount } = await pool.query('SELECT count(*)::int AS count FROM companies')
if (existingCount[0].count > 0 && !FORCE) {
  console.error(`\nRefusing to --apply: companies already has ${existingCount[0].count} row(s). Pass --force to insert anyway.`)
  process.exit(1)
}

await withTransaction(async (client) => {
  for (const company of companies) {
    await client.query(INSERT_SQL, [company.id, ...companyToParams(company)])
  }
})

console.log(`\nInserted ${companies.length} rows into companies.`)
await pool.end()
