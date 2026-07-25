import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { listRecords } from '../src/records.js'
import { embedImage, EMBEDDING_MODEL_ID, warmEmbeddingModel } from '../src/embeddings.js'
import { embedImageDino, DINO_MODEL_ID, warmDinoModel } from '../src/dino.js'
import { segmentFlower, warmSegmentationModel } from '../src/segmentation.js'
import { PREPROCESSING_VERSION } from '../src/preprocessingVersion.js'
import {
  photoEmbeddingId,
  embedColorText,
  upsertPhotoEmbedding,
  listAllPhotoEmbeddings,
  computeColorFeatures,
  LEGACY_CLIP_WRITES_ENABLED,
} from '../src/photoEmbeddings.js'

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

let candidatesLegacy = 0
let embeddedLegacy = 0
let metadataUpdatedLegacy = 0
let failedLegacy = 0

let candidatesNew = 0
let embeddedNew = 0
let metadataUpdatedNew = 0
let failedNew = 0

if (!DRY_RUN) await Promise.all([warmEmbeddingModel(), warmSegmentationModel(), warmDinoModel()])

for (const [imageUrl, { gardenId, cultivarName, thumbnailUrl, color, form }] of live) {
  // -- Legacy CLIP generation (frozen once the new pipeline is validated -- see LEGACY_CLIP_WRITES_ENABLED) --
  if (LEGACY_CLIP_WRITES_ENABLED) {
    const legacyId = photoEmbeddingId(imageUrl)
    const existingLegacyDoc = existingById.get(legacyId)

    try {
      if (existingLegacyDoc) {
        const colorChanged = (existingLegacyDoc.color ?? null) !== color
        const needsColorEmbedding = color && !Array.isArray(existingLegacyDoc.colorEmbedding)
        if (colorChanged || needsColorEmbedding || (existingLegacyDoc.form ?? null) !== form) {
          console.log(`${DRY_RUN ? '[dry-run] ' : ''}update legacy metadata ${cultivarName}: ${imageUrl}`)
          if (!DRY_RUN) {
            const colorEmbedding = colorChanged || needsColorEmbedding ? await embedColorText(color) : (existingLegacyDoc.colorEmbedding ?? null)
            await getDb().collection('photoEmbeddings').doc(legacyId).set({ color, form, colorEmbedding }, { merge: true })
          }
          metadataUpdatedLegacy += 1
        }
      } else {
        candidatesLegacy += 1
        console.log(`${DRY_RUN ? '[dry-run] ' : ''}embed (legacy) ${cultivarName}: ${imageUrl}`)
        if (!DRY_RUN) {
          const [embedding, colorEmbedding] = await Promise.all([
            embedImage({ url: thumbnailUrl }),
            embedColorText(color),
          ])
          await upsertPhotoEmbedding({ gardenId, cultivarName, imageUrl, thumbnailUrl, embedding, model: EMBEDDING_MODEL_ID, color, form, colorEmbedding })
          embeddedLegacy += 1
        }
      }
    } catch (error) {
      failedLegacy += 1
      console.error(`Failed to embed (legacy) ${imageUrl}:`, error instanceof Error ? error.message : error)
    }
  }

  // -- New generation: segmented + DINOv2 + Lab color --
  const newId = photoEmbeddingId(imageUrl, { embeddingModel: DINO_MODEL_ID, preprocessingVersion: PREPROCESSING_VERSION })
  const existingNewDoc = existingById.get(newId)

  try {
    if (existingNewDoc) {
      if ((existingNewDoc.color ?? null) !== color || (existingNewDoc.form ?? null) !== form) {
        console.log(`${DRY_RUN ? '[dry-run] ' : ''}update new-generation metadata ${cultivarName}: ${imageUrl}`)
        if (!DRY_RUN) {
          await getDb().collection('photoEmbeddings').doc(newId).set({ color, form }, { merge: true })
        }
        metadataUpdatedNew += 1
      }
    } else {
      candidatesNew += 1
      console.log(`${DRY_RUN ? '[dry-run] ' : ''}embed (new-generation) ${cultivarName}: ${imageUrl}`)
      if (!DRY_RUN) {
        // Full original photo, not the thumbnail -- better mask quality, and matches the live query path.
        const seg = await segmentFlower({ url: imageUrl })
        const [embedding, colorFeatures] = await Promise.all([
          embedImageDino({ image: seg.image }),
          computeColorFeatures(seg),
        ])
        await upsertPhotoEmbedding({
          gardenId,
          cultivarName,
          imageUrl,
          thumbnailUrl,
          embedding,
          embeddingModel: DINO_MODEL_ID,
          preprocessingVersion: PREPROCESSING_VERSION,
          segmentationApplied: seg.applied,
          color,
          form,
          colorFeatures,
        })
        embeddedNew += 1
      }
    }
  } catch (error) {
    failedNew += 1
    console.error(`Failed to embed (new-generation) ${imageUrl}:`, error instanceof Error ? error.message : error)
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

console.log({
  dryRun: DRY_RUN,
  liveUrls: live.size,
  legacyWritesEnabled: LEGACY_CLIP_WRITES_ENABLED,
  candidatesLegacy,
  embeddedLegacy,
  metadataUpdatedLegacy,
  failedLegacy,
  candidatesNew,
  embeddedNew,
  metadataUpdatedNew,
  failedNew,
  pruned,
})
