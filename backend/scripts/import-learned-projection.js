import '../src/env.js'
import fs from 'node:fs/promises'
import { upsertLearnedProjection, setActiveLearnedProjection } from '../src/learnedProjection.js'
import { DINO_MODEL_ID } from '../src/dino.js'
import { PREPROCESSING_VERSION } from '../src/preprocessingVersion.js'

const DRY_RUN = process.argv.includes('--dry-run')
const ACTIVATE = process.argv.includes('--activate')

function inPathFromArgs() {
  const flagIndex = process.argv.indexOf('--in')
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1]
  return 'ml-training/output/learned-projection.json'
}

const inPath = inPathFromArgs()
const raw = JSON.parse(await fs.readFile(inPath, 'utf-8'))

const {
  projectionVersion,
  matrix,
  inputDim,
  outputDim,
  trainedAtPhotoCount,
  trainedAtCultivarCount,
  metrics,
} = raw

if (!projectionVersion || !Array.isArray(matrix)) {
  throw new Error(`${inPath} is missing projectionVersion or matrix.`)
}

console.log(
  `${DRY_RUN ? '[dry-run] ' : ''}Importing projection ${projectionVersion} (${inputDim}x${outputDim}, trained on ${trainedAtPhotoCount} photos / ${trainedAtCultivarCount} cultivars).`,
)

if (!DRY_RUN) {
  await upsertLearnedProjection({
    embeddingModel: DINO_MODEL_ID,
    preprocessingVersion: PREPROCESSING_VERSION,
    projectionVersion,
    matrix,
    inputDim,
    outputDim,
    trainedAtPhotoCount,
    trainedAtCultivarCount,
    metrics,
  })

  if (ACTIVATE) {
    await setActiveLearnedProjection({
      embeddingModel: DINO_MODEL_ID,
      preprocessingVersion: PREPROCESSING_VERSION,
      projectionVersion,
    })
  }
}

console.log({ dryRun: DRY_RUN, projectionVersion, activated: !DRY_RUN && ACTIVATE })
