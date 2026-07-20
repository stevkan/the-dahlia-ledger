import { kmeans } from './kmeans.js'

// Direct sRGB -> linear RGB -> CIEXYZ (D65) -> CIE L*a*b* conversion. Hand-rolled rather than using
// sharp's colourspace conversion because sharp's pixel-level Lab packing (scaling/offsets, rounding)
// is under-documented, whereas this is directly testable against known reference triples, e.g. pure
// red (255,0,0) -> L*=53.24, a*=80.09, b*=67.20.
function srgbChannelToLinear(c) {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

const D65_WHITE = { x: 0.95047, y: 1.0, z: 1.08883 }

function labF(t) {
  const delta = 6 / 29
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29
}

export function srgbToLab(r, g, b) {
  const rl = srgbChannelToLinear(r)
  const gl = srgbChannelToLinear(g)
  const bl = srgbChannelToLinear(b)

  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / D65_WHITE.x
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175) / D65_WHITE.y
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / D65_WHITE.z

  const fx = labF(x)
  const fy = labF(y)
  const fz = labF(z)

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

function deltaE76(a, b) {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2)
}

const HISTOGRAM_BINS = { l: 4, a: 4, b: 4 } // coarse 4x4x4 = 64-bin joint Lab histogram

function histogramBinIndex(lab) {
  const lBin = Math.min(HISTOGRAM_BINS.l - 1, Math.max(0, Math.floor((lab.l / 100) * HISTOGRAM_BINS.l)))
  const aBin = Math.min(HISTOGRAM_BINS.a - 1, Math.max(0, Math.floor(((lab.a + 128) / 256) * HISTOGRAM_BINS.a)))
  const bBin = Math.min(HISTOGRAM_BINS.b - 1, Math.max(0, Math.floor(((lab.b + 128) / 256) * HISTOGRAM_BINS.b)))
  return (lBin * HISTOGRAM_BINS.a + aBin) * HISTOGRAM_BINS.b + bBin
}

const DOMINANT_COLOR_K = 4
const CENTER_RADIUS_RATIO = 0.3
const OUTER_RADIUS_RATIO = 0.6

/**
 * @param {Buffer|Uint8ClampedArray} rgbaBuffer Raw RGBA pixel buffer (alpha = segmentation mask).
 * @param {{ width: number, height: number }} dims
 */
export function extractColorFeatures(rgbaBuffer, { width, height }) {
  const centerX = width / 2
  const centerY = height / 2
  const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY) || 1

  const labPixels = []
  const centerLabPixels = []
  const outerLabPixels = []
  const histogram = new Array(HISTOGRAM_BINS.l * HISTOGRAM_BINS.a * HISTOGRAM_BINS.b).fill(0)
  let chromaSum = 0
  let chromaSumSquares = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const alpha = rgbaBuffer[idx + 3]
      if (alpha < 128) continue // background (or near-transparent edge) -- skip

      const lab = srgbToLab(rgbaBuffer[idx], rgbaBuffer[idx + 1], rgbaBuffer[idx + 2])
      labPixels.push(lab)
      histogram[histogramBinIndex(lab)] += 1

      const chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b)
      chromaSum += chroma
      chromaSumSquares += chroma * chroma

      const relativeRadius = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2) / maxRadius
      if (relativeRadius <= CENTER_RADIUS_RATIO) centerLabPixels.push(lab)
      else if (relativeRadius >= OUTER_RADIUS_RATIO) outerLabPixels.push(lab)
    }
  }

  const pixelCount = labPixels.length
  if (pixelCount === 0) return null

  const meanLab = (pixels) => {
    if (pixels.length === 0) return null
    const sum = pixels.reduce((acc, p) => ({ l: acc.l + p.l, a: acc.a + p.a, b: acc.b + p.b }), { l: 0, a: 0, b: 0 })
    return { l: sum.l / pixels.length, a: sum.a / pixels.length, b: sum.b / pixels.length }
  }

  const k = Math.min(DOMINANT_COLOR_K, pixelCount)
  const points = labPixels.map((p) => [p.l, p.a, p.b])
  const { centroids, assignments } = kmeans(points, k, { seed: 7 })
  const clusterCounts = new Array(k).fill(0)
  for (const assignment of assignments) clusterCounts[assignment] += 1
  const dominantColors = centroids
    .map((c, i) => ({ l: c[0], a: c[1], b: c[2], weight: clusterCounts[i] / pixelCount }))
    .sort((a, b) => b.weight - a.weight)

  const chromaMean = chromaSum / pixelCount
  const chromaStd = Math.sqrt(Math.max(0, chromaSumSquares / pixelCount - chromaMean * chromaMean))

  return {
    dominantColors,
    histogram: histogram.map((count) => count / pixelCount),
    centerLab: meanLab(centerLabPixels),
    outerLab: meanLab(outerLabPixels),
    chromaMean,
    chromaStd,
    pixelCount,
  }
}

function labSimilarityFromDeltaE(delta, scale = 40) {
  return Math.exp(-delta / scale)
}

// Cheap EMD approximation: match each color to its single best (nearest) counterpart in the other
// set, weighted by its own cluster weight, rather than averaging over every cross pair (which would
// let dissimilar within-photo cluster pairs drag down even a perfect self-comparison below 1.0).
function bestMatchWeightedSimilarity(from, to) {
  let weightedScore = 0
  let weightTotal = 0
  for (const colorFrom of from) {
    let best = -Infinity
    for (const colorTo of to) {
      const sim = labSimilarityFromDeltaE(deltaE76(colorFrom, colorTo))
      if (sim > best) best = sim
    }
    weightedScore += colorFrom.weight * best
    weightTotal += colorFrom.weight
  }
  return weightTotal > 0 ? weightedScore / weightTotal : 0
}

function dominantColorSimilarity(a, b) {
  if (!a?.length || !b?.length) return 0
  // Symmetric: A's colors matched against B's, and vice versa, so neither set's clustering quirks
  // dominate the score.
  return (bestMatchWeightedSimilarity(a, b) + bestMatchWeightedSimilarity(b, a)) / 2
}

function histogramSimilarity(a, b) {
  if (!a?.length || !b?.length) return 0
  let intersection = 0
  for (let i = 0; i < a.length; i++) intersection += Math.min(a[i], b[i])
  return intersection // histograms are each L1-normalized, so intersection is naturally in [0, 1]
}

/** @returns {number} similarity in [0, 1] */
export function colorFeatureSimilarity(a, b) {
  if (!a || !b) return 0

  const dominantSim = dominantColorSimilarity(a.dominantColors, b.dominantColors)
  const histogramSim = histogramSimilarity(a.histogram, b.histogram)
  const centerSim = a.centerLab && b.centerLab ? labSimilarityFromDeltaE(deltaE76(a.centerLab, b.centerLab)) : null
  const outerSim = a.outerLab && b.outerLab ? labSimilarityFromDeltaE(deltaE76(a.outerLab, b.outerLab)) : null

  const parts = [
    { value: dominantSim, weight: 0.5 },
    { value: histogramSim, weight: 0.3 },
    { value: centerSim, weight: 0.1 },
    { value: outerSim, weight: 0.1 },
  ].filter((p) => p.value !== null)

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0)
  if (totalWeight === 0) return 0
  return parts.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight
}
