import crypto from 'node:crypto'
import { getDb } from './firebase.js'
import { kmeans, normalizedAverage } from './kmeans.js'

const COLLECTION = 'cultivarCentroids'

// Below this, clustering into multiple "appearance" centroids isn't meaningful -- fall back to a
// single normalizedAverage centroid. This is a batch-recompute knob (how the script behaves), not a
// live-tunable scoring weight, so it's a plain constant rather than following the PHOTO_MATCH_* env
// var pattern used for identifyPhoto()'s scoring formula.
export const MIN_PHOTOS_FOR_CLUSTERING = 6
const MAX_CENTROIDS_PER_CULTIVAR = 4

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v)]),
  )
}

function normalizeCultivarKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function cultivarCentroidId(gardenId, cultivarName, embeddingModel, preprocessingVersion) {
  const cultivarKey = normalizeCultivarKey(cultivarName)
  return crypto.createHash('sha1').update(`${gardenId}::${cultivarKey}::${embeddingModel}::${preprocessingVersion}`).digest('hex')
}

function meanLab(pixels) {
  const valid = pixels.filter(Boolean)
  if (valid.length === 0) return null
  const sum = valid.reduce((acc, p) => ({ l: acc.l + p.l, a: acc.a + p.a, b: acc.b + p.b }), { l: 0, a: 0, b: 0 })
  return { l: sum.l / valid.length, a: sum.a / valid.length, b: sum.b / valid.length }
}

// Color centroids are a simple weighted average of each reference photo's own already-clustered
// dominant colors, centerLab/outerLab/chromaMean -- deliberately not re-clustered with k-means, since
// color already carries its own per-photo dominant-color clustering and multi-modal "appearance"
// centroids are really an embedding-space concept (bloom stage, angle, lighting).
function aggregateColorCentroid(colorFeaturesList) {
  const valid = colorFeaturesList.filter(Boolean)
  if (valid.length === 0) return null

  const dominantColors = valid.flatMap((c) => c.dominantColors ?? [])
  const chromaMean = valid.reduce((sum, c) => sum + (c.chromaMean ?? 0), 0) / valid.length

  return {
    dominantColors,
    centerLab: meanLab(valid.map((c) => c.centerLab)),
    outerLab: meanLab(valid.map((c) => c.outerLab)),
    chromaMean,
  }
}

/**
 * Groups reference photo-embedding docs by (gardenId, cultivarName) and computes one or more
 * "appearance" centroids per cultivar via k-means on the embedding vectors, falling back to a single
 * normalizedAverage centroid when there aren't enough photos to cluster meaningfully.
 */
export function computeCultivarCentroids(referenceEmbeddings) {
  const byCultivar = new Map()
  for (const reference of referenceEmbeddings) {
    // A centroid with no gardenId could never be looked up by identifyPhoto() (which always scopes by
    // a real resolved gardenId), and Firestore's `where('gardenId', '==', ...)` rejects `undefined`.
    if (!Array.isArray(reference.embedding) || !reference.cultivarName || !reference.gardenId) continue
    const key = `${reference.gardenId}::${normalizeCultivarKey(reference.cultivarName)}`
    const bucket = byCultivar.get(key) ?? { gardenId: reference.gardenId, cultivarName: reference.cultivarName, references: [] }
    bucket.references.push(reference)
    byCultivar.set(key, bucket)
  }

  const results = []
  for (const { gardenId, cultivarName, references } of byCultivar.values()) {
    const vectors = references.map((r) => r.embedding)
    const photoCount = vectors.length

    let centroids
    let clusteringApplied
    if (photoCount < MIN_PHOTOS_FOR_CLUSTERING) {
      centroids = [{ vector: normalizedAverage(vectors), weight: 1, photoCount }]
      clusteringApplied = false
    } else {
      const k = Math.min(MAX_CENTROIDS_PER_CULTIVAR, Math.max(1, Math.round(Math.sqrt(photoCount / 2))))
      const { centroids: rawCentroids, assignments } = kmeans(vectors, k)
      const counts = new Array(k).fill(0)
      for (const assignment of assignments) counts[assignment] += 1
      centroids = rawCentroids.map((vector, i) => ({ vector, weight: counts[i] / photoCount, photoCount: counts[i] }))
      clusteringApplied = true
    }

    results.push({
      gardenId,
      cultivarName,
      centroids,
      colorCentroid: aggregateColorCentroid(references.map((r) => r.colorFeatures)),
      clusteringApplied,
      sourcePhotoCount: photoCount,
    })
  }

  return results
}

export async function upsertCultivarCentroids(centroidDocs, { embeddingModel, preprocessingVersion }) {
  const db = getDb()
  await Promise.all(
    centroidDocs.map((doc) => {
      const id = cultivarCentroidId(doc.gardenId, doc.cultivarName, embeddingModel, preprocessingVersion)
      return db.collection(COLLECTION).doc(id).set(
        withoutUndefined({
          gardenId: doc.gardenId,
          cultivarName: doc.cultivarName,
          embeddingModel,
          preprocessingVersion,
          centroids: doc.centroids,
          colorCentroid: doc.colorCentroid,
          clusteringApplied: doc.clusteringApplied,
          sourcePhotoCount: doc.sourcePhotoCount,
          computedAt: new Date().toISOString(),
        }),
        { merge: false },
      )
    }),
  )
}

/**
 * Recomputes and upserts the centroid for a single cultivar, using only that cultivar's current
 * reference embeddings (already filtered to one embeddingModel/preprocessingVersion generation by the
 * caller). Cheap enough to run inline whenever a new reference photo is embedded, so centroids never
 * go stale waiting on someone to remember to run the batch `recompute-cultivar-centroids.js` script --
 * unlike that script, this never prunes (a single cultivar's recompute has no visibility into whether
 * other cultivars have gone stale/removed, so pruning stays a periodic full-collection concern).
 */
export async function recomputeCentroidForCultivar(cultivarReferenceEmbeddings, { embeddingModel, preprocessingVersion }) {
  const centroidDocs = computeCultivarCentroids(cultivarReferenceEmbeddings)
  if (centroidDocs.length === 0) return
  await upsertCultivarCentroids(centroidDocs, { embeddingModel, preprocessingVersion })
}

export async function listCultivarCentroids(gardenId, embeddingModel, preprocessingVersion) {
  const snap = await getDb()
    .collection(COLLECTION)
    .where('gardenId', '==', gardenId)
    .where('embeddingModel', '==', embeddingModel)
    .where('preprocessingVersion', '==', preprocessingVersion)
    .get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

export async function pruneStaleCultivarCentroids(liveCentroidDocs, { embeddingModel, preprocessingVersion }) {
  const db = getDb()
  const liveIds = new Set(
    liveCentroidDocs.map((doc) => cultivarCentroidId(doc.gardenId, doc.cultivarName, embeddingModel, preprocessingVersion)),
  )

  // Scan the whole embeddingModel+preprocessingVersion generation directly rather than grouping by the
  // *current* live gardenIds -- a stale doc from a reference whose gardenId was missing/invalid (e.g. a
  // legacy record with no gardenId) has no gardenId field at all, so a per-gardenId `where` query can
  // never find it to prune it.
  const snap = await db
    .collection(COLLECTION)
    .where('embeddingModel', '==', embeddingModel)
    .where('preprocessingVersion', '==', preprocessingVersion)
    .get()

  let pruned = 0
  for (const doc of snap.docs) {
    if (!liveIds.has(doc.id)) {
      await db.collection(COLLECTION).doc(doc.id).delete()
      pruned += 1
    }
  }
  return pruned
}
