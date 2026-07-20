import '../src/env.js'
import { listAllPhotoEmbeddings } from '../src/photoEmbeddings.js'
import { DINO_MODEL_ID } from '../src/dino.js'
import { PREPROCESSING_VERSION } from '../src/preprocessingVersion.js'
import { computeCultivarCentroids, upsertCultivarCentroids, pruneStaleCultivarCentroids } from '../src/cultivarCentroids.js'

const DRY_RUN = process.argv.includes('--dry-run')

const allEmbeddings = await listAllPhotoEmbeddings()
const referenceEmbeddings = allEmbeddings.filter(
  (doc) => doc.embeddingModel === DINO_MODEL_ID && doc.preprocessingVersion === PREPROCESSING_VERSION,
)

console.log(`Found ${referenceEmbeddings.length} new-generation reference embeddings (of ${allEmbeddings.length} total docs).`)

const centroidDocs = computeCultivarCentroids(referenceEmbeddings)

for (const doc of centroidDocs) {
  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}${doc.cultivarName}: ${doc.sourcePhotoCount} photos -> ${doc.centroids.length} centroid(s) (clustered=${doc.clusteringApplied})`,
  )
}

let pruned = 0
if (!DRY_RUN) {
  await upsertCultivarCentroids(centroidDocs, { embeddingModel: DINO_MODEL_ID, preprocessingVersion: PREPROCESSING_VERSION })
  pruned = await pruneStaleCultivarCentroids(centroidDocs, { embeddingModel: DINO_MODEL_ID, preprocessingVersion: PREPROCESSING_VERSION })
}

console.log({ dryRun: DRY_RUN, cultivarsProcessed: centroidDocs.length, pruned })
