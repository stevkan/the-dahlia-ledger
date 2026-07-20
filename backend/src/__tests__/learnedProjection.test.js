import { describe, it, expect, vi } from 'vitest'

vi.mock('../firebase.js', () => ({ getDb: vi.fn(), getBucket: vi.fn() }))

import { applyProjection, evaluateDrift } from '../learnedProjection.js'

// ---------------------------------------------------------------------------
// applyProjection
// ---------------------------------------------------------------------------

describe('applyProjection', () => {
  it('leaves an already-normalized vector unchanged under the identity matrix', () => {
    const identity = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const vector = [0.6, 0.8, 0]
    const result = applyProjection(vector, identity)
    expect(result[0]).toBeCloseTo(0.6, 6)
    expect(result[1]).toBeCloseTo(0.8, 6)
    expect(result[2]).toBeCloseTo(0, 6)
  })

  it('applies a known matrix and L2-normalizes the result', () => {
    const matrix = [
      [2, 0],
      [0, 2],
    ]
    const result = applyProjection([3, 4], matrix)
    // Raw projection is [6, 8] (norm 10) -> normalized [0.6, 0.8]
    expect(result[0]).toBeCloseTo(0.6, 6)
    expect(result[1]).toBeCloseTo(0.8, 6)
  })

  it('returns a unit-norm vector', () => {
    const matrix = [
      [1, 2],
      [3, 4],
    ]
    const [x, y] = applyProjection([1, 1], matrix)
    expect(Math.sqrt(x * x + y * y)).toBeCloseTo(1, 6)
  })
})

// ---------------------------------------------------------------------------
// evaluateDrift
// ---------------------------------------------------------------------------

describe('evaluateDrift', () => {
  const baseArgs = {
    trainedAtPhotoCount: 100,
    trainedAtCultivarCount: 20,
    photoGrowthThreshold: 0.25,
    cultivarGrowthThreshold: 0.2,
  }

  it('does not recommend retraining when growth is under both thresholds', () => {
    const result = evaluateDrift({ ...baseArgs, currentPhotoCount: 110, currentCultivarCount: 21 })
    expect(result.retrainingRecommended).toBe(false)
    expect(result.reason).toBeNull()
  })

  it('recommends retraining when photo growth crosses the threshold', () => {
    const result = evaluateDrift({ ...baseArgs, currentPhotoCount: 130, currentCultivarCount: 21 })
    expect(result.retrainingRecommended).toBe(true)
    expect(result.reason).toMatch(/photo collection has grown/)
  })

  it('recommends retraining when cultivar growth crosses the threshold', () => {
    const result = evaluateDrift({ ...baseArgs, currentPhotoCount: 105, currentCultivarCount: 25 })
    expect(result.retrainingRecommended).toBe(true)
    expect(result.reason).toMatch(/number of cultivars has grown/)
  })

  it('mentions both reasons when both thresholds are crossed', () => {
    const result = evaluateDrift({ ...baseArgs, currentPhotoCount: 130, currentCultivarCount: 25 })
    expect(result.retrainingRecommended).toBe(true)
    expect(result.reason).toMatch(/photo collection has grown/)
    expect(result.reason).toMatch(/number of cultivars has grown/)
  })

  it('treats a zero trained-at count as no baseline to drift from', () => {
    const result = evaluateDrift({
      trainedAtPhotoCount: 0,
      trainedAtCultivarCount: 0,
      currentPhotoCount: 50,
      currentCultivarCount: 10,
      photoGrowthThreshold: 0.25,
      cultivarGrowthThreshold: 0.2,
    })
    expect(result.retrainingRecommended).toBe(false)
  })
})
