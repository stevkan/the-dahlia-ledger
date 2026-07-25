import crypto from 'node:crypto'
import { query } from './db.js'
import { embedImage, embedTexts, EMBEDDING_MODEL_ID } from './embeddings.js'
import { embedImageDino, DINO_MODEL_ID } from './dino.js'
import { segmentFlower } from './segmentation.js'
import { extractColorFeatures } from './labColor.js'
import { PREPROCESSING_VERSION } from './preprocessingVersion.js'
import { recomputeCentroidForCultivar, cultivarCentroidId } from './cultivarCentroids.js'

function normalizeCultivarKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

// Frozen once the segmented-DINOv2 pipeline is validated in production; flip back to true only to
// re-run the legacy CLIP pipeline against a garden that hasn't been backfilled onto the new one yet.
export const LEGACY_CLIP_WRITES_ENABLED = false

const PHOTO_EMBEDDING_SELECT_COLUMNS = `
  id, garden_id AS "gardenId", cultivar_name AS "cultivarName", image_url AS "imageUrl", thumbnail_url AS "thumbnailUrl",
  embedding, model, embedding_model AS "embeddingModel", preprocessing_version AS "preprocessingVersion",
  segmentation_applied AS "segmentationApplied", color, form, color_embedding AS "colorEmbedding",
  color_features AS "colorFeatures", created_at AS "createdAt"
`

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
  await query(
    `INSERT INTO photo_embeddings (id, garden_id, cultivar_name, image_url, thumbnail_url, embedding, model, embedding_model, preprocessing_version, segmentation_applied, color, form, color_embedding, color_features, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (id) DO UPDATE SET
       garden_id = $2, cultivar_name = $3, image_url = $4, thumbnail_url = $5, embedding = $6, model = $7,
       embedding_model = $8, preprocessing_version = $9, segmentation_applied = $10, color = $11, form = $12,
       color_embedding = $13, color_features = $14, created_at = $15`,
    [
      id,
      gardenId ?? null,
      cultivarName ?? null,
      imageUrl ?? null,
      thumbnailUrl ?? null,
      JSON.stringify(embedding ?? []),
      model ?? embeddingModel ?? null,
      embeddingModel ?? model ?? null,
      preprocessingVersion ?? null,
      segmentationApplied ?? null,
      color ?? null,
      form ?? null,
      colorEmbedding ? JSON.stringify(colorEmbedding) : null,
      colorFeatures ? JSON.stringify(colorFeatures) : null,
      new Date().toISOString(),
    ],
  )
}

// Partial update matching Firestore's { merge: true } semantics — colorEmbedding is only touched
// when the caller explicitly passes it (legacy CLIP docs carry it; new-generation docs don't).
export async function updatePhotoEmbeddingMetadata(id, { color, form, colorEmbedding } = {}) {
  if (colorEmbedding !== undefined) {
    await query(
      'UPDATE photo_embeddings SET color = $2, form = $3, color_embedding = $4 WHERE id = $1',
      [id, color ?? null, form ?? null, colorEmbedding ? JSON.stringify(colorEmbedding) : null],
    )
  } else {
    await query('UPDATE photo_embeddings SET color = $2, form = $3 WHERE id = $1', [id, color ?? null, form ?? null])
  }
}

export async function deletePhotoEmbeddingsByIds(ids) {
  const unique = [...new Set(ids ?? [])]
  if (unique.length === 0) return
  await query('DELETE FROM photo_embeddings WHERE id = ANY($1::text[])', [unique])
}

export async function deletePhotoEmbeddings(imageUrls) {
  const urls = [...new Set((imageUrls ?? []).filter(Boolean))]
  if (urls.length === 0) return

  // Each photo may have both a legacy CLIP doc and a new-generation segmented-DINOv2 doc; deleting a
  // nonexistent id is a no-op.
  const ids = urls.flatMap((url) => [
    photoEmbeddingId(url),
    photoEmbeddingId(url, { embeddingModel: DINO_MODEL_ID, preprocessingVersion: PREPROCESSING_VERSION }),
  ])

  // Look up which (gardenId, cultivarName) pairs these deletions could affect before deleting, so any
  // cultivar left with zero remaining new-generation reference photos can have its now-orphaned
  // centroid pruned too -- the mirror image of the auto-recompute-on-create in ensureEmbeddingsForRecord.
  const { rows: docs } = await query(`SELECT ${PHOTO_EMBEDDING_SELECT_COLUMNS} FROM photo_embeddings WHERE id = ANY($1::text[])`, [ids])
  const affectedCultivars = new Map()
  for (const doc of docs) {
    if (doc.embeddingModel !== DINO_MODEL_ID || doc.preprocessingVersion !== PREPROCESSING_VERSION) continue
    if (!doc.gardenId || !doc.cultivarName) continue
    const key = `${doc.gardenId}::${normalizeCultivarKey(doc.cultivarName)}`
    affectedCultivars.set(key, { gardenId: doc.gardenId, cultivarName: doc.cultivarName })
  }

  await deletePhotoEmbeddingsByIds(ids)

  for (const { gardenId, cultivarName } of affectedCultivars.values()) {
    try {
      const remaining = await listPhotoEmbeddings(gardenId)
      const cultivarKey = normalizeCultivarKey(cultivarName)
      const stillHasReferences = remaining.some(
        (r) => r.embeddingModel === DINO_MODEL_ID && r.preprocessingVersion === PREPROCESSING_VERSION && normalizeCultivarKey(r.cultivarName) === cultivarKey,
      )
      if (!stillHasReferences) {
        const centroidId = cultivarCentroidId(gardenId, cultivarName, DINO_MODEL_ID, PREPROCESSING_VERSION)
        await query('DELETE FROM cultivar_centroids WHERE id = $1', [centroidId])
      }
    } catch (error) {
      console.error(`Failed to prune centroid for cultivar ${cultivarName}:`, error)
    }
  }
}

export async function listPhotoEmbeddings(gardenId) {
  const { rows } = await query(`SELECT ${PHOTO_EMBEDDING_SELECT_COLUMNS} FROM photo_embeddings WHERE garden_id = $1`, [gardenId])
  return rows
}

export async function listAllPhotoEmbeddings() {
  const { rows } = await query(`SELECT ${PHOTO_EMBEDDING_SELECT_COLUMNS} FROM photo_embeddings`)
  return rows
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

  let newEmbeddingCreated = false
  for (const [imageUrl, thumbnailUrl] of urls) {
    if (LEGACY_CLIP_WRITES_ENABLED) {
      const legacyId = photoEmbeddingId(imageUrl)
      const { rows: legacyRows } = await query(`SELECT ${PHOTO_EMBEDDING_SELECT_COLUMNS} FROM photo_embeddings WHERE id = $1`, [legacyId])
      const existingLegacy = legacyRows[0]

      if (existingLegacy) {
        const colorChanged = (existingLegacy.color ?? null) !== color
        if (colorChanged || (existingLegacy.form ?? null) !== form) {
          const colorEmbedding = colorChanged ? await embedColorText(color) : (existingLegacy.colorEmbedding ?? null)
          await updatePhotoEmbeddingMetadata(legacyId, { color, form, colorEmbedding })
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
    const { rows: newRows } = await query(`SELECT ${PHOTO_EMBEDDING_SELECT_COLUMNS} FROM photo_embeddings WHERE id = $1`, [newId])
    const existingNew = newRows[0]

    if (existingNew) {
      if ((existingNew.color ?? null) !== color || (existingNew.form ?? null) !== form) {
        await updatePhotoEmbeddingMetadata(newId, { color, form })
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
