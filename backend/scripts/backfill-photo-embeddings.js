import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { listRecords } from '../src/records.js'
import { embedImage, EMBEDDING_MODEL_ID, warmEmbeddingModel } from '../src/embeddings.js'
import { photoEmbeddingId, embedColorText, upsertPhotoEmbedding, listAllPhotoEmbeddings } from '../src/photoEmbeddings.js'

const DRY_RUN = process.argv.includes('--dry-run')
const BATCH_LIMIT = 450

function livePhotoUrls(records) {
  const byUrl = new Map()
  for (const record of records) {
    const cultivarName = String(record.core?.cultivar || record.flowerName || '').trim()
    if (!cultivarName) continue

    const color = record.core?.color || null
    const form = record.core?.form || null
    const photos = [...(record.recordPhotos ?? []), ...(record.cultivarPhotos ?? [])]
    for (const photo of photos) {
      if (!photo?.imageUrl || byUrl.has(photo.imageUrl)) continue
      byUrl.set(photo.imageUrl, {
        gardenId: record.gardenId,
        cultivarName,
        thumbnailUrl: photo.thumbnailUrl || photo.imageUrl,
        color,
        form,
      })
    }
  }
  return byUrl
}

const records = await listRecords()
const live = livePhotoUrls(records)
const existing = await listAllPhotoEmbeddings()
const existingById = new Map(existing.map((doc) => [doc.id, doc]))

let candidates = 0
let embedded = 0
let metadataUpdated = 0
let failed = 0

if (!DRY_RUN) await warmEmbeddingModel()

for (const [imageUrl, { gardenId, cultivarName, thumbnailUrl, color, form }] of live) {
  const id = photoEmbeddingId(imageUrl)
  const existingDoc = existingById.get(id)

  if (existingDoc) {
    const colorChanged = (existingDoc.color ?? null) !== color
    const needsColorEmbedding = color && !Array.isArray(existingDoc.colorEmbedding)
    if (colorChanged || needsColorEmbedding || (existingDoc.form ?? null) !== form) {
      console.log(`${DRY_RUN ? '[dry-run] ' : ''}update metadata ${cultivarName}: ${imageUrl}`)
      if (!DRY_RUN) {
        const colorEmbedding = colorChanged || needsColorEmbedding ? await embedColorText(color) : (existingDoc.colorEmbedding ?? null)
        await getDb().collection('photoEmbeddings').doc(id).set({ color, form, colorEmbedding }, { merge: true })
      }
      metadataUpdated += 1
    }
    continue
  }

  candidates += 1
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}embed ${cultivarName}: ${imageUrl}`)
  if (DRY_RUN) continue

  try {
    const [embedding, colorEmbedding] = await Promise.all([
      embedImage({ url: thumbnailUrl }),
      embedColorText(color),
    ])
    await upsertPhotoEmbedding({ gardenId, cultivarName, imageUrl, thumbnailUrl, embedding, model: EMBEDDING_MODEL_ID, color, form, colorEmbedding })
    embedded += 1
  } catch (error) {
    failed += 1
    console.error(`Failed to embed ${imageUrl}:`, error instanceof Error ? error.message : error)
  }
}

const staleDocs = existing.filter((doc) => !live.has(doc.imageUrl))
let pruned = 0

if (staleDocs.length > 0) {
  const db = getDb()
  let batch = db.batch()
  let pendingWrites = 0

  for (const doc of staleDocs) {
    console.log(`${DRY_RUN ? '[dry-run] ' : ''}prune ${doc.cultivarName ?? 'unknown'}: ${doc.imageUrl}`)
    if (!DRY_RUN) {
      batch.delete(db.collection('photoEmbeddings').doc(doc.id))
      pendingWrites += 1
      if (pendingWrites >= BATCH_LIMIT) {
        await batch.commit()
        batch = db.batch()
        pendingWrites = 0
      }
    }
    pruned += 1
  }

  if (!DRY_RUN && pendingWrites > 0) await batch.commit()
}

console.log({ dryRun: DRY_RUN, liveUrls: live.size, candidates, embedded, metadataUpdated, pruned, failed })
