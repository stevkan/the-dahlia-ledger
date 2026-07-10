import { describe, it, expect } from 'vitest'
import {
  buildGardenRows,
  stableGardenOptionId,
  normalizeGardenOptions,
  normalizeStoredGardenOptions,
  DEFAULT_GARDEN_OPTIONS,
  UNASSIGNED_GARDEN_ZONE_NAME,
} from '../gardenOptions'

// ---------------------------------------------------------------------------
// buildGardenRows
// ---------------------------------------------------------------------------

describe('buildGardenRows', () => {
  it('builds a single-letter range', () => {
    expect(buildGardenRows('C')).toEqual(['A', 'B', 'C'])
  })

  it('returns a single-element array when lastRow is A', () => {
    expect(buildGardenRows('A')).toEqual(['A'])
  })

  it('builds the full single-letter alphabet', () => {
    const rows = buildGardenRows('Z')
    expect(rows).toHaveLength(26)
    expect(rows[0]).toBe('A')
    expect(rows[25]).toBe('Z')
  })

  it('continues into double-letter rows after Z', () => {
    const rows = buildGardenRows('AB')
    expect(rows).toContain('Z')
    expect(rows).toContain('AA')
    expect(rows).toContain('AB')
    expect(rows.indexOf('AA')).toBe(rows.indexOf('Z') + 1)
  })

  it('rolls over correctly at AZ → BA', () => {
    const rows = buildGardenRows('BA')
    expect(rows).toContain('AZ')
    expect(rows).toContain('BA')
    expect(rows.indexOf('BA')).toBe(rows.indexOf('AZ') + 1)
  })
})

// ---------------------------------------------------------------------------
// stableGardenOptionId
// ---------------------------------------------------------------------------

describe('stableGardenOptionId', () => {
  it('lowercases and hyphenates a normal string', () => {
    expect(stableGardenOptionId('zone', 'Main Garden')).toBe('zone-main-garden')
  })

  it('handles a row reference with a colon separator', () => {
    expect(stableGardenOptionId('row', 'Main Garden:A')).toBe('row-main-garden-a')
  })

  it('falls back to "option" for an empty value', () => {
    expect(stableGardenOptionId('zone', '')).toBe('zone-option')
  })

  it('falls back to "option" for a whitespace-only value', () => {
    expect(stableGardenOptionId('zone', '   ')).toBe('zone-option')
  })

  it('strips special characters', () => {
    expect(stableGardenOptionId('zone', 'Area #1!')).toBe('zone-area-1')
  })

  it('collapses consecutive separators', () => {
    expect(stableGardenOptionId('zone', 'North -- South')).toBe('zone-north-south')
  })

  it('trims leading and trailing hyphens from the slug', () => {
    expect(stableGardenOptionId('row', '--Row A--')).toBe('row-row-a')
  })
})

// ---------------------------------------------------------------------------
// normalizeGardenOptions
// ---------------------------------------------------------------------------

describe('normalizeGardenOptions', () => {
  it('returns defaults for null', () => {
    const result = normalizeGardenOptions(null)
    expect(result.gardenAreas).toEqual(DEFAULT_GARDEN_OPTIONS.gardenAreas)
    expect(result.gardenPositions).toEqual(DEFAULT_GARDEN_OPTIONS.gardenPositions)
    expect(result.gardenZones).toHaveLength(1)
    expect(result.gardenZones[0].name).toBe('Main Garden')
  })

  it('returns defaults for undefined', () => {
    const result = normalizeGardenOptions(undefined)
    expect(result.gardenAreas).toEqual(DEFAULT_GARDEN_OPTIONS.gardenAreas)
  })

  it('returns defaults for an empty object', () => {
    const result = normalizeGardenOptions({})
    expect(result.gardenAreas).toEqual(DEFAULT_GARDEN_OPTIONS.gardenAreas)
  })

  it('creates zones from gardenAreas when no zones are provided', () => {
    const result = normalizeGardenOptions({ gardenAreas: ['North', 'South'] })
    expect(result.gardenAreas).toEqual(['North', 'South'])
    expect(result.gardenZones).toHaveLength(2)
    expect(result.gardenZones[0].name).toBe('North')
    expect(result.gardenZones[1].name).toBe('South')
  })

  it('assigns rows only to the first zone when building from gardenAreas', () => {
    const result = normalizeGardenOptions({ gardenAreas: ['North', 'South'], gardenRows: ['A', 'B'] })
    expect(result.gardenZones[0].rows.map((r) => r.name)).toEqual(['A', 'B'])
    expect(result.gardenZones[1].rows).toEqual([])
  })

  it('derives gardenRows from zone rows (deduped, first-occurrence wins)', () => {
    const result = normalizeGardenOptions({
      gardenAreas: ['North', 'South'],
      gardenRows: ['A', 'B'],
    })
    expect(result.gardenRows).toEqual(['A', 'B'])
  })

  it('deduplicates gardenAreas case-insensitively', () => {
    const result = normalizeGardenOptions({ gardenAreas: ['Main', 'main', 'MAIN'] })
    expect(result.gardenAreas).toHaveLength(1)
    expect(result.gardenAreas[0]).toBe('Main')
  })

  it('trims leading and trailing whitespace from area names', () => {
    // normalizeList only trims; internal whitespace is preserved in the plain-areas path.
    // Internal whitespace collapse only happens when areas go through normalizeZoneList
    // (i.e., when gardenZones is explicitly supplied).
    const result = normalizeGardenOptions({ gardenAreas: ['  Main Garden  '] })
    expect(result.gardenAreas[0]).toBe('Main Garden')
  })

  it('collapses internal whitespace in zone names when gardenZones is provided', () => {
    const zones = [{ id: '', name: '  Main  Garden  ', rows: [] }]
    const result = normalizeGardenOptions({ gardenZones: zones })
    expect(result.gardenAreas[0]).toBe('Main Garden')
  })

  it('filters out empty and whitespace-only area names', () => {
    const result = normalizeGardenOptions({ gardenAreas: ['', '   ', 'Real'] })
    expect(result.gardenAreas).toEqual(['Real'])
  })

  it('deduplicates gardenPositions case-insensitively', () => {
    const result = normalizeGardenOptions({ gardenPositions: ['1', '2', '2', '3'] })
    expect(result.gardenPositions).toEqual(['1', '2', '3'])
  })

  it('uses gardenZones directly when provided, ignoring gardenAreas/gardenRows', () => {
    const zones = [
      { id: 'zone-custom', name: 'Custom Zone', rows: [{ id: 'row-custom-a', name: 'A' }] },
    ]
    const result = normalizeGardenOptions({ gardenZones: zones, gardenAreas: ['Ignored'] })
    expect(result.gardenAreas).toEqual(['Custom Zone'])
    expect(result.gardenZones[0].name).toBe('Custom Zone')
  })

  it('deduplicates zones case-insensitively when gardenZones is provided', () => {
    const zones = [
      { id: 'zone-main', name: 'Main', rows: [] },
      { id: 'zone-main-2', name: 'main', rows: [] },
    ]
    const result = normalizeGardenOptions({ gardenZones: zones })
    expect(result.gardenZones).toHaveLength(1)
  })

  it('deduplicates rows within a zone case-insensitively', () => {
    const zones = [
      { id: 'zone-main', name: 'Main', rows: [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'a' }] },
    ]
    const result = normalizeGardenOptions({ gardenZones: zones })
    expect(result.gardenZones[0].rows).toHaveLength(1)
  })

  it('generates a stable id for a zone missing an id', () => {
    const zones = [{ id: '', name: 'North', rows: [] }]
    const result = normalizeGardenOptions({ gardenZones: zones })
    expect(result.gardenZones[0].id).toBe('zone-north')
  })

  it('preserves an existing zone id', () => {
    const zones = [{ id: 'my-custom-id', name: 'North', rows: [] }]
    const result = normalizeGardenOptions({ gardenZones: zones })
    expect(result.gardenZones[0].id).toBe('my-custom-id')
  })

  it('uses UNASSIGNED_GARDEN_ZONE_NAME when gardenAreas is empty', () => {
    const result = normalizeGardenOptions({ gardenAreas: [] })
    expect(result.gardenZones[0].name).toBe(UNASSIGNED_GARDEN_ZONE_NAME)
  })
})

// ---------------------------------------------------------------------------
// normalizeStoredGardenOptions
// ---------------------------------------------------------------------------

describe('normalizeStoredGardenOptions', () => {
  it('behaves like normalizeGardenOptions for null', () => {
    const result = normalizeStoredGardenOptions(null)
    expect(result.gardenAreas).toEqual(DEFAULT_GARDEN_OPTIONS.gardenAreas)
  })

  it('migrates the legacy default row list to the current defaults', () => {
    // The old default was buildGardenRows('AM') plus EE, FF, GG.
    const oldRows = [...buildGardenRows('AM'), 'EE', 'FF', 'GG']
    const result = normalizeStoredGardenOptions({ gardenRows: oldRows })
    expect(result.gardenRows).toEqual(['A', 'B', 'C'])
  })

  it('leaves custom row lists unchanged', () => {
    const customRows = ['Row 1', 'Row 2', 'Row 3']
    const result = normalizeStoredGardenOptions({ gardenRows: customRows })
    expect(result.gardenRows).toEqual(customRows)
  })

  it('leaves a partially-matching row list unchanged', () => {
    // Same length as the old default but different content → not migrated.
    const oldRows = [...buildGardenRows('AM'), 'EE', 'FF', 'GG']
    const almostOld = [...oldRows.slice(0, -1), 'HH']
    const result = normalizeStoredGardenOptions({ gardenRows: almostOld })
    expect(result.gardenRows).not.toEqual(['A', 'B', 'C'])
  })
})
