import crypto from 'node:crypto'
import { getDb, getBucket } from './firebase.js'

const PROJECTIONS_COLLECTION = 'learnedProjections'
const CONFIG_COLLECTION = 'systemConfig'
const ACTIVE_PROJECTION_DOC_ID = 'learnedProjectionActive'

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v)]),
  )
}

export function learnedProjectionId(embeddingModel, preprocessingVersion, projectionVersion) {
  return crypto.createHash('sha1').update(`${embeddingModel}::${preprocessingVersion}::${projectionVersion}`).digest('hex')
}

// A full outputDim x inputDim matrix (e.g. 384x384 doubles) comfortably exceeds Firestore's ~1MiB
// per-document limit on its own, even flattened -- so the matrix itself lives in Cloud Storage (the
// same split this app already uses for photos: small structured data in Firestore, large blobs in
// Storage, via getBucket() in photos.js) as a private JSON object, and the Firestore doc only stores
// its object path plus small metadata. Never made public -- only the backend ever reads it.
function matrixObjectName(id) {
  return `learned-projections/${id}.json`
}

async function uploadMatrix(id, matrix) {
  const objectName = matrixObjectName(id)
  await getBucket().file(objectName).save(JSON.stringify(matrix), {
    metadata: { contentType: 'application/json' },
  })
  return objectName
}

async function downloadMatrix(objectName) {
  const [buffer] = await getBucket().file(objectName).download()
  return JSON.parse(buffer.toString('utf-8'))
}

export async function upsertLearnedProjection({
  embeddingModel,
  preprocessingVersion,
  projectionVersion,
  matrix,
  inputDim,
  outputDim,
  trainedAtPhotoCount,
  trainedAtCultivarCount,
  metrics,
}) {
  const db = getDb()
  const id = learnedProjectionId(embeddingModel, preprocessingVersion, projectionVersion)
  const matrixObjectPath = await uploadMatrix(id, matrix)
  await db.collection(PROJECTIONS_COLLECTION).doc(id).set(
    withoutUndefined({
      embeddingModel,
      preprocessingVersion,
      projectionVersion,
      matrixObjectPath,
      inputDim,
      outputDim,
      trainedAtPhotoCount,
      trainedAtCultivarCount,
      metrics,
      createdAt: new Date().toISOString(),
    }),
    { merge: false },
  )
  return id
}

// Reverts identifyPhotoDino() to unprojected (raw DINOv2) matching -- getActiveLearnedProjection()
// returns null once this pointer doc is gone, and identifyPhotoDino()'s `project` becomes a no-op
// identity function in that case, exactly matching pre-activation behavior.
export async function deactivateLearnedProjection() {
  const db = getDb()
  await db.collection(CONFIG_COLLECTION).doc(ACTIVE_PROJECTION_DOC_ID).delete()
}

export async function setActiveLearnedProjection({ embeddingModel, preprocessingVersion, projectionVersion }) {
  const db = getDb()
  await db.collection(CONFIG_COLLECTION).doc(ACTIVE_PROJECTION_DOC_ID).set(
    withoutUndefined({
      embeddingModel,
      preprocessingVersion,
      projectionVersion,
      activatedAt: new Date().toISOString(),
    }),
    { merge: false },
  )
}

// Fetched fresh on every call (no in-process caching), matching how listCultivarCentroids() is already
// read fresh on every identifyPhotoDino() call -- a single small doc read plus one Storage download is
// cheap, and this keeps activating a newly trained projection version take effect immediately with no
// cache to invalidate.
export async function getActiveLearnedProjection({ embeddingModel, preprocessingVersion }) {
  const db = getDb()
  const pointerDoc = await db.collection(CONFIG_COLLECTION).doc(ACTIVE_PROJECTION_DOC_ID).get()
  if (!pointerDoc.exists) return null

  const pointer = pointerDoc.data()
  if (pointer.embeddingModel !== embeddingModel || pointer.preprocessingVersion !== preprocessingVersion) return null

  const id = learnedProjectionId(embeddingModel, preprocessingVersion, pointer.projectionVersion)
  const projectionDoc = await db.collection(PROJECTIONS_COLLECTION).doc(id).get()
  if (!projectionDoc.exists) return null

  const data = projectionDoc.data()
  const matrix = await downloadMatrix(data.matrixObjectPath)
  return { id: projectionDoc.id, ...data, matrix }
}

function l2Normalize(vector) {
  let sumSquares = 0
  for (const value of vector) sumSquares += value * value
  const norm = Math.sqrt(sumSquares) || 1
  return vector.map((value) => value / norm)
}

// Pure matrix-vector multiply (matrix is outputDim rows x inputDim cols) + L2-normalize, so cosine
// similarity and centroid math downstream behave the same way they do for raw DINOv2 embeddings.
export function applyProjection(vector, matrix) {
  const projected = matrix.map((row) => row.reduce((sum, weight, i) => sum + weight * vector[i], 0))
  return l2Normalize(projected)
}

function photoDriftGrowthThreshold() {
  const configured = Number(process.env.LEARNED_PROJECTION_DRIFT_PHOTO_GROWTH)
  return Number.isFinite(configured) && configured > 0 ? configured : 0.25
}

function cultivarDriftGrowthThreshold() {
  const configured = Number(process.env.LEARNED_PROJECTION_DRIFT_CULTIVAR_GROWTH)
  return Number.isFinite(configured) && configured > 0 ? configured : 0.2
}

// Pure function, split out from the Firestore-touching getProjectionDriftStatus() so the threshold
// logic is unit-testable without mocking Firestore (matching this repo's existing test coverage, which
// only ever covers pure logic -- see users.test.js, httpHelpers.test.js, gardenAuth.test.js).
export function evaluateDrift({
  trainedAtPhotoCount,
  currentPhotoCount,
  trainedAtCultivarCount,
  currentCultivarCount,
  photoGrowthThreshold,
  cultivarGrowthThreshold,
}) {
  const photoGrowth = trainedAtPhotoCount > 0 ? (currentPhotoCount - trainedAtPhotoCount) / trainedAtPhotoCount : 0
  const cultivarGrowth = trainedAtCultivarCount > 0 ? (currentCultivarCount - trainedAtCultivarCount) / trainedAtCultivarCount : 0

  const photoDrifted = photoGrowth >= photoGrowthThreshold
  const cultivarDrifted = cultivarGrowth >= cultivarGrowthThreshold

  if (!photoDrifted && !cultivarDrifted) {
    return { retrainingRecommended: false, reason: null, photoGrowth, cultivarGrowth }
  }

  const reasons = []
  if (photoDrifted) reasons.push(`the reference photo collection has grown ${Math.round(photoGrowth * 100)}% since the active projection was trained`)
  if (cultivarDrifted) reasons.push(`the number of cultivars has grown ${Math.round(cultivarGrowth * 100)}% since then`)

  return {
    retrainingRecommended: true,
    reason: `Metric-learning projection may be out of date: ${reasons.join(' and ')}. Consider re-running the training pipeline.`,
    photoGrowth,
    cultivarGrowth,
  }
}

function normalizeCultivarKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

export async function getProjectionDriftStatus({ embeddingModel, preprocessingVersion }) {
  const activeProjection = await getActiveLearnedProjection({ embeddingModel, preprocessingVersion })
  if (!activeProjection) {
    return { hasActiveProjection: false, retrainingRecommended: false, reason: null }
  }

  const db = getDb()
  const snap = await db
    .collection('photoEmbeddings')
    .where('embeddingModel', '==', embeddingModel)
    .where('preprocessingVersion', '==', preprocessingVersion)
    .get()

  const currentPhotoCount = snap.size
  const currentCultivarCount = new Set(snap.docs.map((doc) => normalizeCultivarKey(doc.data().cultivarName))).size

  const drift = evaluateDrift({
    trainedAtPhotoCount: activeProjection.trainedAtPhotoCount ?? 0,
    currentPhotoCount,
    trainedAtCultivarCount: activeProjection.trainedAtCultivarCount ?? 0,
    currentCultivarCount,
    photoGrowthThreshold: photoDriftGrowthThreshold(),
    cultivarGrowthThreshold: cultivarDriftGrowthThreshold(),
  })

  return {
    hasActiveProjection: true,
    retrainingRecommended: drift.retrainingRecommended,
    reason: drift.reason,
    currentPhotoCount,
    trainedAtPhotoCount: activeProjection.trainedAtPhotoCount ?? 0,
    currentCultivarCount,
    trainedAtCultivarCount: activeProjection.trainedAtCultivarCount ?? 0,
  }
}
