import crypto from 'node:crypto'
import { query } from './db.js'

const ACTIVE_PROJECTION_CONFIG_KEY = 'learnedProjectionActive'

const PROJECTION_SELECT_COLUMNS = `
  id, embedding_model AS "embeddingModel", preprocessing_version AS "preprocessingVersion",
  projection_version AS "projectionVersion", matrix, input_dim AS "inputDim", output_dim AS "outputDim",
  trained_at_photo_count AS "trainedAtPhotoCount", trained_at_cultivar_count AS "trainedAtCultivarCount",
  metrics, created_at AS "createdAt"
`

export function learnedProjectionId(embeddingModel, preprocessingVersion, projectionVersion) {
  return crypto.createHash('sha1').update(`${embeddingModel}::${preprocessingVersion}::${projectionVersion}`).digest('hex')
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
  const id = learnedProjectionId(embeddingModel, preprocessingVersion, projectionVersion)
  await query(
    `INSERT INTO learned_projections (id, embedding_model, preprocessing_version, projection_version, matrix, input_dim, output_dim, trained_at_photo_count, trained_at_cultivar_count, metrics, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       embedding_model = $2, preprocessing_version = $3, projection_version = $4, matrix = $5, input_dim = $6,
       output_dim = $7, trained_at_photo_count = $8, trained_at_cultivar_count = $9, metrics = $10, created_at = $11`,
    [
      id,
      embeddingModel,
      preprocessingVersion,
      projectionVersion,
      JSON.stringify(matrix ?? []),
      inputDim ?? null,
      outputDim ?? null,
      trainedAtPhotoCount ?? null,
      trainedAtCultivarCount ?? null,
      metrics ? JSON.stringify(metrics) : null,
      new Date().toISOString(),
    ],
  )
  return id
}

// Reverts identifyPhotoDino() to unprojected (raw DINOv2) matching -- getActiveLearnedProjection()
// returns null once this pointer is gone, and identifyPhotoDino()'s `project` becomes a no-op
// identity function in that case, exactly matching pre-activation behavior.
export async function deactivateLearnedProjection() {
  await query('DELETE FROM app_config WHERE key = $1', [ACTIVE_PROJECTION_CONFIG_KEY])
}

export async function setActiveLearnedProjection({ embeddingModel, preprocessingVersion, projectionVersion }) {
  const value = { embeddingModel, preprocessingVersion, projectionVersion, activatedAt: new Date().toISOString() }
  await query(
    `INSERT INTO app_config (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [ACTIVE_PROJECTION_CONFIG_KEY, JSON.stringify(value)],
  )
}

// Fetched fresh on every call (no in-process caching), matching how listCultivarCentroids() is already
// read fresh on every identifyPhotoDino() call -- a single small row read is cheap, and this keeps
// activating a newly trained projection version take effect immediately with no cache to invalidate.
export async function getActiveLearnedProjection({ embeddingModel, preprocessingVersion }) {
  const { rows } = await query('SELECT value FROM app_config WHERE key = $1', [ACTIVE_PROJECTION_CONFIG_KEY])
  const pointer = rows[0]?.value
  if (!pointer) return null
  if (pointer.embeddingModel !== embeddingModel || pointer.preprocessingVersion !== preprocessingVersion) return null

  const id = learnedProjectionId(embeddingModel, preprocessingVersion, pointer.projectionVersion)
  const { rows: projectionRows } = await query(`SELECT ${PROJECTION_SELECT_COLUMNS} FROM learned_projections WHERE id = $1`, [id])
  return projectionRows[0] ?? null
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

// Pure function, split out from the Postgres-touching getProjectionDriftStatus() so the threshold
// logic is unit-testable without touching the database (matching this repo's existing test coverage --
// see users.test.js, httpHelpers.test.js, gardenAuth.test.js).
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

  const { rows } = await query(
    'SELECT cultivar_name AS "cultivarName" FROM photo_embeddings WHERE embedding_model = $1 AND preprocessing_version = $2',
    [embeddingModel, preprocessingVersion],
  )

  const currentPhotoCount = rows.length
  const currentCultivarCount = new Set(rows.map((row) => normalizeCultivarKey(row.cultivarName))).size

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
