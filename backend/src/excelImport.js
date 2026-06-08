import XLSX from 'xlsx'

import { excelImportRollbackEntry } from './excelImportHistory.js'

const TARGET_SEASON = 2026
const HIGH_CONFIDENCE_SCORE = 0.9
const AMBIGUOUS_MARGIN = 0.04

const MAIN_GARDEN_ROWS = new Set([...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)), 'EE', 'FF', 'GG'])
const NORTH_ISLAND_ROWS = new Set(['AA', 'AB'])
const SOUTH_ISLAND_ROWS = new Set(['AC', 'AD', 'AE', 'AF'])

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[?']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function displayCell(value) {
  return String(value ?? '').trim()
}

function cellText(sheet, row, column) {
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]
  return displayCell(cell?.v)
}

function cellNumber(sheet, row, column) {
  const value = cellText(sheet, row, column)
  if (!/^\d+$/.test(value)) return undefined
  return Number(value)
}

function gardenAreaForRow(row) {
  if (MAIN_GARDEN_ROWS.has(row)) return 'Main Garden'
  if (NORTH_ISLAND_ROWS.has(row)) return 'North Island'
  if (SOUTH_ISLAND_ROWS.has(row)) return 'South Island'
  return undefined
}

function levenshtein(a, b) {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  const current = Array.from({ length: b.length + 1 }, () => 0)

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]
  }

  return previous[b.length]
}

function similarity(a, b) {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (!left || !right) return 0
  if (left === right) return 1

  const maxLength = Math.max(left.length, right.length)
  return maxLength ? 1 - levenshtein(left, right) / maxLength : 0
}

function recordNames(record) {
  return [record.flowerName, record.core?.cultivar].filter(Boolean)
}

function bestRecordScore(excelName, record) {
  return Math.max(...recordNames(record).map((name) => similarity(excelName, name)), 0)
}

function matchRecord(excelName, targetRecords) {
  const normalizedExcelName = normalizeText(excelName)
  const exactMatches = targetRecords.filter((record) => recordNames(record).some((name) => normalizeText(name) === normalizedExcelName))
  if (exactMatches.length === 1) return { status: 'matched', record: exactMatches[0], score: 1, matchType: 'exact' }
  if (exactMatches.length > 1) return { status: 'ambiguous', matches: exactMatches.map((record) => ({ record, score: 1 })) }

  const scored = targetRecords
    .map((record) => ({ record, score: bestRecordScore(excelName, record) }))
    .filter((match) => match.score >= HIGH_CONFIDENCE_SCORE)
    .sort((a, b) => b.score - a.score)

  if (!scored.length) return { status: 'unmatched' }
  if (scored.length > 1 && scored[0].score - scored[1].score <= AMBIGUOUS_MARGIN) return { status: 'ambiguous', matches: scored.slice(0, 5) }

  return { status: 'matched', record: scored[0].record, score: scored[0].score, matchType: 'fuzzy' }
}

function findPriorSeasonMatches(excelName, records) {
  return records
    .filter((record) => record.seasonYearStart !== TARGET_SEASON && bestRecordScore(excelName, record) >= HIGH_CONFIDENCE_SCORE)
    .sort((a, b) => Number(b.seasonYearStart ?? 0) - Number(a.seasonYearStart ?? 0))
    .slice(0, 5)
    .map((record) => ({ id: record.id, flowerName: record.flowerName, cultivar: record.core?.cultivar, seasonYearStart: record.seasonYearStart }))
}

function parseExcelLocations(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []

  const sheet = workbook.Sheets[sheetName]
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1')
  const groups = []

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    if (normalizeText(cellText(sheet, 0, column)) !== 'row') continue

    const rowDesignation = cellText(sheet, 1, column).toUpperCase()
    const gardenArea = gardenAreaForRow(rowDesignation)
    if (!rowDesignation || !gardenArea) continue

    groups.push({ rowDesignation, gardenArea, rowColumn: column })
  }

  const entries = []
  const seen = new Set()

  for (const group of groups) {
    const candidates = [
      { positionColumn: group.rowColumn - 1, nameColumn: group.rowColumn - 3 },
      { positionColumn: group.rowColumn + 1, nameColumn: group.rowColumn + 3 },
    ]

    for (let row = 2; row <= range.e.r; row += 1) {
      for (const candidate of candidates) {
        if (candidate.positionColumn < range.s.c || candidate.nameColumn < range.s.c || candidate.nameColumn > range.e.c) continue

        const position = cellNumber(sheet, row, candidate.positionColumn)
        const flowerName = cellText(sheet, row, candidate.nameColumn)
        if (!position && !flowerName) continue

        const key = `${group.rowDesignation}|${position}|${flowerName}`
        if (seen.has(key)) continue
        seen.add(key)

        entries.push({
          excelName: flowerName,
          gardenArea: group.gardenArea,
          gardenRow: group.rowDesignation,
          gardenPosition: position,
          gardenLocation: position ? `${group.rowDesignation}${position}` : group.rowDesignation,
          spreadsheetRow: row + 1,
        })
      }
    }
  }

  return entries.filter((entry) => entry.excelName && entry.gardenPosition)
}

function summaryCounts(result) {
  return {
    extractedCount: result.extracted.length,
    updatedCount: result.updated.length,
    unmatchedCount: result.unmatched.length,
    ambiguousCount: result.ambiguous.length,
    priorSeasonMissingCount: result.priorSeasonMissing.length,
    skippedCount: result.skipped.length,
  }
}

export async function importExcelLocations(buffer, { records, updateRecord }) {
  const extracted = parseExcelLocations(buffer)
  const targetRecords = records.filter((record) => record.seasonYearStart === TARGET_SEASON)
  const result = {
    extracted,
    updated: [],
    unmatched: [],
    ambiguous: [],
    priorSeasonMissing: [],
    skipped: [],
  }

  const updatedRecordIds = new Set()
  const assignedLocations = new Map()

  for (const record of records) {
    if (record.seasonYearStart !== TARGET_SEASON || record.meta?.plantingState !== 'in_garden') continue
    const key = record.meta?.gardenRow && record.meta?.gardenPosition ? `${record.meta.gardenRow}${record.meta.gardenPosition}` : undefined
    if (key) assignedLocations.set(key, record)
  }

  const rollbackEntries = []

  for (const entry of extracted) {
    const match = matchRecord(entry.excelName, targetRecords)
    if (match.status === 'ambiguous') {
      result.ambiguous.push({
        ...entry,
        matches: match.matches.map(({ record, score }) => ({ id: record.id, flowerName: record.flowerName, cultivar: record.core?.cultivar, score })),
      })
      continue
    }

    if (match.status === 'unmatched') {
      const priorSeasonMatches = findPriorSeasonMatches(entry.excelName, records)
      if (priorSeasonMatches.length) result.priorSeasonMissing.push({ ...entry, priorSeasonMatches })
      else result.unmatched.push(entry)
      continue
    }

    const existingAtLocation = assignedLocations.get(entry.gardenLocation)
    if (existingAtLocation && existingAtLocation.id !== match.record.id) {
      result.skipped.push({
        ...entry,
        reason: `Location ${entry.gardenLocation} is already assigned to ${existingAtLocation.flowerName}.`,
        matchedRecord: { id: match.record.id, flowerName: match.record.flowerName, cultivar: match.record.core?.cultivar },
      })
      continue
    }

    if (updatedRecordIds.has(match.record.id)) {
      result.skipped.push({
        ...entry,
        reason: `${match.record.flowerName} was already matched to another Excel location.`,
        matchedRecord: { id: match.record.id, flowerName: match.record.flowerName, cultivar: match.record.core?.cultivar },
      })
      continue
    }

    const nextLocation = {
      gardenLocation: entry.gardenLocation,
      meta: {
        plantingState: 'in_garden',
        gardenArea: entry.gardenArea,
        gardenRow: entry.gardenRow,
        gardenPosition: entry.gardenPosition,
      },
    }
    rollbackEntries.push(excelImportRollbackEntry(match.record, nextLocation))

    const updatedRecord = await updateRecord(match.record.id, {
      ...match.record,
      gardenLocation: nextLocation.gardenLocation,
      meta: {
        ...(match.record.meta ?? {}),
        ...nextLocation.meta,
      },
    })

    result.updated.push({
      excelName: entry.excelName,
      gardenLocation: entry.gardenLocation,
      gardenArea: entry.gardenArea,
      recordId: match.record.id,
      flowerName: match.record.flowerName,
      cultivar: match.record.core?.cultivar,
      matchType: match.matchType,
      score: match.score,
    })
    updatedRecordIds.add(match.record.id)
    assignedLocations.set(entry.gardenLocation, updatedRecord ?? match.record)
  }

  return { ...result, rollbackEntries, counts: summaryCounts(result) }
}
