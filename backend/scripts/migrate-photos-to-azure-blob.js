import crypto from 'node:crypto'
import '../src/env.js'
import { getBucket } from '../src/firebase.js'
import { getPool } from '../src/db.js'
import { withPhotoDefaults } from '../src/records.js'
import { uploadPublicBlob } from '../src/blobStorage.js'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const PHOTO_CACHE_CONTROL = 'public, max-age=31536000, immutable'

// The reverse-URL-parsing hack this migration exists to retire — kept here, one last time,
// because after this script runs no photo needs it again (blob paths are stored explicitly).
function firebaseObjectName(publicUrl) {
  if (!publicUrl) return undefined
  try {
    const url = new URL(publicUrl)
    const bucketName = getBucket().name
    let objectPath = ''
    if (url.pathname.includes('/o/')) {
      objectPath = url.pathname.split('/o/')[1] ?? ''
    } else {
      objectPath = url.pathname.replace(/^\/+/, '')
      if (objectPath.startsWith(`${bucketName}/`)) objectPath = objectPath.slice(bucketName.length + 1)
    }
    objectPath = decodeURIComponent(objectPath.split('?')[0] ?? '')
    return objectPath || undefined
  } catch {
    return undefined
  }
}

function newBlobPath(firebaseObjectPath) {
  return firebaseObjectPath.replace(/^dahlia-photos\//, '')
}

function contentTypeFor(blobPath) {
  return blobPath.endsWith('.webp') ? 'image/webp' : 'application/octet-stream'
}

const migratedBuffers = new Map() // firebaseObjectName -> { url, blobPath } (dedupe re-uploads within this run)
let bytesTransferred = 0
let blobsCopied = 0
const failed = []

async function migratePhotoUrl(imageUrl) {
  if (!imageUrl) return undefined
  const objectName = firebaseObjectName(imageUrl)
  if (!objectName) return undefined

  const cached = migratedBuffers.get(objectName)
  if (cached) return cached

  try {
    const [buffer] = await getBucket().file(objectName).download()
    const blobPath = newBlobPath(objectName)
    let url = imageUrl
    if (APPLY) {
      url = await uploadPublicBlob(blobPath, buffer, contentTypeFor(blobPath), PHOTO_CACHE_CONTROL)
      bytesTransferred += buffer.length
      blobsCopied += 1
    }
    const result = { url, blobPath }
    migratedBuffers.set(objectName, result)
    return result
  } catch (error) {
    failed.push({ objectName, message: error?.message })
    return undefined
  }
}

async function migratePhoto(photo) {
  if (!photo || photo.imageBlobPath) return photo // already migrated

  const image = await migratePhotoUrl(photo.imageUrl)
  const thumbnail = photo.thumbnailUrl === photo.imageUrl ? image : await migratePhotoUrl(photo.thumbnailUrl)
  const listThumbnail = photo.listThumbnailUrl === photo.thumbnailUrl ? thumbnail : await migratePhotoUrl(photo.listThumbnailUrl)

  return {
    ...photo,
    imageUrl: image?.url ?? photo.imageUrl,
    thumbnailUrl: thumbnail?.url ?? photo.thumbnailUrl,
    listThumbnailUrl: listThumbnail?.url ?? photo.listThumbnailUrl,
    imageBlobPath: image?.blobPath,
    thumbnailBlobPath: thumbnail?.blobPath,
    listThumbnailBlobPath: listThumbnail?.blobPath,
  }
}

// Older import paths (OneNote import, attach-2026-season-images, etc.) set only the top-level
// imageUrl/thumbnailUrl fields directly and never created a recordPhotos/cultivarPhotos gallery
// entry. withPhotoDefaults() only derives the top-level fields FROM the gallery array, so a
// record like this has no array entry for migratePhoto() to touch — give it one now instead of
// leaving it (or worse, nulling it — see below) unmigrated.
function synthesizeLegacyPhotoEntry(imageUrl, thumbnailUrl, listThumbnailUrl, scope) {
  if (!imageUrl) return undefined
  return {
    id: `${scope}-legacy-${crypto.randomUUID()}`,
    imageUrl,
    thumbnailUrl: thumbnailUrl || imageUrl,
    listThumbnailUrl: listThumbnailUrl || thumbnailUrl || imageUrl,
    scope,
    createdAt: new Date().toISOString(),
  }
}

console.log(`${APPLY ? 'Apply' : 'Dry run'}: migrate-photos-to-azure-blob`)

const pool = getPool()
// Must select every field withPhotoDefaults() can fall back to (thumbnail_url, image_url, etc.) —
// omitting them previously meant a record with an empty recordPhotos array had those top-level
// fields silently nulled out on write, since withPhotoDefaults()'s fallback read `undefined`.
const { rows: records } = await pool.query(`
  SELECT id, record_photos AS "recordPhotos", cultivar_photos AS "cultivarPhotos",
    default_record_photo_id AS "defaultRecordPhotoId", default_cultivar_photo_id AS "defaultCultivarPhotoId",
    default_photo_scope AS "defaultPhotoScope",
    thumbnail_url AS "thumbnailUrl", list_thumbnail_url AS "listThumbnailUrl", image_url AS "imageUrl",
    cultivar_thumbnail_url AS "cultivarThumbnailUrl", cultivar_list_thumbnail_url AS "cultivarListThumbnailUrl",
    cultivar_image_url AS "cultivarImageUrl"
  FROM dahlia_records
`)

let recordsWithWork = 0
for (const record of records) {
  let recordPhotos = record.recordPhotos ?? []
  let cultivarPhotos = record.cultivarPhotos ?? []

  if (recordPhotos.length === 0 && record.imageUrl) {
    const synthesized = synthesizeLegacyPhotoEntry(record.imageUrl, record.thumbnailUrl, record.listThumbnailUrl, 'record')
    if (synthesized) recordPhotos = [synthesized]
  }
  if (cultivarPhotos.length === 0 && record.cultivarImageUrl) {
    const synthesized = synthesizeLegacyPhotoEntry(record.cultivarImageUrl, record.cultivarThumbnailUrl, record.cultivarListThumbnailUrl, 'cultivar')
    if (synthesized) cultivarPhotos = [synthesized]
  }

  const hasUnmigrated = (photos) => photos.some((photo) => !photo.imageBlobPath)
  if (!FORCE && !hasUnmigrated(recordPhotos) && !hasUnmigrated(cultivarPhotos)) continue
  recordsWithWork += 1

  const nextRecordPhotos = await Promise.all(recordPhotos.map(migratePhoto))
  const nextCultivarPhotos = await Promise.all(cultivarPhotos.map(migratePhoto))
  const withDefaults = withPhotoDefaults({
    ...record,
    recordPhotos: nextRecordPhotos,
    cultivarPhotos: nextCultivarPhotos,
  })

  if (APPLY) {
    await pool.query(
      `UPDATE dahlia_records SET record_photos = $2, cultivar_photos = $3,
        default_record_photo_id = $4, default_cultivar_photo_id = $5, default_photo_scope = $6,
        thumbnail_url = $7, list_thumbnail_url = $8, image_url = $9,
        cultivar_thumbnail_url = $10, cultivar_list_thumbnail_url = $11, cultivar_image_url = $12
       WHERE id = $1`,
      [
        record.id,
        JSON.stringify(nextRecordPhotos),
        JSON.stringify(nextCultivarPhotos),
        withDefaults.defaultRecordPhotoId ?? null,
        withDefaults.defaultCultivarPhotoId ?? null,
        withDefaults.defaultPhotoScope ?? null,
        withDefaults.thumbnailUrl ?? null,
        withDefaults.listThumbnailUrl ?? null,
        withDefaults.imageUrl ?? null,
        withDefaults.cultivarThumbnailUrl ?? null,
        withDefaults.cultivarListThumbnailUrl ?? null,
        withDefaults.cultivarImageUrl ?? null,
      ],
    )
  }
}

console.log(`Records with photos to migrate: ${recordsWithWork} of ${records.length}`)
console.log(`Blobs ${APPLY ? 'copied' : 'that would be copied'}: ${blobsCopied || migratedBuffers.size}`)
if (APPLY) console.log(`Bytes transferred: ${bytesTransferred}`)
if (failed.length > 0) {
  console.log(`\nFailed to migrate ${failed.length} blob(s) (left as Firebase URLs, re-run to retry):`)
  for (const f of failed) console.log(`  ${f.objectName}: ${f.message}`)
}
if (!APPLY) console.log('\nDry run only — no blobs copied, no Postgres writes made. Re-run with --apply to migrate.')

await pool.end()
