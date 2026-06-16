import type { GardenOptions, GardenRowOption, GardenZoneOption } from './types'

export const GARDEN_OPTIONS_STORAGE_KEY = 'dahlia-tracker-garden-options'
const DEFAULT_GARDEN_ROWS = ['A', 'B', 'C']
const PREVIOUS_DEFAULT_GARDEN_ROWS = [...buildGardenRows('AM'), 'EE', 'FF', 'GG']
export const UNASSIGNED_GARDEN_ZONE_NAME = 'Unassigned'

export const DEFAULT_GARDEN_OPTIONS: GardenOptions = {
  gardenAreas: ['Main Garden'],
  gardenRows: DEFAULT_GARDEN_ROWS,
  gardenPositions: Array.from({ length: 10 }, (_, index) => String(index + 1)),
  gardenZones: [{ id: stableGardenOptionId('zone', 'Main Garden'), name: 'Main Garden', rows: DEFAULT_GARDEN_ROWS.map((row) => ({ id: stableGardenOptionId('row', `Main Garden:${row}`), name: row })) }],
}

export function buildGardenRows(lastRow: string) {
  const rows: string[] = []
  let current = 'A'

  while (true) {
    rows.push(current)
    if (current === lastRow) return rows
    current = nextGardenRow(current)
  }
}

function nextGardenRow(row: string) {
  const chars = row.split('')

  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (chars[index] !== 'Z') {
      chars[index] = String.fromCharCode(chars[index].charCodeAt(0) + 1)
      return chars.join('')
    }
    chars[index] = 'A'
  }

  return `A${chars.join('')}`
}

export function stableGardenOptionId(prefix: string, value: string) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'option'
  return `${prefix}-${slug}`
}

export function normalizeGardenOptions(value: Partial<GardenOptions> | null | undefined): GardenOptions {
  const gardenAreas = normalizeList(value?.gardenAreas, DEFAULT_GARDEN_OPTIONS.gardenAreas)
  const gardenRows = normalizeList(value?.gardenRows, DEFAULT_GARDEN_ROWS)
  const gardenZones = normalizeGardenZones(value?.gardenZones, gardenAreas, gardenRows)

  return {
    gardenAreas: gardenZones.map((zone) => zone.name),
    gardenRows: gardenZones.flatMap((zone) => zone.rows.map((row) => row.name)).filter((row, index, rows) => rows.findIndex((candidate) => candidate.toLowerCase() === row.toLowerCase()) === index),
    gardenPositions: normalizeList(value?.gardenPositions, DEFAULT_GARDEN_OPTIONS.gardenPositions),
    gardenZones,
  }
}

export function normalizeStoredGardenOptions(value: Partial<GardenOptions> | null | undefined): GardenOptions {
  const options = normalizeGardenOptions(value)
  return {
    ...options,
    gardenRows: normalizeStoredGardenRows(options.gardenRows),
    gardenZones: normalizeGardenZones(options.gardenZones, options.gardenAreas, normalizeStoredGardenRows(options.gardenRows)),
  }
}

function normalizeGardenZones(values: GardenZoneOption[] | undefined, gardenAreas: string[], gardenRows: string[]) {
  const normalizedZones = normalizeZoneList(values)
  if (normalizedZones.length) return normalizedZones

  const zones = gardenAreas.length ? gardenAreas : [UNASSIGNED_GARDEN_ZONE_NAME]
  const rowZoneName = gardenAreas[0] ?? UNASSIGNED_GARDEN_ZONE_NAME
  return zones.map((zoneName) => ({
    id: stableGardenOptionId('zone', zoneName),
    name: zoneName,
    rows: zoneName === rowZoneName ? gardenRows.map((row) => ({ id: stableGardenOptionId('row', `${zoneName}:${row}`), name: row })) : [],
  }))
}

function normalizeZoneList(values: GardenZoneOption[] | undefined) {
  if (!Array.isArray(values)) return []

  const seenZones = new Set<string>()
  return values.map((zone) => {
    const name = typeof zone?.name === 'string' ? zone.name.trim().replace(/\s+/g, ' ') : ''
    if (!name) return null
    const key = name.toLowerCase()
    if (seenZones.has(key)) return null
    seenZones.add(key)
    return {
      id: typeof zone.id === 'string' && zone.id.trim() ? zone.id : stableGardenOptionId('zone', name),
      name,
      rows: normalizeRows(zone.rows, name),
    }
  }).filter((zone): zone is GardenZoneOption => Boolean(zone))
}

function normalizeRows(values: GardenRowOption[] | undefined, zoneName: string) {
  if (!Array.isArray(values)) return []

  const seenRows = new Set<string>()
  return values.map((row) => {
    const name = typeof row?.name === 'string' ? row.name.trim().replace(/\s+/g, ' ') : ''
    if (!name) return null
    const key = name.toLowerCase()
    if (seenRows.has(key)) return null
    seenRows.add(key)
    return {
      id: typeof row.id === 'string' && row.id.trim() ? row.id : stableGardenOptionId('row', `${zoneName}:${name}`),
      name,
    }
  }).filter((row): row is GardenRowOption => Boolean(row))
}

function normalizeStoredGardenRows(values: string[]) {
  if (values.length === PREVIOUS_DEFAULT_GARDEN_ROWS.length && values.every((row, index) => row === PREVIOUS_DEFAULT_GARDEN_ROWS[index])) {
    return DEFAULT_GARDEN_ROWS
  }

  return values
}

function normalizeList(values: string[] | undefined, fallback: string[]) {
  if (!values) return fallback

  const seen = new Set<string>()
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLowerCase()
      if (!value || seen.has(key)) return false
      seen.add(key)
      return true
    })
}
