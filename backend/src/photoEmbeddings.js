import crypto from 'node:crypto'
import { getDb } from './firebase.js'
import { embedImage, embedTexts, EMBEDDING_MODEL_ID } from './embeddings.js'
import { embedImageDino, DINO_MODEL_ID } from './dino.js'
import { segmentFlower } from './segmentation.js'
import { extractColorFeatures } from './labColor.js'
import { PREPROCESSING_VERSION } from './preprocessingVersion.js'
import { recomputeCentroidForCultivar, cultivarCentroidId } from './cultivarCentroids.js'

const CENTROIDS_COLLECTION = 'cultivarCentroids'

function normalizeCultivarKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

const COLLECTION = 'photoEmbeddings'

// Frozen once the segmented-DINOv2 pipeline is validated in production; flip back to true only to
// re-run the legacy CLIP pipeline against a garden that hasn't been backfilled onto the new one yet.
export const LEGACY_CLIP_WRITES_ENABLED = false

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v)]),
  )
}

// Called with no second argument, reproduces the original legacy SHA1-of-URL id exactly (backward
// compatible with every existing photoEmbeddings doc). Passing embeddingModel/preprocessingVersion
// scopes the id to that specific model+preprocessing generation, so a legacy CLIP doc and a new
// segmented-DINOv2 doc for the same photo coexist as separate docs instead of overwriting each other.
export function photoEmbeddingId(imageUrl, { embeddingModel, preprocessingVersion } = {}) {
  if (!embeddingModel && !preprocessingVersion) {
    return crypto.createHash('sha1').update(imageUrl).digest('hex')
  }
  return crypto.createHash('sha1').update(`${imageUrl}::${embeddingModel}::${preprocessingVersion}`).digest('hex')
}

export async function embedColorText(color) {
  if (!color) return null
  const [embedding] = await embedTexts([`a photo of a ${color} dahlia flower`])
  return embedding
}

export async function computeColorFeatures(segmentationResult) {
  if (!segmentationResult?.applied) return null
  const small = await segmentationResult.image
    .toSharp()
    .resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return extractColorFeatures(small.data, { width: small.info.width, height: small.info.height })
}

export async function upsertPhotoEmbedding({
  gardenId,
  cultivarName,
  imageUrl,
  thumbnailUrl,
  embedding,
  model,
  embeddingModel,
  preprocessingVersion,
  segmentationApplied,
  color,
  form,
  colorEmbedding,
  colorFeatures,
}) {
  const id = photoEmbeddingId(imageUrl, { embeddingModel, preprocessingVersion })
  await getDb().collection(COLLECTION).doc(id).set(
    withoutUndefined({
      gardenId,
      cultivarName,
      imageUrl,
      thumbnailUrl,
      embedding,
      model: model ?? embeddingModel,
      embeddingModel: embeddingModel ?? model,
      preprocessingVersion: preprocessingVersion ?? null,
      segmentationApplied: segmentationApplied ?? null,
      color: color ?? null,
      form: form ?? null,
      colorEmbedding: colorEmbedding ?? null,
      colorFeatures: colorFeatures ?? null,
      createdAt: new Date().toISOString(),
    }),
    { merge: false },
  )
}

export async function deletePhotoEmbeddings(imageUrls) {
  const urls = [...new Set((imageUrls ?? []).filter(Boolean))]
  if (urls.length === 0) return

  const db = getDb()
  // Each photo may have both a legacy CLIP doc and a new-generation segmented-DINOv2 doc; delete
  // whichever exist (Firestore deletes of nonexistent doc ids are no-ops).
  const ids = urls.flatMap((url) => [
    photoEmbeddingId(url),
    photoEmbeddingId(url, { embeddingModel: DINO_MODEL_ID, preprocessingVersion: PREPROCESSING_VERSION }),
  ])

  // Look up which (gardenId, cultivarName) pairs these deletions could affect before deleting, so any
  // cultivar left with zero remaining new-generation reference photos can have its now-orphaned
  // centroid pruned too -- the mirror image of the auto-recompute-on-create in ensureEmbeddingsForRecord.
  const docs = await Promise.all(ids.map((id) => db.collection(COLLECTION).doc(id).get()))
  const affectedCultivars = new Map()
  for (const doc of docs) {
    if (!doc.exists) continue
    const data = doc.data()
    if (data.embeddingModel !== DINO_MODEL_ID || data.preprocessingVersion !== PREPROCESSING_VERSION) continue
    if (!data.gardenId || !data.cultivarName) continue
    const key = `${data.gardenId}::${normalizeCultivarKey(data.cultivarName)}`
    affectedCultivars.set(key, { gardenId: data.gardenId, cultivarName: data.cultivarName })
  }

  await Promise.all(ids.map((id) => db.collection(COLLECTION).doc(id).delete()))

  for (const { gardenId, cultivarName } of affectedCultivars.values()) {
    try {
      const remaining = await listPhotoEmbeddings(gardenId)
      const cultivarKey = normalizeCultivarKey(cultivarName)
      const stillHasReferences = remaining.some(
        (r) => r.embeddingModel === DINO_MODEL_ID && r.preprocessingVersion === PREPROCESSING_VERSION && normalizeCultivarKey(r.cultivarName) === cultivarKey,
      )
      if (!stillHasReferences) {
        const centroidId = cultivarCentroidId(gardenId, cultivarName, DINO_MODEL_ID, PREPROCESSING_VERSION)
        await db.collection(CENTROIDS_COLLECTION).doc(centroidId).delete()
      }
    } catch (error) {
      console.error(`Failed to prune centroid for cultivar ${cultivarName}:`, error)
    }
  }
}

export async function listPhotoEmbeddings(gardenId) {
  const snap = await getDb().collection(COLLECTION).where('gardenId', '==', gardenId).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

export async function listAllPhotoEmbeddings() {
  const snap = await getDb().collection(COLLECTION).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

function recordPhotoUrls(record) {
  const photos = [...(record.recordPhotos ?? []), ...(record.cultivarPhotos ?? [])]
  const seen = new Map()
  for (const photo of photos) {
    if (!photo?.imageUrl || seen.has(photo.imageUrl)) continue
    seen.set(photo.imageUrl, photo.thumbnailUrl || photo.imageUrl)
  }
  return seen
}

export async function ensureEmbeddingsForRecord(record) {
  if (!record) return

  const urls = recordPhotoUrls(record)
  if (urls.size === 0) return

  const cultivarName = String(record.core?.cultivar || record.flowerName || '').trim()
  if (!cultivarName) return

  const color = record.core?.color || null
  const form = record.core?.form || null

  const db = getDb()
  let newEmbeddingCreated = false
  for (const [imageUrl, thumbnailUrl] of urls) {
    if (LEGACY_CLIP_WRITES_ENABLED) {
      const legacyId = photoEmbeddingId(imageUrl)
      const existingLegacyDoc = await db.collection(COLLECTION).doc(legacyId).get()

      if (existingLegacyDoc.exists) {
        const existing = existingLegacyDoc.data()
        const colorChanged = (existing.color ?? null) !== color
        if (colorChanged || (existing.form ?? null) !== form) {
          const colorEmbedding = colorChanged ? await embedColorText(color) : (existing.colorEmbedding ?? null)
          await db.collection(COLLECTION).doc(legacyId).set({ color, form, colorEmbedding }, { merge: true })
        }
      } else {
        const [embedding, colorEmbedding] = await Promise.all([
          embedImage({ url: thumbnailUrl }),
          embedColorText(color),
        ])
        await upsertPhotoEmbedding({
          gardenId: record.gardenId,
          cultivarName,
          imageUrl,
          thumbnailUrl,
          embedding,
          model: EMBEDDING_MODEL_ID,
          color,
          form,
          colorEmbedding,
        })
      }
    }

    // New-generation (segmented + DINOv2 + Lab color) doc -- always computed going forward, from the
    // full original photo (not the thumbnail) for better mask/embedding quality.
    const newId = photoEmbeddingId(imageUrl, { embeddingModel: DINO_MODEL_ID, preprocessingVersion: PREPROCESSING_VERSION })
    const existingNewDoc = await db.collection(COLLECTION).doc(newId).get()

    if (existingNewDoc.exists) {
      const existing = existingNewDoc.data()
      if ((existing.color ?? null) !== color || (existing.form ?? null) !== form) {
        await db.collection(COLLECTION).doc(newId).set({ color, form }, { merge: true })
      }
      continue
    }

    try {
      const seg = await segmentFlower({ url: imageUrl })
      const [embedding, colorFeatures] = await Promise.all([
        embedImageDino({ image: seg.image }),
        computeColorFeatures(seg),
      ])
      await upsertPhotoEmbedding({
        gardenId: record.gardenId,
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
      newEmbeddingCreated = true
    } catch (error) {
      console.error(`Failed to compute new-generation photo embedding for ${imageUrl}:`, error)
    }
  }

  // Keep this cultivar's centroid in sync immediately rather than waiting on someone to remember to
  // run the batch recompute-cultivar-centroids.js script -- cheap since it only touches one cultivar's
  // references, not the whole collection (pruning stale/removed cultivars stays a periodic full-scan
  // concern handled by the batch script).
  if (newEmbeddingCreated) {
    try {
      const gardenReferences = await listPhotoEmbeddings(record.gardenId)
      const cultivarKey = normalizeCultivarKey(cultivarName)
      const cultivarReferences = gardenReferences.filter(
        (r) => r.embeddingModel === DINO_MODEL_ID && r.preprocessingVersion === PREPROCESSING_VERSION && normalizeCultivarKey(r.cultivarName) === cultivarKey,
      )
      await recomputeCentroidForCultivar(cultivarReferences, { embeddingModel: DINO_MODEL_ID, preprocessingVersion: PREPROCESSING_VERSION })
    } catch (error) {
      console.error(`Failed to recompute centroid for cultivar ${cultivarName}:`, error)
    }
  }
}
