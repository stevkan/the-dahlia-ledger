import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { createThumbnailForPhotoUrl } from '../src/photos.js'
import { listRecords } from '../src/records.js'

function needsThumbnail(photo) {
  return photo?.imageUrl && (!photo.thumbnailUrl || photo.thumbnailUrl === photo.imageUrl)
}

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => [key, withoutUndefined(v)]),
  )
}

async function thumbnailUrlFor(imageUrl, cache) {
  if (cache.has(imageUrl)) return cache.get(imageUrl)
  const thumbnailUrl = await createThumbnailForPhotoUrl(imageUrl)
  cache.set(imageUrl, thumbnailUrl)
  return thumbnailUrl
}

async function backfillRecord(record, cache) {
  let changed = false
  const next = { ...record }

  if (next.imageUrl && (!next.thumbnailUrl || next.thumbnailUrl === next.imageUrl)) {
    next.thumbnailUrl = await thumbnailUrlFor(next.imageUrl, cache)
    changed = Boolean(next.thumbnailUrl) || changed
  }

  if (next.cultivarImageUrl && (!next.cultivarThumbnailUrl || next.cultivarThumbnailUrl === next.cultivarImageUrl)) {
    next.cultivarThumbnailUrl = await thumbnailUrlFor(next.cultivarImageUrl, cache)
    changed = Boolean(next.cultivarThumbnailUrl) || changed
  }

  next.recordPhotos = await Promise.all(
    (next.recordPhotos ?? []).map(async (photo) => {
      if (!needsThumbnail(photo)) return photo
      const thumbnailUrl = await thumbnailUrlFor(photo.imageUrl, cache)
      if (!thumbnailUrl) return photo
      changed = true
      return { ...photo, thumbnailUrl }
    }),
  )

  next.cultivarPhotos = await Promise.all(
    (next.cultivarPhotos ?? []).map(async (photo) => {
      if (!needsThumbnail(photo)) return photo
      const thumbnailUrl = await thumbnailUrlFor(photo.imageUrl, cache)
      if (!thumbnailUrl) return photo
      changed = true
      return { ...photo, thumbnailUrl }
    }),
  )

  if (!changed) return false

  const { id, ...data } = next
  await getDb().collection('dahliaRecords').doc(id).set(withoutUndefined(data), { merge: false })
  return true
}

const dryRun = process.argv.includes('--dry-run')
const records = await listRecords()
const cache = new Map()
let candidates = 0
let updated = 0
let wouldUpdate = 0
let failed = 0

for (const record of records) {
  const hasCandidate =
    (record.imageUrl && (!record.thumbnailUrl || record.thumbnailUrl === record.imageUrl)) ||
    (record.cultivarImageUrl && (!record.cultivarThumbnailUrl || record.cultivarThumbnailUrl === record.cultivarImageUrl)) ||
    (record.recordPhotos ?? []).some(needsThumbnail) ||
    (record.cultivarPhotos ?? []).some(needsThumbnail)

  if (!hasCandidate) continue
  candidates += 1
  if (dryRun) {
    wouldUpdate += 1
    continue
  }

  try {
    if (await backfillRecord(record, cache)) updated += 1
  } catch (error) {
    failed += 1
    console.error(`Failed to backfill ${record.id} (${record.flowerName}):`, error instanceof Error ? error.message : error)
  }
}

console.log({ dryRun, candidates, wouldUpdate, updated, failed, uniqueImagesProcessed: cache.size })
