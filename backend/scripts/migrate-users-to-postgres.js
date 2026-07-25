import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { getPool, withTransaction } from '../src/db.js'

const COLLECTION = 'users'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const WRITABLE_COLUMNS = ['user_id', 'email', 'display_name', 'photo_url', 'provider', 'created_at', 'last_seen_at', 'updated_at']
const INSERT_SQL = `INSERT INTO users (id, ${WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

function userToParams(user) {
  return [
    user.userId ?? user.id ?? null,
    user.email ?? null,
    user.displayName ?? null,
    user.photoUrl ?? null,
    user.provider ?? null,
    user.createdAt ?? null,
    user.lastSeenAt ?? null,
    user.updatedAt ?? null,
  ]
}

const db = getDb()
console.log(`${APPLY ? 'Apply' : 'Dry run'}: migrate-users-to-postgres`)

const snap = await db.collection(COLLECTION).get()
const users = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
console.log(`Firestore ${COLLECTION}: ${users.length}`)

if (!APPLY) {
  console.log('\nDry run only — no Postgres writes made. Re-run with --apply to migrate verbatim.')
  process.exit(0)
}

const pool = getPool()
const { rows: existingCount } = await pool.query('SELECT count(*)::int AS count FROM users')
if (existingCount[0].count > 0 && !FORCE) {
  console.error(`\nRefusing to --apply: users already has ${existingCount[0].count} row(s). Pass --force to insert anyway.`)
  process.exit(1)
}

await withTransaction(async (client) => {
  for (const user of users) {
    await client.query(INSERT_SQL, [user.id, ...userToParams(user)])
  }
})

console.log(`\nInserted ${users.length} rows into users.`)
await pool.end()
