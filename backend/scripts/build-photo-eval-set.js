import '../src/env.js'
import { listRecords } from '../src/records.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Deterministic PRNG (mulberry32) so the held-out split is reproducible across runs/reviewers.
const SEED = 1755202600
function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle(array, rng) {
  const copy = [...array]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// Below this a cultivar can't meaningfully hold out a photo and still keep enough references to be
// identifiable; above 1 photo but below this, the cultivar is skipped entirely (neither held out nor
// used as an "unknown" sample) rather than contributing an unreliable data point either way.
const MIN_PHOTOS_FOR_HOLDOUT = 4
const HOLD_OUT_FRACTION = 0.2
const MAX_UNKNOWN_SAMPLES = 20

function normalizeCultivarKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

function livePhotosByCultivar(records) {
  const byKey = new Map()
  for (const record of records) {
    const cultivarName = String(record.core?.cultivar || record.flowerName || '').trim()
    if (!cultivarName) continue
    const gardenId = record.gardenId
    const photos = [...(record.recordPhotos ?? []), ...(record.cultivarPhotos ?? [])]
    const seen = new Set()
    for (const photo of photos) {
      if (!photo?.imageUrl || seen.has(photo.imageUrl)) continue
      seen.add(photo.imageUrl)
      const key = `${gardenId}::${normalizeCultivarKey(cultivarName)}`
      const existing = byKey.get(key) ?? { cultivarName, gardenId, photos: [] }
      existing.photos.push({ imageUrl: photo.imageUrl, thumbnailUrl: photo.thumbnailUrl || photo.imageUrl })
      byKey.set(key, existing)
    }
  }
  return byKey
}

const records = await listRecords()
const byCultivar = livePhotosByCultivar(records)
const rng = mulberry32(SEED)

const heldOut = []
const unknownCandidates = []

for (const { cultivarName, gardenId, photos } of byCultivar.values()) {
  if (photos.length === 1) {
    unknownCandidates.push({ cultivarName, gardenId, ...photos[0] })
    continue
  }
  if (photos.length < MIN_PHOTOS_FOR_HOLDOUT) continue

  const holdOutCount = Math.min(
    Math.max(1, Math.round(photos.length * HOLD_OUT_FRACTION)),
    photos.length - 3, // always leave at least 3 references behind
  )
  if (holdOutCount < 1) continue

  const shuffled = shuffle(photos, rng)
  for (const photo of shuffled.slice(0, holdOutCount)) {
    heldOut.push({ cultivarName, gardenId, ...photo })
  }
}

const unknownCultivarSamples = shuffle(unknownCandidates, rng).slice(0, MAX_UNKNOWN_SAMPLES)

const output = {
  generatedAt: new Date().toISOString(),
  seed: SEED,
  minPhotosForHoldout: MIN_PHOTOS_FOR_HOLDOUT,
  holdOutFraction: HOLD_OUT_FRACTION,
  cultivarsConsidered: byCultivar.size,
  heldOut,
  unknownCultivarSamples,
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, 'fixtures')
await fs.mkdir(outDir, { recursive: true })
const outPath = path.join(outDir, 'photo-eval-set.json')
await fs.writeFile(outPath, JSON.stringify(output, null, 2))

console.log({
  cultivarsConsidered: byCultivar.size,
  heldOutCount: heldOut.length,
  heldOutCultivars: new Set(heldOut.map((h) => `${h.gardenId}::${normalizeCultivarKey(h.cultivarName)}`)).size,
  unknownCultivarSamples: unknownCultivarSamples.length,
  outPath,
})
