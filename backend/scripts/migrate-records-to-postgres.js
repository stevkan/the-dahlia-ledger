import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { getPool, withTransaction } from '../src/db.js'
import { INSERT_RECORD_SQL, recordToParams, toRecordSummary } from '../src/records.js'

const RECORDS_COLLECTION = 'dahliaRecords'
const SUMMARY_COLLECTION = 'dahliaRecordSummaries'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const SUMMARY_WRITABLE_COLUMNS = [
  'record_number', 'garden_id', 'flower_name', 'garden_location', 'season_year_start',
  'thumbnail_url', 'list_thumbnail_url', 'image_url', 'cultivar_thumbnail_url', 'cultivar_list_thumbnail_url', 'cultivar_image_url',
  'default_photo_scope', 'core', 'growth', 'tuber', 'meta',
]
const INSERT_SUMMARY_SQL = `INSERT INTO dahlia_record_summaries_snapshot (id, ${SUMMARY_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${SUMMARY_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

function summaryToParams(summary) {
  return [
    summary.recordNumber ?? null,
    summary.gardenId ?? null,
    summary.flowerName ?? null,
    summary.gardenLocation ?? null,
    summary.seasonYearStart ?? null,
    summary.thumbnailUrl ?? null,
    summary.listThumbnailUrl ?? null,
    summary.imageUrl ?? null,
    summary.cultivarThumbnailUrl ?? null,
    summary.cultivarListThumbnailUrl ?? null,
    summary.cultivarImageUrl ?? null,
    summary.defaultPhotoScope ?? null,
    JSON.stringify(summary.core ?? {}),
    JSON.stringify(summary.growth ?? {}),
    JSON.stringify(summary.tuber ?? {}),
    JSON.stringify(summary.meta ?? {}),
  ]
}

// Approximate, fast drift check for visibility only — the authoritative field-by-field diff used
// by the admin Data Audit UI is listRecordDrift() in src/records.js, run against Postgres later.
function countDrift(records, summariesById) {
  let drifted = 0
  for (const record of records) {
    const summary = summariesById.get(record.id)
    if (!summary) continue
    const recomputed = toRecordSummary(record)
    const fieldsMatch = ['flowerName', 'gardenLocation'].every((key) => (recomputed[key] ?? null) === (summary[key] ?? null))
      && (recomputed.core?.color ?? null) === (summary.core?.color ?? null)
      && (recomputed.core?.cultivar ?? null) === (summary.core?.cultivar ?? null)
      && (recomputed.meta?.plantingState ?? null) === (summary.meta?.plantingState ?? null)
    if (!fieldsMatch) drifted += 1
  }
  return drifted
}

const db = getDb()
console.log(`${APPLY ? 'Apply' : 'Dry run'}: migrate-records-to-postgres`)

const [recordsSnap, summariesSnap] = await Promise.all([
  db.collection(RECORDS_COLLECTION).get(),
  db.collection(SUMMARY_COLLECTION).get(),
])

const records = recordsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const summaries = summariesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const summariesById = new Map(summaries.map((summary) => [summary.id, summary]))

console.log(`Firestore dahliaRecords: ${records.length}`)
console.log(`Firestore dahliaRecordSummaries: ${summaries.length}`)
console.log(`Records with a drifted summary (recomputed vs. stored): ${countDrift(records, summariesById)}`)

if (!APPLY) {
  console.log('\nDry run only — no Postgres writes made. Re-run with --apply to migrate verbatim (no reconciliation).')
  process.exit(0)
}

const pool = getPool()
const { rows: existingRecordCount } = await pool.query('SELECT count(*)::int AS count FROM dahlia_records')
const { rows: existingSnapshotCount } = await pool.query('SELECT count(*)::int AS count FROM dahlia_record_summaries_snapshot')
if ((existingRecordCount[0].count > 0 || existingSnapshotCount[0].count > 0) && !FORCE) {
  console.error(`\nRefusing to --apply: dahlia_records has ${existingRecordCount[0].count} row(s) and dahlia_record_summaries_snapshot has ${existingSnapshotCount[0].count} row(s) already. Pass --force to insert anyway.`)
  process.exit(1)
}

await withTransaction(async (client) => {
  for (const record of records) {
    await client.query(INSERT_RECORD_SQL, [record.id, ...recordToParams(record)])
  }
  for (const summary of summaries) {
    await client.query(INSERT_SUMMARY_SQL, [summary.id, ...summaryToParams(summary)])
  }
})

console.log(`\nInserted ${records.length} rows into dahlia_records.`)
console.log(`Inserted ${summaries.length} rows into dahlia_record_summaries_snapshot.`)

const { rows: postgresRecords } = await pool.query('SELECT id, record_number AS "recordNumber", garden_id AS "gardenId", flower_name AS "flowerName", garden_location AS "gardenLocation", season_year_start AS "seasonYearStart", thumbnail_url AS "thumbnailUrl", list_thumbnail_url AS "listThumbnailUrl", image_url AS "imageUrl", cultivar_thumbnail_url AS "cultivarThumbnailUrl", cultivar_list_thumbnail_url AS "cultivarListThumbnailUrl", cultivar_image_url AS "cultivarImageUrl", record_photos AS "recordPhotos", cultivar_photos AS "cultivarPhotos", default_record_photo_id AS "defaultRecordPhotoId", default_cultivar_photo_id AS "defaultCultivarPhotoId", default_photo_scope AS "defaultPhotoScope", core, growth, care, tuber, health, meta FROM dahlia_records')
const { rows: postgresSummaries } = await pool.query('SELECT id, record_number AS "recordNumber", garden_id AS "gardenId", flower_name AS "flowerName", garden_location AS "gardenLocation", core, growth, tuber, meta FROM dahlia_record_summaries_snapshot')
const postgresSummariesById = new Map(postgresSummaries.map((summary) => [summary.id, summary]))
console.log(`Copy-fidelity check — drift count recomputed from Postgres: ${countDrift(postgresRecords, postgresSummariesById)} (should match the Firestore count above).`)

await pool.end()
