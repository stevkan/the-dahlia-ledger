import '../src/env.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listAllPhotoEmbeddings } from '../src/photoEmbeddings.js'
import { DINO_MODEL_ID } from '../src/dino.js'
import { PREPROCESSING_VERSION } from '../src/preprocessingVersion.js'

function normalizeCultivarKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

function outPathFromArgs() {
  const flagIndex = process.argv.indexOf('--out')
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1]

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  return path.join(__dirname, 'fixtures', 'training-embeddings.json')
}

const allEmbeddings = await listAllPhotoEmbeddings()
const referenceEmbeddings = allEmbeddings.filter(
  (doc) => doc.embeddingModel === DINO_MODEL_ID && doc.preprocessingVersion === PREPROCESSING_VERSION && Array.isArray(doc.embedding),
)

const photos = referenceEmbeddings.map((doc) => ({
  gardenId: doc.gardenId,
  cultivarName: doc.cultivarName,
  imageUrl: doc.imageUrl,
  embedding: doc.embedding,
}))

const cultivarCount = new Set(photos.map((p) => normalizeCultivarKey(p.cultivarName))).size

const output = {
  embeddingModel: DINO_MODEL_ID,
  preprocessingVersion: PREPROCESSING_VERSION,
  exportedAt: new Date().toISOString(),
  photoCount: photos.length,
  cultivarCount,
  photos,
}

const outPath = outPathFromArgs()
await fs.mkdir(path.dirname(outPath), { recursive: true })
await fs.writeFile(outPath, JSON.stringify(output, null, 2))

console.log({ outPath, photoCount: photos.length, cultivarCount })
