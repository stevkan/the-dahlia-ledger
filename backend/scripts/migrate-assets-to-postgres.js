import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { getPool, withTransaction } from '../src/db.js'

const ASSETS_COLLECTION = 'assets'
const ASSET_FILES_COLLECTION = 'assetFiles'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const ASSET_WRITABLE_COLUMNS = ['owner_user_id', 'company_id', 'asset', 'category', 'quantity', 'total_cost', 'purchase_date', 'notes', 'linked_order_item_ids', 'invoice_number', 'invoice_total', 'created_at', 'updated_at']
const INSERT_ASSET_SQL = `INSERT INTO assets (id, ${ASSET_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${ASSET_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

const FILE_WRITABLE_COLUMNS = ['asset_id', 'original_file_name', 'stored_file_name', 'mime_type', 'file_size', 'file_url', 'source_type', 'created_at']
const INSERT_FILE_SQL = `INSERT INTO asset_files (id, ${FILE_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${FILE_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

function assetToParams(asset) {
  return [
    asset.ownerUserId ?? null,
    asset.companyId ?? null,
    asset.asset ?? null,
    asset.category ?? null,
    asset.quantity ?? null,
    asset.totalCost ?? null,
    asset.purchaseDate ?? null,
    asset.notes ?? null,
    JSON.stringify(asset.linkedOrderItemIds ?? []),
    asset.invoiceNumber ?? null,
    asset.invoiceTotal ?? null,
    asset.createdAt ?? null,
    asset.updatedAt ?? null,
  ]
}

function fileToParams(file) {
  return [
    file.assetId ?? null,
    file.originalFileName ?? null,
    file.storedFileName ?? null,
    file.mimeType ?? null,
    file.fileSize ?? null,
    file.fileUrl ?? null,
    file.sourceType ?? null,
    file.createdAt ?? null,
  ]
}

const db = getDb()
console.log(`${APPLY ? 'Apply' : 'Dry run'}: migrate-assets-to-postgres`)

const [assetsSnap, filesSnap] = await Promise.all([
  db.collection(ASSETS_COLLECTION).get(),
  db.collection(ASSET_FILES_COLLECTION).get(),
])

const assets = assetsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const files = filesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

console.log(`Firestore ${ASSETS_COLLECTION}: ${assets.length}`)
console.log(`Firestore ${ASSET_FILES_COLLECTION}: ${files.length}`)

if (!APPLY) {
  console.log('\nDry run only — no Postgres writes made. Re-run with --apply to migrate verbatim.')
  process.exit(0)
}

const pool = getPool()
const [{ rows: existingAssets }, { rows: existingFiles }] = await Promise.all([
  pool.query('SELECT count(*)::int AS count FROM assets'),
  pool.query('SELECT count(*)::int AS count FROM asset_files'),
])
const alreadyHasRows = existingAssets[0].count > 0 || existingFiles[0].count > 0
if (alreadyHasRows && !FORCE) {
  console.error(`\nRefusing to --apply: assets has ${existingAssets[0].count}, asset_files has ${existingFiles[0].count} row(s) already. Pass --force to insert anyway.`)
  process.exit(1)
}

await withTransaction(async (client) => {
  for (const asset of assets) {
    await client.query(INSERT_ASSET_SQL, [asset.id, ...assetToParams(asset)])
  }
  for (const file of files) {
    await client.query(INSERT_FILE_SQL, [file.id, ...fileToParams(file)])
  }
})

console.log(`\nInserted ${assets.length} rows into assets.`)
console.log(`Inserted ${files.length} rows into asset_files.`)
await pool.end()
