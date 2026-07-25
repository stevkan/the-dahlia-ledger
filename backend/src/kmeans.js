// Small dependency-free k-means, shared by cultivar-centroid clustering. Deterministic (seeded PRNG)
// so recompute runs are reproducible.
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

function euclideanDistanceSquared(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return sum
}

export function normalizedAverage(vectors) {
  const dim = vectors[0].length
  const sum = new Array(dim).fill(0)
  for (const vector of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += vector[i]
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length
  let norm = 0
  for (const value of sum) norm += value * value
  norm = Math.sqrt(norm) || 1
  return sum.map((value) => value / norm)
}

function kmeansPlusPlusInit(points, k, rng) {
  const centroids = [points[Math.floor(rng() * points.length)]]
  while (centroids.length < k) {
    const distances = points.map((point) => Math.min(...centroids.map((c) => euclideanDistanceSquared(point, c))))
    const totalDistance = distances.reduce((a, b) => a + b, 0)
    if (totalDistance === 0) {
      centroids.push(points[Math.floor(rng() * points.length)])
      continue
    }
    let threshold = rng() * totalDistance
    let chosenIndex = 0
    for (let i = 0; i < distances.length; i++) {
      threshold -= distances[i]
      if (threshold <= 0) {
        chosenIndex = i
        break
      }
    }
    centroids.push(points[chosenIndex])
  }
  return centroids
}

/**
 * @param {number[][]} points
 * @param {number} k
 * @param {{ maxIterations?: number, seed?: number }} [options]
 * @returns {{ centroids: number[][], assignments: number[], inertia: number }}
 */
export function kmeans(points, k, { maxIterations = 25, seed = 42 } = {}) {
  const rng = mulberry32(seed)
  let centroids = kmeansPlusPlusInit(points, k, rng)
  let assignments = new Array(points.length).fill(-1)

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let changed = false
    for (let i = 0; i < points.length; i++) {
      let bestCluster = 0
      let bestDistance = Infinity
      for (let c = 0; c < centroids.length; c++) {
        const distance = euclideanDistanceSquared(points[i], centroids[c])
        if (distance < bestDistance) {
          bestDistance = distance
          bestCluster = c
        }
      }
      if (assignments[i] !== bestCluster) changed = true
      assignments[i] = bestCluster
    }

    const newCentroids = centroids.map(() => null)
    const counts = new Array(centroids.length).fill(0)
    const sums = centroids.map(() => new Array(points[0].length).fill(0))
    for (let i = 0; i < points.length; i++) {
      const cluster = assignments[i]
      counts[cluster] += 1
      for (let d = 0; d < points[i].length; d++) sums[cluster][d] += points[i][d]
    }
    for (let c = 0; c < centroids.length; c++) {
      newCentroids[c] = counts[c] > 0 ? sums[c].map((value) => value / counts[c]) : centroids[c]
    }
    centroids = newCentroids

    if (!changed) break
  }

  let inertia = 0
  for (let i = 0; i < points.length; i++) inertia += euclideanDistanceSquared(points[i], centroids[assignments[i]])

  return { centroids, assignments, inertia }
}
