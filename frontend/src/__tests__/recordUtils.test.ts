import { describe, it, expect } from 'vitest'
import { patchRecords, patchRecordSummaries, recordToSummary } from '../recordUtils'
import type { DahliaRecord, DahliaRecordSummary } from '../types'
import type { InfiniteRecordsData } from '../recordUtils'

function makeRecord(id: string, overrides: Partial<DahliaRecord> = {}): DahliaRecord {
  return {
    id,
    recordNumber: 1,
    gardenId: 'garden-1',
    flowerName: 'Test Dahlia',
    gardenLocation: '',
    seasonYearStart: 2025,
    core: {},
    growth: {},
    care: {},
    tuber: {},
    health: {},
    meta: {},
    ...overrides,
  }
}

function makeSummary(id: string, overrides: Partial<DahliaRecordSummary> = {}): DahliaRecordSummary {
  return {
    id,
    recordNumber: 1,
    gardenId: 'garden-1',
    flowerName: 'Test Dahlia',
    gardenLocation: '',
    seasonYearStart: 2025,
    core: {},
    growth: {},
    tuber: {},
    meta: {},
    ...overrides,
  }
}

function makeInfiniteData(pages: DahliaRecordSummary[][]): InfiniteRecordsData<DahliaRecordSummary> {
  return {
    pages: pages.map((records) => ({ records })),
    pageParams: pages.map((_, i) => i),
  }
}

// ---------------------------------------------------------------------------
// patchRecords
// ---------------------------------------------------------------------------

describe('patchRecords', () => {
  it('returns undefined unchanged', () => {
    expect(patchRecords(undefined, [])).toBeUndefined()
  })

  it('returns the same array reference when changedRecords is empty', () => {
    const records = [makeRecord('a')]
    expect(patchRecords(records, [])).toBe(records)
  })

  it('returns the same array reference when no ids match', () => {
    const records = [makeRecord('a')]
    const changed = [makeRecord('b')]
    expect(patchRecords(records, changed)).toBe(records)
  })

  it('replaces a record with its updated version', () => {
    const original = makeRecord('a', { flowerName: 'Old' })
    const updated = makeRecord('a', { flowerName: 'New' })
    const result = patchRecords([original], [updated])
    expect(result).not.toBe([original])
    expect(result?.[0].flowerName).toBe('New')
  })

  it('only replaces records with matching ids, leaving others untouched', () => {
    const a = makeRecord('a')
    const b = makeRecord('b')
    const bUpdated = makeRecord('b', { flowerName: 'Updated B' })
    const result = patchRecords([a, b], [bUpdated])!
    expect(result[0]).toBe(a)
    expect(result[1].flowerName).toBe('Updated B')
  })

  it('replaces multiple records in a single pass', () => {
    const a = makeRecord('a', { flowerName: 'A' })
    const b = makeRecord('b', { flowerName: 'B' })
    const aNew = makeRecord('a', { flowerName: 'A2' })
    const bNew = makeRecord('b', { flowerName: 'B2' })
    const result = patchRecords([a, b], [aNew, bNew])!
    expect(result[0].flowerName).toBe('A2')
    expect(result[1].flowerName).toBe('B2')
  })
})

// ---------------------------------------------------------------------------
// patchRecordSummaries
// ---------------------------------------------------------------------------

describe('patchRecordSummaries', () => {
  it('returns undefined unchanged', () => {
    expect(patchRecordSummaries(undefined, [])).toBeUndefined()
  })

  it('returns the same data reference when both lists are empty', () => {
    const data = makeInfiniteData([[makeSummary('a')]])
    expect(patchRecordSummaries(data, [])).toBe(data)
  })

  it('replaces a summary in-place when a matching record is changed', () => {
    const existing = makeSummary('a', { flowerName: 'Old' })
    const data = makeInfiniteData([[existing]])
    const changed = makeRecord('a', { flowerName: 'New' })
    const result = patchRecordSummaries(data, [changed])!
    expect(result.pages[0].records[0].flowerName).toBe('New')
  })

  it('removes deleted records', () => {
    const data = makeInfiniteData([[makeSummary('a'), makeSummary('b')]])
    const result = patchRecordSummaries(data, [], ['b'])!
    expect(result.pages[0].records).toHaveLength(1)
    expect(result.pages[0].records[0].id).toBe('a')
  })

  it('inserts new records at the front of page 0', () => {
    const data = makeInfiniteData([[makeSummary('a')]])
    const newRecord = makeRecord('z')
    const result = patchRecordSummaries(data, [newRecord])!
    expect(result.pages[0].records[0].id).toBe('z')
    expect(result.pages[0].records[1].id).toBe('a')
  })

  it('does not insert a new record into pages beyond page 0', () => {
    const data = makeInfiniteData([[makeSummary('a')], [makeSummary('b')]])
    const newRecord = makeRecord('z')
    const result = patchRecordSummaries(data, [newRecord])!
    expect(result.pages[0].records.some((r) => r.id === 'z')).toBe(true)
    expect(result.pages[1].records.some((r) => r.id === 'z')).toBe(false)
  })

  it('replaces a record on a later page and also prepends it to page 0', () => {
    // The function processes pages in order: page 0 runs its "insert unseen" pass
    // before page 1 is visited, so a changed record that lives on page 1 gets
    // prepended to page 0 AND replaced in page 1.
    const data = makeInfiniteData([[makeSummary('a')], [makeSummary('b', { flowerName: 'Old' })]])
    const changed = makeRecord('b', { flowerName: 'New' })
    const result = patchRecordSummaries(data, [changed])!
    expect(result.pages[1].records[0].flowerName).toBe('New')
    expect(result.pages[0].records[0].id).toBe('b')
    expect(result.pages[0].records[0].flowerName).toBe('New')
  })

  it('returns the same data reference when nothing actually changed', () => {
    const data = makeInfiniteData([[makeSummary('a')]])
    expect(patchRecordSummaries(data, [], [])).toBe(data)
  })

  it('handles deletion and update together', () => {
    const data = makeInfiniteData([[makeSummary('a'), makeSummary('b'), makeSummary('c')]])
    const updated = makeRecord('a', { flowerName: 'A2' })
    const result = patchRecordSummaries(data, [updated], ['b'])!
    const page = result.pages[0].records
    expect(page).toHaveLength(2)
    expect(page.find((r) => r.id === 'a')?.flowerName).toBe('A2')
    expect(page.find((r) => r.id === 'b')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// recordToSummary
// ---------------------------------------------------------------------------

describe('recordToSummary', () => {
  it('projects the correct subset of fields', () => {
    const record = makeRecord('a', {
      flowerName: 'Bishop of Llandaff',
      core: { color: 'Red', size: 'Large', cultivar: 'Super', notes: 'test' },
      growth: { height: '4ft', bloomTime: 'Early', habit: 'Upright' },
      tuber: { source: 'Swan Island', linkedOrderItemIds: ['order-1'] },
      meta: { gardenArea: 'Zone A', plantingState: 'in_garden', gardenRow: 'Row 1', gardenPosition: 3, gardenZone: 'Z1', rowOrBed: 'Bed 1', position: 1 },
    })
    const summary = recordToSummary(record)

    expect(summary.id).toBe('a')
    expect(summary.flowerName).toBe('Bishop of Llandaff')
    expect(summary.core.color).toBe('Red')
    expect(summary.core.size).toBe('Large')
    expect((summary.core as { cultivar?: string }).cultivar).toBeUndefined()
    expect(summary.growth.height).toBe('4ft')
    expect((summary.growth as { bloomTime?: string }).bloomTime).toBeUndefined()
    expect(summary.tuber.source).toBe('Swan Island')
    expect(summary.tuber.linkedOrderItemIds).toEqual(['order-1'])
    expect(summary.meta.gardenArea).toBe('Zone A')
    expect(summary.meta.plantingState).toBe('in_garden')
  })
})
