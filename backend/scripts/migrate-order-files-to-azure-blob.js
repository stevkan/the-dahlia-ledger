import '../src/env.js'
import { getBucket } from '../src/firebase.js'
import { getPool } from '../src/db.js'
import { uploadPublicBlob, getContainerClient } from '../src/blobStorage.js'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const FILE_CACHE_CONTROL = 'private, max-age=3600'

function firebaseObjectName(orderId, storedFileName) {
  return `order-invoices/${orderId}/${storedFileName}`
}

const containerUrl = getContainerClient().url
function isAlreadyMigrated(fileUrl) {
  return Boolean(fileUrl) && fileUrl.startsWith(containerUrl)
}

console.log(`${APPLY ? 'Apply' : 'Dry run'}: migrate-order-files-to-azure-blob`)

const pool = getPool()
const { rows: files } = await pool.query(`
  SELECT id, order_id AS "orderId", stored_file_name AS "storedFileName", mime_type AS "mimeType", file_url AS "fileUrl"
  FROM order_files
`)

let migratedCount = 0
let bytesTransferred = 0
const failed = []
const skipped = []

for (const file of files) {
  if (!FORCE && isAlreadyMigrated(file.fileUrl)) {
    skipped.push(file.id)
    continue
  }

  const objectName = firebaseObjectName(file.orderId, file.storedFileName)
  try {
    const [buffer] = await getBucket().file(objectName).download()

    if (APPLY) {
      const url = await uploadPublicBlob(objectName, buffer, file.mimeType || 'application/pdf', FILE_CACHE_CONTROL)
      await pool.query('UPDATE order_files SET file_url = $1 WHERE id = $2', [url, file.id])
    }
    bytesTransferred += buffer.length
    migratedCount += 1
  } catch (error) {
    failed.push({ id: file.id, objectName, message: error?.message })
  }
}

console.log(`Order files found: ${files.length}`)
console.log(`Already on Azure Blob (skipped): ${skipped.length}`)
console.log(`${APPLY ? 'Migrated' : 'Would migrate'}: ${migratedCount}`)
if (APPLY) console.log(`Bytes transferred: ${bytesTransferred}`)
if (failed.length > 0) {
  console.log(`\nFailed to migrate ${failed.length} file(s) (left as Firebase URLs, re-run to retry):`)
  for (const f of failed) console.log(`  ${f.id} (${f.objectName}): ${f.message}`)
}
if (!APPLY) console.log('\nDry run only — no blobs copied, no Postgres writes made. Re-run with --apply to migrate.')

await pool.end()
