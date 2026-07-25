import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { getPool, withTransaction } from '../src/db.js'

const COLLECTION = 'maintenanceReminders'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const WRITABLE_COLUMNS = [
  'garden_id', 'title', 'notes', 'due_date', 'related_record_ids', 'source',
  'created_by_user_id', 'owner_user_id', 'assigned_to_user_id', 'visibility', 'priority',
  'completed_at', 'completed_by_user_id', 'created_at', 'updated_at',
]
const INSERT_SQL = `INSERT INTO maintenance_reminders (id, ${WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

function reminderToParams(reminder) {
  return [
    reminder.gardenId ?? null,
    reminder.title ?? null,
    reminder.notes ?? null,
    reminder.dueDate ?? null,
    JSON.stringify(reminder.relatedRecordIds ?? []),
    reminder.source ?? null,
    reminder.createdByUserId ?? null,
    reminder.ownerUserId ?? null,
    reminder.assignedToUserId ?? null,
    reminder.visibility ?? null,
    reminder.priority ?? null,
    reminder.completedAt ?? null,
    reminder.completedByUserId ?? null,
    reminder.createdAt ?? null,
    reminder.updatedAt ?? null,
  ]
}

const db = getDb()
console.log(`${APPLY ? 'Apply' : 'Dry run'}: migrate-reminders-to-postgres`)

const snap = await db.collection(COLLECTION).get()
const reminders = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
console.log(`Firestore ${COLLECTION}: ${reminders.length}`)

if (!APPLY) {
  console.log('\nDry run only — no Postgres writes made. Re-run with --apply to migrate verbatim.')
  process.exit(0)
}

const pool = getPool()
const { rows: existingCount } = await pool.query('SELECT count(*)::int AS count FROM maintenance_reminders')
if (existingCount[0].count > 0 && !FORCE) {
  console.error(`\nRefusing to --apply: maintenance_reminders already has ${existingCount[0].count} row(s). Pass --force to insert anyway.`)
  process.exit(1)
}

await withTransaction(async (client) => {
  for (const reminder of reminders) {
    await client.query(INSERT_SQL, [reminder.id, ...reminderToParams(reminder)])
  }
})

console.log(`\nInserted ${reminders.length} rows into maintenance_reminders.`)
await pool.end()
