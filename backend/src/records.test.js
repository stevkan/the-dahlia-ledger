import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import './env.js'
import { getPool } from './db.js'
import {
  createRecord,
  deleteRecord,
  getRecord,
  listRecordDrift,
  listRecords,
  listRecordSummaries,
  markRecordDriftReviewed,
  updateRecord,
  updateRecordPhotoDefault,
} from './records.js'

const GARDEN_ID = 'vitest-garden'
const TEST_GARDEN_IDS = [GARDEN_ID, 'other-garden']
const pool = getPool()

// Scoped to this suite's own garden ids on purpose — never a blanket DELETE. Whatever database
// DATABASE_URL points at may hold real migrated data, not just test fixtures.
async function cleanUpTestData() {
  await pool.query('DELETE FROM dahlia_records WHERE garden_id = ANY($1)', [TEST_GARDEN_IDS])
  await pool.query('DELETE FROM dahlia_record_summaries_snapshot WHERE garden_id = ANY($1)', [TEST_GARDEN_IDS])
}

beforeEach(cleanUpTestData)

afterAll(async () => {
  await cleanUpTestData()
  await pool.end()
})

describe('records.js (Postgres)', () => {
  it('creates a record, assigns a record number, and derives gardenLocation while in_garden', async () => {
    const record = await createRecord({
      flowerName: 'Café Au Lait',
      seasonYearStart: 2026,
      core: { cultivar: 'Cafe Au Lait', color: 'Blush' },
      meta: { plantingState: 'in_garden', gardenZone: 'A', rowOrBed: 'Row 1', position: 3 },
    }, GARDEN_ID)

    expect(record.recordNumber).toBe(1)
    expect(record.gardenLocation).toBe('Row 13')
    expect(record.gardenId).toBe(GARDEN_ID)
  })

  it('assigns sequential record numbers per garden', async () => {
    const first = await createRecord({ flowerName: 'A', seasonYearStart: 2026 }, GARDEN_ID)
    const second = await createRecord({ flowerName: 'B', seasonYearStart: 2026 }, GARDEN_ID)
    const otherGarden = await createRecord({ flowerName: 'C', seasonYearStart: 2026 }, 'other-garden')

    expect(first.recordNumber).toBe(1)
    expect(second.recordNumber).toBe(2)
    expect(otherGarden.recordNumber).toBe(1)
  })

  it('updates a record in place without touching its record number', async () => {
    const created = await createRecord({ flowerName: 'Original', seasonYearStart: 2026, core: { color: 'White' } }, GARDEN_ID)
    const updated = await updateRecord(created.id, { ...created, flowerName: 'Renamed', core: { ...created.core, color: 'Pink' } }, GARDEN_ID)

    expect(updated.flowerName).toBe('Renamed')
    expect(updated.core.color).toBe('Pink')
    expect(updated.recordNumber).toBe(created.recordNumber)
  })

  it('rejects a duplicate in-garden location within the same season', async () => {
    await createRecord({
      flowerName: 'First',
      seasonYearStart: 2026,
      meta: { plantingState: 'in_garden', rowOrBed: 'Row 1', position: 1 },
    }, GARDEN_ID)

    await expect(createRecord({
      flowerName: 'Second',
      seasonYearStart: 2026,
      meta: { plantingState: 'in_garden', rowOrBed: 'Row 1', position: 1 },
    }, GARDEN_ID)).rejects.toMatchObject({ code: 'garden_location_conflict' })
  })

  it('lists records and summaries projected from the same source, and both reflect writes immediately', async () => {
    await createRecord({ flowerName: 'Listed', seasonYearStart: 2026, core: { color: 'Yellow' } }, GARDEN_ID)

    const records = await listRecords(GARDEN_ID)
    const summaries = await listRecordSummaries(GARDEN_ID)

    expect(records).toHaveLength(1)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].core.color).toBe('Yellow')
  })

  it('applies a record photo default and updates the top-level thumbnail/image fields', async () => {
    const created = await createRecord({ flowerName: 'Photo Test', seasonYearStart: 2026 }, GARDEN_ID)
    const { record } = await updateRecordPhotoDefault(created.id, {
      photo: { id: 'p1', imageUrl: 'https://example.com/full.jpg', thumbnailUrl: 'https://example.com/thumb.jpg', scope: 'record', createdAt: new Date().toISOString() },
    })

    expect(record.imageUrl).toBe('https://example.com/full.jpg')
    expect(record.thumbnailUrl).toBe('https://example.com/thumb.jpg')
    expect(record.defaultPhotoScope).toBe('record')
  })

  it('deletes a record', async () => {
    const created = await createRecord({ flowerName: 'To Delete', seasonYearStart: 2026 }, GARDEN_ID)
    await deleteRecord(created.id)

    expect(await getRecord(created.id)).toBeNull()
  })

  it('surfaces drift between a frozen snapshot row and the live record, then clears it once reviewed', async () => {
    const created = await createRecord({
      flowerName: 'Drifted',
      seasonYearStart: 2026,
      core: { color: 'Blush' },
    }, GARDEN_ID)
    await updateRecord(created.id, { ...created, core: { ...created.core, color: 'Deep Pink' } }, GARDEN_ID)

    await pool.query(
      `INSERT INTO dahlia_record_summaries_snapshot (id, record_number, garden_id, flower_name, garden_location, core, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [created.id, created.recordNumber, GARDEN_ID, created.flowerName, created.gardenLocation, JSON.stringify({ color: 'Blush' }), JSON.stringify({})],
    )

    const { drift } = await listRecordDrift()
    const entry = drift.find((candidate) => candidate.id === created.id)
    expect(entry).toBeDefined()
    expect(entry.fields).toContainEqual({ path: 'core.color', snapshotValue: 'Blush', liveValue: 'Deep Pink' })

    await markRecordDriftReviewed(created.id)
    const afterReview = await listRecordDrift()
    expect(afterReview.drift.find((candidate) => candidate.id === created.id)).toBeUndefined()
  })

  it('does not report photo-URL drift when the snapshot and live URLs point at the same migrated blob', async () => {
    const created = await createRecord({ flowerName: 'Rehosted Photo', seasonYearStart: 2026 }, GARDEN_ID)
    const { record: withPhoto } = await updateRecordPhotoDefault(created.id, {
      photo: {
        id: 'p1',
        imageUrl: 'https://botberg81bd.blob.core.windows.net/dahlia-photos/originals/abc-123.jpg',
        thumbnailUrl: 'https://botberg81bd.blob.core.windows.net/dahlia-photos/thumbnails/abc-123.webp',
        scope: 'record',
        createdAt: new Date().toISOString(),
      },
    })

    await pool.query(
      `INSERT INTO dahlia_record_summaries_snapshot (id, record_number, garden_id, flower_name, garden_location, thumbnail_url, image_url, core, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        withPhoto.id, withPhoto.recordNumber, GARDEN_ID, withPhoto.flowerName, withPhoto.gardenLocation,
        'https://storage.googleapis.com/dahlia-tracker-1dfcb.firebasestorage.app/dahlia-photos%2Fthumbnails%2Fabc-123.webp',
        'https://storage.googleapis.com/dahlia-tracker-1dfcb.firebasestorage.app/dahlia-photos%2Foriginals%2Fabc-123.jpg',
        JSON.stringify({}), JSON.stringify({}),
      ],
    )

    const { drift } = await listRecordDrift()
    expect(drift.find((entry) => entry.id === withPhoto.id)).toBeUndefined()
  })

  it('still reports photo-URL drift when the underlying blob actually differs', async () => {
    const created = await createRecord({ flowerName: 'Actually Different Photo', seasonYearStart: 2026 }, GARDEN_ID)
    const { record: withPhoto } = await updateRecordPhotoDefault(created.id, {
      photo: {
        id: 'p1',
        imageUrl: 'https://botberg81bd.blob.core.windows.net/dahlia-photos/originals/new-photo.jpg',
        thumbnailUrl: 'https://botberg81bd.blob.core.windows.net/dahlia-photos/thumbnails/new-photo.webp',
        scope: 'record',
        createdAt: new Date().toISOString(),
      },
    })

    await pool.query(
      `INSERT INTO dahlia_record_summaries_snapshot (id, record_number, garden_id, flower_name, garden_location, thumbnail_url, core, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        withPhoto.id, withPhoto.recordNumber, GARDEN_ID, withPhoto.flowerName, withPhoto.gardenLocation,
        'https://storage.googleapis.com/dahlia-tracker-1dfcb.firebasestorage.app/dahlia-photos%2Fthumbnails%2Fold-photo.webp',
        JSON.stringify({}), JSON.stringify({}),
      ],
    )

    const { drift } = await listRecordDrift()
    const entry = drift.find((candidate) => candidate.id === withPhoto.id)
    expect(entry).toBeDefined()
    expect(entry.fields).toContainEqual({
      path: 'thumbnailUrl',
      snapshotValue: 'https://storage.googleapis.com/dahlia-tracker-1dfcb.firebasestorage.app/dahlia-photos%2Fthumbnails%2Fold-photo.webp',
      liveValue: 'https://botberg81bd.blob.core.windows.net/dahlia-photos/thumbnails/new-photo.webp',
    })
  })
})
