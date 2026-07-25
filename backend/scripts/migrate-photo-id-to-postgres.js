import '../src/env.js'
import { getDb, getBucket } from '../src/firebase.js'
import { getPool } from '../src/db.js'

const PHOTO_EMBEDDINGS_COLLECTION = 'photoEmbeddings'
const CENTROIDS_COLLECTION = 'cultivarCentroids'
const PROJECTIONS_COLLECTION = 'learnedProjections'
const CONFIG_COLLECTION = 'systemConfig'
const ACTIVE_PROJECTION_DOC_ID = 'learnedProjectionActive'
const ACTIVE_PROJECTION_CONFIG_KEY = 'learnedProjectionActive'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const EMBEDDING_WRITABLE_COLUMNS = ['garden_id', 'cultivar_name', 'image_url', 'thumbnail_url', 'embedding', 'model', 'embedding_model', 'preprocessing_version', 'segmentation_applied', 'color', 'form', 'color_embedding', 'color_features', 'created_at']
const INSERT_EMBEDDING_SQL = `INSERT INTO photo_embeddings (id, ${EMBEDDING_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${EMBEDDING_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

const CENTROID_WRITABLE_COLUMNS = ['garden_id', 'cultivar_name', 'embedding_model', 'preprocessing_version', 'centroids', 'color_centroid', 'clustering_applied', 'source_photo_count', 'computed_at']
const INSERT_CENTROID_SQL = `INSERT INTO cultivar_centroids (id, ${CENTROID_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${CENTROID_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

const PROJECTION_WRITABLE_COLUMNS = ['embedding_model', 'preprocessing_version', 'projection_version', 'matrix', 'input_dim', 'output_dim', 'trained_at_photo_count', 'trained_at_cultivar_count', 'metrics', 'created_at']
const INSERT_PROJECTION_SQL = `INSERT INTO learned_projections (id, ${PROJECTION_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${PROJECTION_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

function embeddingToParams(doc) {
  return [
    doc.gardenId ?? null,
    doc.cultivarName ?? null,
    doc.imageUrl ?? null,
    doc.thumbnailUrl ?? null,
    JSON.stringify(doc.embedding ?? []),
    doc.model ?? null,
    doc.embeddingModel ?? null,
    doc.preprocessingVersion ?? null,
    doc.segmentationApplied ?? null,
    doc.color ?? null,
    doc.form ?? null,
    doc.colorEmbedding ? JSON.stringify(doc.colorEmbedding) : null,
    doc.colorFeatures ? JSON.stringify(doc.colorFeatures) : null,
    doc.createdAt ?? null,
  ]
}

function centroidToParams(doc) {
  return [
    doc.gardenId ?? null,
    doc.cultivarName ?? null,
    doc.embeddingModel ?? null,
    doc.preprocessingVersion ?? null,
    JSON.stringify(doc.centroids ?? []),
    doc.colorCentroid ? JSON.stringify(doc.colorCentroid) : null,
    doc.clusteringApplied ?? null,
    doc.sourcePhotoCount ?? null,
    doc.computedAt ?? null,
  ]
}

function projectionToParams(doc, matrix) {
  return [
    doc.embeddingModel ?? null,
    doc.preprocessingVersion ?? null,
    doc.projectionVersion ?? null,
    JSON.stringify(matrix ?? []),
    doc.inputDim ?? null,
    doc.outputDim ?? null,
    doc.trainedAtPhotoCount ?? null,
    doc.trainedAtCultivarCount ?? null,
    doc.metrics ? JSON.stringify(doc.metrics) : null,
    doc.createdAt ?? null,
  ]
}

const db = getDb()
console.log(`${APPLY ? 'Apply' : 'Dry run'}: migrate-photo-id-to-postgres`)

const [embeddingsSnap, centroidsSnap, projectionsSnap, configDoc] = await Promise.all([
  db.collection(PHOTO_EMBEDDINGS_COLLECTION).get(),
  db.collection(CENTROIDS_COLLECTION).get(),
  db.collection(PROJECTIONS_COLLECTION).get(),
  db.collection(CONFIG_COLLECTION).doc(ACTIVE_PROJECTION_DOC_ID).get(),
])

const embeddings = embeddingsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const centroids = centroidsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const projections = projectionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const activePointer = configDoc.exists ? configDoc.data() : null

console.log(`Firestore ${PHOTO_EMBEDDINGS_COLLECTION}: ${embeddings.length}`)
console.log(`Firestore ${CENTROIDS_COLLECTION}: ${centroids.length}`)
console.log(`Firestore ${PROJECTIONS_COLLECTION}: ${projections.length}`)
console.log(`Firestore ${CONFIG_COLLECTION}/${ACTIVE_PROJECTION_DOC_ID}: ${activePointer ? 'present' : 'not set'}`)

// Each projection's matrix lives in Firebase Storage (too large for a Firestore doc); download it
// now so it can be embedded directly as a JSONB column instead.
const projectionMatrices = new Map()
for (const projection of projections) {
  if (!projection.matrixObjectPath) continue
  console.log(`Downloading matrix blob: ${projection.matrixObjectPath}`)
  const [buffer] = await getBucket().file(projection.matrixObjectPath).download()
  projectionMatrices.set(projection.id, JSON.parse(buffer.toString('utf-8')))
}

if (!APPLY) {
  console.log('\nDry run only — no Postgres writes made. Re-run with --apply to migrate verbatim.')
  process.exit(0)
}

const pool = getPool()
const [{ rows: existingEmbeddings }, { rows: existingCentroids }, { rows: existingProjections }] = await Promise.all([
  pool.query('SELECT count(*)::int AS count FROM photo_embeddings'),
  pool.query('SELECT count(*)::int AS count FROM cultivar_centroids'),
  pool.query('SELECT count(*)::int AS count FROM learned_projections'),
])
const alreadyHasRows = existingEmbeddings[0].count > 0 || existingCentroids[0].count > 0 || existingProjections[0].count > 0
if (alreadyHasRows && !FORCE) {
  console.error(`\nRefusing to --apply: photo_embeddings has ${existingEmbeddings[0].count}, cultivar_centroids has ${existingCentroids[0].count}, learned_projections has ${existingProjections[0].count} row(s) already. Pass --force to insert anyway.`)
  process.exit(1)
}

// photo_embeddings alone is ~1,400 rows with 384-dim vectors -- one round trip per row (as earlier
// migrations in this series did) is nearly 1,800 sequential round trips in a single long-lived
// transaction, which reliably tripped a TLS connection reset against Azure Postgres. Batched
// multi-row INSERTs cut that to a handful of round trips; ON CONFLICT DO NOTHING makes each batch
// (and the whole script) safely re-runnable after a partial failure.
async function bulkInsert(table, columns, rows, toParams, batchSize = 200) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const valueGroups = []
    const params = []
    for (const row of batch) {
      const rowParams = [row.id, ...toParams(row)]
      valueGroups.push(`(${rowParams.map((_, j) => `$${params.length + j + 1}`).join(', ')})`)
      params.push(...rowParams)
    }
    await pool.query(
      `INSERT INTO ${table} (id, ${columns.join(', ')}) VALUES ${valueGroups.join(', ')} ON CONFLICT (id) DO NOTHING`,
      params,
    )
  }
}

await bulkInsert('photo_embeddings', EMBEDDING_WRITABLE_COLUMNS, embeddings, embeddingToParams)
await bulkInsert('cultivar_centroids', CENTROID_WRITABLE_COLUMNS, centroids, centroidToParams)
await bulkInsert('learned_projections', PROJECTION_WRITABLE_COLUMNS, projections, (doc) => projectionToParams(doc, projectionMatrices.get(doc.id)))

if (activePointer) {
  const value = {
    embeddingModel: activePointer.embeddingModel ?? null,
    preprocessingVersion: activePointer.preprocessingVersion ?? null,
    projectionVersion: activePointer.projectionVersion ?? null,
    activatedAt: activePointer.activatedAt ?? null,
  }
  await pool.query(
    `INSERT INTO app_config (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [ACTIVE_PROJECTION_CONFIG_KEY, JSON.stringify(value)],
  )
}

console.log(`\nInserted (or already present) ${embeddings.length} rows into photo_embeddings.`)
console.log(`Inserted (or already present) ${centroids.length} rows into cultivar_centroids.`)
console.log(`Inserted (or already present) ${projections.length} rows into learned_projections.`)
if (activePointer) console.log(`Set app_config['${ACTIVE_PROJECTION_CONFIG_KEY}'].`)
await pool.end()
