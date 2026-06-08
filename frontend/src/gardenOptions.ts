import type { GardenOptions } from './types'

export const GARDEN_OPTIONS_STORAGE_KEY = 'dahlia-tracker-garden-options'
const DEFAULT_GARDEN_ROWS = [...buildGardenRows('AM'), 'EE', 'FF', 'GG']
const PREVIOUS_DEFAULT_GARDEN_ROWS = buildGardenRows('LL')

export const DEFAULT_GARDEN_OPTIONS: GardenOptions = {
  gardenAreas: ['Main Garden', 'North Island', 'South Island'],
  gardenRows: DEFAULT_GARDEN_ROWS,
  gardenPositions: Array.from({ length: 20 }, (_, index) => String(index + 1)),
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

export function normalizeGardenOptions(value: Partial<GardenOptions> | null | undefined): GardenOptions {
  return {
    gardenAreas: normalizeList(value?.gardenAreas, DEFAULT_GARDEN_OPTIONS.gardenAreas),
    gardenRows: normalizeGardenRows(value?.gardenRows),
    gardenPositions: normalizeList(value?.gardenPositions, DEFAULT_GARDEN_OPTIONS.gardenPositions),
  }
}

function normalizeGardenRows(values: string[] | undefined) {
  const rows = normalizeList(values, DEFAULT_GARDEN_ROWS)
  if (rows.length === PREVIOUS_DEFAULT_GARDEN_ROWS.length && rows.every((row, index) => row === PREVIOUS_DEFAULT_GARDEN_ROWS[index])) {
    return DEFAULT_GARDEN_ROWS
  }

  return rows
}

function normalizeList(values: string[] | undefined, fallback: string[]) {
  const seen = new Set<string>()
  const normalized = (values ?? [])
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLowerCase()
      if (!value || seen.has(key)) return false
      seen.add(key)
      return true
    })

  return normalized.length ? normalized : fallback
}
