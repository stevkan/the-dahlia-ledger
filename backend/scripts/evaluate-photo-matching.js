import '../src/env.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listRecords } from '../src/records.js'
import { segmentFlower, warmSegmentationModel, SEGMENTATION_MODEL_ID } from '../src/segmentation.js'
import { embedImage, cosineSimilarity, warmEmbeddingModel, EMBEDDING_MODEL_ID } from '../src/embeddings.js'
import { embedImageDino, warmDinoModel, DINO_MODEL_ID } from '../src/dino.js'
import { embedImageSiglip, warmSiglipModel, SIGLIP_MODEL_ID } from '../src/siglip.js'

function parseIntArg(name, fallback) {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (!match) return fallback
  const value = Number(match.split('=')[1])
  return Number.isFinite(value) ? value : fallback
}

const LIMIT_HELDOUT = parseIntArg('limit-heldout', Infinity)
const LIMIT_UNKNOWN = parseIntArg('limit-unknown', Infinity)
const LIMIT_REFERENCE_PER_CULTIVAR = parseIntArg('limit-reference-per-cultivar', Infinity)
const MAX_CULTIVARS = parseIntArg('limit-cultivars', Infinity)

function normalizeCultivarKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(__dirname, 'fixtures', 'photo-eval-set.json')
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'))

let heldOut = fixture.heldOut
let unknownSamples = fixture.unknownCultivarSamples
if (Number.isFinite(LIMIT_HELDOUT)) heldOut = heldOut.slice(0, LIMIT_HELDOUT)
if (Number.isFinite(LIMIT_UNKNOWN)) unknownSamples = unknownSamples.slice(0, LIMIT_UNKNOWN)

const heldOutUrls = new Set(heldOut.map((h) => h.imageUrl))
const unknownUrls = new Set(unknownSamples.map((h) => h.imageUrl))
const excludedUrls = new Set([...heldOutUrls, ...unknownUrls])

// Build the live reference pool (all cultivar photos currently in Firestore), excluding every
// held-out/unknown URL so no pipeline can "find itself" during evaluation.
const records = await listRecords()
const byCultivar = new Map()
for (const record of records) {
  const cultivarName = String(record.core?.cultivar || record.flowerName || '').trim()
  if (!cultivarName) continue
  const gardenId = record.gardenId
  const photos = [...(record.recordPhotos ?? []), ...(record.cultivarPhotos ?? [])]
  const key = `${gardenId}::${normalizeCultivarKey(cultivarName)}`
  const seen = byCultivar.get(key)?.seenUrls ?? new Set()
  const bucket = byCultivar.get(key) ?? { cultivarName, gardenId, photos: [], seenUrls: seen }
  for (const photo of photos) {
    if (!photo?.imageUrl || seen.has(photo.imageUrl) || excludedUrls.has(photo.imageUrl)) continue
    seen.add(photo.imageUrl)
    bucket.photos.push({ imageUrl: photo.imageUrl, thumbnailUrl: photo.thumbnailUrl || photo.imageUrl })
  }
  byCultivar.set(key, bucket)
}

let cultivarEntries = Array.from(byCultivar.entries()).filter(([, v]) => v.photos.length > 0)
if (Number.isFinite(MAX_CULTIVARS)) cultivarEntries = cultivarEntries.slice(0, MAX_CULTIVARS)
if (Number.isFinite(LIMIT_REFERENCE_PER_CULTIVAR)) {
  cultivarEntries = cultivarEntries.map(([k, v]) => [k, { ...v, photos: v.photos.slice(0, LIMIT_REFERENCE_PER_CULTIVAR) }])
}

const referencePhotos = []
for (const [key, { cultivarName, gardenId, photos }] of cultivarEntries) {
  for (const photo of photos) referencePhotos.push({ key, cultivarName, gardenId, ...photo })
}

console.log({
  referenceCultivars: cultivarEntries.length,
  referencePhotos: referencePhotos.length,
  heldOutQueries: heldOut.length,
  unknownQueries: unknownSamples.length,
})

console.log('Warming models...')
await Promise.all([warmSegmentationModel(), warmEmbeddingModel(), warmDinoModel(), warmSiglipModel()])

// -- Per-photo embedding computation, shared between reference pool and query set --

async function timed(fn) {
  const start = performance.now()
  const value = await fn()
  return { value, ms: performance.now() - start }
}

// Records per-step timings so each pipeline's reported "processing speed" reflects what an actual
// identifyPhoto() call for that pipeline would cost in production (segmentation + its own embedding +
// scoring) -- not just the embedding-batch precompute step, where segmentation is amortized once across
// all three segmented pipelines for efficiency.
async function computeAllEmbeddings(imageUrl) {
  const wholeClipT = await timed(() => embedImage({ url: imageUrl }))
  const segT = await timed(() => segmentFlower({ url: imageUrl }))
  const segClipT = await timed(() => embedImage({ image: segT.value.image }))
  const segSiglipT = await timed(() => embedImageSiglip({ image: segT.value.image }))
  const segDinoT = await timed(() => embedImageDino({ image: segT.value.image }))
  return {
    wholeClip: wholeClipT.value,
    segClip: segClipT.value,
    segSiglip: segSiglipT.value,
    segDino: segDinoT.value,
    segmentationApplied: segT.value.applied,
    timingsMs: {
      wholeClip: wholeClipT.ms,
      segmentation: segT.ms,
      segClip: segClipT.ms,
      segSiglip: segSiglipT.ms,
      segDino: segDinoT.ms,
    },
  }
}

async function embedBatch(photos, label) {
  const results = []
  let i = 0
  for (const photo of photos) {
    i += 1
    if (i === 1 || i % 25 === 0 || i === photos.length) console.log(`  [${label}] embedding ${i}/${photos.length}`)
    try {
      const embeddings = await computeAllEmbeddings(photo.imageUrl)
      results.push({ ...photo, ...embeddings })
    } catch (error) {
      console.warn(`  [${label}] failed for ${photo.imageUrl}:`, error instanceof Error ? error.message : error)
    }
  }
  return results
}

console.log('Embedding reference pool...')
const referenceEmbedded = await embedBatch(referencePhotos, 'reference')

console.log('Embedding held-out queries...')
const heldOutEmbedded = await embedBatch(heldOut, 'held-out')

console.log('Embedding unknown-cultivar queries...')
const unknownEmbedded = await embedBatch(unknownSamples, 'unknown')

// -- Scoring: single best-photo-per-cultivar per pipeline, matching today's existing aggregation --

const PIPELINES = [
  { id: 'whole-clip', field: 'wholeClip', needsSegmentation: false },
  { id: 'segmented-clip', field: 'segClip', needsSegmentation: true },
  { id: 'segmented-siglip2', field: 'segSiglip', needsSegmentation: true },
  { id: 'segmented-dino', field: 'segDino', needsSegmentation: true },
]

// Per-query "full identify call" cost for a pipeline: its own embedding step, plus segmentation cost
// if that pipeline requires it (whole-photo CLIP skips segmentation entirely in production).
function fullQueryLatencyMs(query, pipeline) {
  const timings = query.timingsMs
  const embedMs = timings[pipeline.field]
  return (pipeline.needsSegmentation ? timings.segmentation : 0) + embedMs
}

function rankCultivars(queryEmbedding, references, field, gardenId) {
  const bestByCultivar = new Map()
  for (const reference of references) {
    if (reference.gardenId !== gardenId) continue
    const score = cosineSimilarity(queryEmbedding, reference[field])
    const existing = bestByCultivar.get(reference.key)
    if (!existing || score > existing.score) {
      bestByCultivar.set(reference.key, { cultivarName: reference.cultivarName, score })
    }
  }
  return Array.from(bestByCultivar.values()).sort((a, b) => b.score - a.score)
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[idx]
}

const report = []

for (const pipeline of PIPELINES) {
  const { id, field } = pipeline
  let top1Correct = 0
  let top3Correct = 0
  let mrrSum = 0
  const heldOutTop1Scores = []
  const heldOutLatenciesMs = []
  const confusion = new Map() // trueCultivar -> Map(predictedCultivar -> count)

  for (const query of heldOutEmbedded) {
    const rankStart = performance.now()
    const ranked = rankCultivars(query[field], referenceEmbedded, field, query.gardenId)
    const rankMs = performance.now() - rankStart
    heldOutLatenciesMs.push(fullQueryLatencyMs(query, pipeline) + rankMs)

    const trueKey = normalizeCultivarKey(query.cultivarName)
    const top1 = ranked[0]
    if (top1) heldOutTop1Scores.push(top1.score)
    if (top1 && normalizeCultivarKey(top1.cultivarName) === trueKey) top1Correct += 1
    if (ranked.slice(0, 3).some((r) => normalizeCultivarKey(r.cultivarName) === trueKey)) top3Correct += 1
    const rank = ranked.findIndex((r) => normalizeCultivarKey(r.cultivarName) === trueKey)
    if (rank !== -1) mrrSum += 1 / (rank + 1)

    if (top1 && normalizeCultivarKey(top1.cultivarName) !== trueKey) {
      const inner = confusion.get(query.cultivarName) ?? new Map()
      inner.set(top1.cultivarName, (inner.get(top1.cultivarName) ?? 0) + 1)
      confusion.set(query.cultivarName, inner)
    }
  }

  const sortedTop1Scores = [...heldOutTop1Scores].sort((a, b) => a - b)
  // Lenient calibrated threshold: the 10th percentile of true-positive top-1 scores. Below this, we'd
  // already be rejecting a meaningful fraction of correct matches, so it approximates "as low as this
  // pipeline's threshold could reasonably go."
  const calibratedThreshold = percentile(sortedTop1Scores, 0.1)

  let falseConfidentCount = 0
  for (const query of heldOutEmbedded) {
    const ranked = rankCultivars(query[field], referenceEmbedded, field, query.gardenId)
    const top1 = ranked[0]
    const trueKey = normalizeCultivarKey(query.cultivarName)
    if (top1 && normalizeCultivarKey(top1.cultivarName) !== trueKey && top1.score >= calibratedThreshold) {
      falseConfidentCount += 1
    }
  }

  let unknownRejectedCorrectly = 0
  for (const query of unknownEmbedded) {
    const ranked = rankCultivars(query[field], referenceEmbedded, field, query.gardenId)
    const top1 = ranked[0]
    if (!top1 || top1.score < calibratedThreshold) unknownRejectedCorrectly += 1
  }

  const sortedLatencies = [...heldOutLatenciesMs].sort((a, b) => a - b)

  report.push({
    pipeline: id,
    top1Accuracy: heldOutEmbedded.length ? top1Correct / heldOutEmbedded.length : null,
    top3Accuracy: heldOutEmbedded.length ? top3Correct / heldOutEmbedded.length : null,
    mrr: heldOutEmbedded.length ? mrrSum / heldOutEmbedded.length : null,
    falseConfidentRate: heldOutEmbedded.length ? falseConfidentCount / heldOutEmbedded.length : null,
    rejectionQuality: unknownEmbedded.length ? unknownRejectedCorrectly / unknownEmbedded.length : null,
    calibratedThreshold,
    medianLatencyMs: percentile(sortedLatencies, 0.5),
    p95LatencyMs: percentile(sortedLatencies, 0.95),
    topConfusions: Array.from(confusion.entries())
      .flatMap(([trueCultivar, preds]) => Array.from(preds.entries()).map(([pred, count]) => ({ trueCultivar, pred, count })))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  })
}

console.log('\n## Four-way photo-matching benchmark\n')
console.log('| Pipeline | Top-1 Acc | Top-3 Acc | MRR | False-confident rate | Rejection quality | Median ms | p95 ms |')
console.log('|---|---|---|---|---|---|---|---|')
for (const r of report) {
  console.log(
    `| ${r.pipeline} | ${(r.top1Accuracy * 100).toFixed(1)}% | ${(r.top3Accuracy * 100).toFixed(1)}% | ${r.mrr.toFixed(3)} | ${(r.falseConfidentRate * 100).toFixed(1)}% | ${(r.rejectionQuality * 100).toFixed(1)}% | ${r.medianLatencyMs.toFixed(0)} | ${r.p95LatencyMs.toFixed(0)} |`,
  )
}

console.log('\n### Top confusions per pipeline\n')
for (const r of report) {
  console.log(`${r.pipeline}:`, r.topConfusions.map((c) => `${c.trueCultivar} -> ${c.pred} (x${c.count})`).join('; ') || '(none)')
}

console.log('\n### Model identifiers used')
console.log({ EMBEDDING_MODEL_ID, SEGMENTATION_MODEL_ID, DINO_MODEL_ID, SIGLIP_MODEL_ID })

const outPath = path.join(__dirname, 'fixtures', `photo-eval-results-${Date.now()}.json`)
await fs.writeFile(outPath, JSON.stringify({ report, referenceCount: referenceEmbedded.length, heldOutCount: heldOutEmbedded.length, unknownCount: unknownEmbedded.length }, null, 2))
console.log('\nFull results written to', outPath)
