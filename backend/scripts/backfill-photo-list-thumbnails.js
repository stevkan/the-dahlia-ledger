import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { createListThumbnailForPhotoUrl } from '../src/photos.js'
import { listRecords } from '../src/records.js'

function needsListThumbnail(photo) {
  return photo?.imageUrl && !photo.listThumbnailUrl
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

async function listThumbnailUrlFor(imageUrl, cache) {
  if (cache.has(imageUrl)) return cache.get(imageUrl)
  const listThumbnailUrl = await createListThumbnailForPhotoUrl(imageUrl)
  cache.set(imageUrl, listThumbnailUrl)
  return listThumbnailUrl
}

async function backfillRecord(record, cache) {
  let changed = false
  const next = { ...record }

  if (next.imageUrl && !next.listThumbnailUrl) {
    next.listThumbnailUrl = await listThumbnailUrlFor(next.imageUrl, cache)
    changed = Boolean(next.listThumbnailUrl) || changed
  }

  if (next.cultivarImageUrl && !next.cultivarListThumbnailUrl) {
    next.cultivarListThumbnailUrl = await listThumbnailUrlFor(next.cultivarImageUrl, cache)
    changed = Boolean(next.cultivarListThumbnailUrl) || changed
  }

  next.recordPhotos = await Promise.all(
    (next.recordPhotos ?? []).map(async (photo) => {
      if (!needsListThumbnail(photo)) return photo
      const listThumbnailUrl = await listThumbnailUrlFor(photo.imageUrl, cache)
      if (!listThumbnailUrl) return photo
      changed = true
      return { ...photo, listThumbnailUrl }
    }),
  )

  next.cultivarPhotos = await Promise.all(
    (next.cultivarPhotos ?? []).map(async (photo) => {
      if (!needsListThumbnail(photo)) return photo
      const listThumbnailUrl = await listThumbnailUrlFor(photo.imageUrl, cache)
      if (!listThumbnailUrl) return photo
      changed = true
      return { ...photo, listThumbnailUrl }
    }),
  )

  if (!changed) return false

  const { id, ...data } = next
  await getDb().collection('dahliaRecords').doc(id).set(withoutUndefined(data), { merge: false })
  await getDb().collection('dahliaRecordSummaries').doc(id).set(
    withoutUndefined({ listThumbnailUrl: next.listThumbnailUrl, cultivarListThumbnailUrl: next.cultivarListThumbnailUrl }),
    { merge: true },
  )
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
    (record.imageUrl && !record.listThumbnailUrl) ||
    (record.cultivarImageUrl && !record.cultivarListThumbnailUrl) ||
    (record.recordPhotos ?? []).some(needsListThumbnail) ||
    (record.cultivarPhotos ?? []).some(needsListThumbnail)

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
