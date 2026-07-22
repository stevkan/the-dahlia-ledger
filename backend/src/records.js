import crypto from 'node:crypto'

import { query, withTransaction } from './db.js'
import { ensureEmbeddingsForRecord, deletePhotoEmbeddings } from './photoEmbeddings.js'

const ONENOTE_IMPORT_NOTE = 'Imported from OneNote MHT.'
const RECORD_SUMMARY_CACHE_TTL_MS = 30_000
const recordSummaryCache = new Map()
const LEGACY_UNASSIGNED_CHECK_TTL_MS = 5 * 60_000
let legacyUnassignedCache = null

const WRITABLE_COLUMNS = [
  'record_number', 'garden_id', 'flower_name', 'garden_location', 'season_year_start',
  'thumbnail_url', 'list_thumbnail_url', 'image_url', 'cultivar_thumbnail_url', 'cultivar_list_thumbnail_url', 'cultivar_image_url',
  'record_photos', 'cultivar_photos', 'default_record_photo_id', 'default_cultivar_photo_id', 'default_photo_scope',
  'core', 'growth', 'care', 'tuber', 'health', 'meta',
]

export const INSERT_RECORD_SQL = `INSERT INTO dahlia_records (id, ${WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`
const UPDATE_RECORD_SQL = `UPDATE dahlia_records SET ${WRITABLE_COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id`

const FULL_SELECT_COLUMNS = `
  id, record_number AS "recordNumber", garden_id AS "gardenId", flower_name AS "flowerName",
  garden_location AS "gardenLocation", season_year_start AS "seasonYearStart",
  thumbnail_url AS "thumbnailUrl", list_thumbnail_url AS "listThumbnailUrl", image_url AS "imageUrl",
  cultivar_thumbnail_url AS "cultivarThumbnailUrl", cultivar_list_thumbnail_url AS "cultivarListThumbnailUrl", cultivar_image_url AS "cultivarImageUrl",
  record_photos AS "recordPhotos", cultivar_photos AS "cultivarPhotos",
  default_record_photo_id AS "defaultRecordPhotoId", default_cultivar_photo_id AS "defaultCultivarPhotoId", default_photo_scope AS "defaultPhotoScope",
  core, growth, care, tuber, health, meta
`

const SUMMARY_SELECT_COLUMNS = `
  id, record_number AS "recordNumber", garden_id AS "gardenId", flower_name AS "flowerName",
  garden_location AS "gardenLocation", season_year_start AS "seasonYearStart",
  thumbnail_url AS "thumbnailUrl", list_thumbnail_url AS "listThumbnailUrl", image_url AS "imageUrl",
  cultivar_thumbnail_url AS "cultivarThumbnailUrl", cultivar_list_thumbnail_url AS "cultivarListThumbnailUrl", cultivar_image_url AS "cultivarImageUrl",
  default_photo_scope AS "defaultPhotoScope", core, growth, tuber, meta
`

export function recordToParams(record) {
  return [
    record.recordNumber,
    record.gardenId ?? null,
    record.flowerName,
    record.gardenLocation ?? null,
    record.seasonYearStart,
    record.thumbnailUrl ?? null,
    record.listThumbnailUrl ?? null,
    record.imageUrl ?? null,
    record.cultivarThumbnailUrl ?? null,
    record.cultivarListThumbnailUrl ?? null,
    record.cultivarImageUrl ?? null,
    JSON.stringify(record.recordPhotos ?? []),
    JSON.stringify(record.cultivarPhotos ?? []),
    record.defaultRecordPhotoId ?? null,
    record.defaultCultivarPhotoId ?? null,
    record.defaultPhotoScope ?? null,
    JSON.stringify(record.core ?? {}),
    JSON.stringify(record.growth ?? {}),
    JSON.stringify(record.care ?? {}),
    JSON.stringify(record.tuber ?? {}),
    JSON.stringify(record.health ?? {}),
    JSON.stringify(record.meta ?? {}),
  ]
}

function nowIso() {
  return new Date().toISOString()
}

function recordSummaryCacheKey(gardenId, options = {}) {
  return `${gardenId ?? 'all'}:${options.includeLegacyUnassigned ? 'legacy' : 'current'}`
}

function clearRecordSummaryCache() {
  recordSummaryCache.clear()
}

function syncPhotoEmbeddings(record) {
  void ensureEmbeddingsForRecord(record).catch((error) => {
    console.error(`Failed to ensure photo embeddings for record ${record?.id}:`, error)
  })
}

function photoImageUrls(record) {
  return new Set(
    [...(record?.recordPhotos ?? []), ...(record?.cultivarPhotos ?? [])]
      .map((photo) => photo?.imageUrl)
      .filter(Boolean),
  )
}

function pruneOrphanedPhotoEmbeddings(candidateUrls) {
  const urls = [...new Set(candidateUrls)].filter(Boolean)
  if (urls.length === 0) return

  void (async () => {
    const allRecords = await listRecords()
    const stillUsed = new Set()
    for (const record of allRecords) {
      for (const url of photoImageUrls(record)) stillUsed.add(url)
    }
    const orphaned = urls.filter((url) => !stillUsed.has(url))
    await deletePhotoEmbeddings(orphaned)
  })().catch((error) => {
    console.error('Failed to prune orphaned photo embeddings:', error)
  })
}

function getPlacement(record) {
  return {
    zone: record?.meta?.gardenZone ?? record?.meta?.gardenArea,
    rowOrBed: record?.meta?.rowOrBed ?? record?.meta?.gardenRow,
    position: record?.meta?.position ?? record?.meta?.gardenPosition,
  }
}

function getGardenKey(record) {
  if (record?.meta?.plantingState !== 'in_garden') return undefined

  const { zone, rowOrBed, position } = getPlacement(record)

  return rowOrBed && position ? `${zone ?? ''}|${rowOrBed}|${position}` : undefined
}

function normalizedValue(value) {
  return String(value ?? '').trim().toLowerCase()
}

function cultivarKey(record) {
  return normalizedValue(record?.core?.cultivar || record?.flowerName)
}

const NAME_STATUS_LABELS = {
  mystery: 'Mystery',
  unknown: 'Unknown',
  seedling: 'Seedling',
}

function withGeneratedName(input, recordNumber) {
  const label = NAME_STATUS_LABELS[input.meta?.nameStatus]
  if (!label) return input

  const generatedName = `${label} - ${recordNumber}`
  return {
    ...input,
    flowerName: generatedName,
    core: { ...input.core, cultivar: generatedName },
  }
}

function flowerNameKey(record) {
  return normalizedValue(record?.flowerName)
}

function photoUrl(photo) {
  return photo?.thumbnailUrl || photo?.imageUrl
}

function listPhotoUrl(photo) {
  return photo?.listThumbnailUrl || photo?.thumbnailUrl || photo?.imageUrl
}

function uniquePhotos(photos) {
  const seen = new Set()
  return (photos ?? []).filter((photo) => {
    const key = photo?.imageUrl || photo?.id
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function defaultPhoto(photos, defaultId) {
  return photos.find((photo) => photo.id === defaultId) ?? photos[0]
}

export function withPhotoDefaults(record) {
  const recordPhotos = uniquePhotos(record.recordPhotos)
  const cultivarPhotos = uniquePhotos(record.cultivarPhotos)
  const recordDefault = defaultPhoto(recordPhotos, record.defaultRecordPhotoId)
  const cultivarDefault = defaultPhoto(cultivarPhotos, record.defaultCultivarPhotoId)

  return {
    ...record,
    recordPhotos,
    cultivarPhotos,
    defaultRecordPhotoId: recordDefault?.id,
    defaultCultivarPhotoId: cultivarDefault?.id,
    defaultPhotoScope: record.defaultPhotoScope === 'cultivar'
      ? (cultivarDefault ? 'cultivar' : recordDefault ? 'record' : undefined)
      : (recordDefault ? 'record' : cultivarDefault ? 'cultivar' : undefined),
    imageUrl: recordDefault ? recordDefault.imageUrl : record.imageUrl,
    thumbnailUrl: recordDefault ? photoUrl(recordDefault) : record.thumbnailUrl,
    listThumbnailUrl: recordDefault ? listPhotoUrl(recordDefault) : record.listThumbnailUrl,
    cultivarImageUrl: cultivarDefault ? cultivarDefault.imageUrl : record.cultivarImageUrl,
    cultivarThumbnailUrl: cultivarDefault ? photoUrl(cultivarDefault) : record.cultivarThumbnailUrl,
    cultivarListThumbnailUrl: cultivarDefault ? listPhotoUrl(cultivarDefault) : record.cultivarListThumbnailUrl,
  }
}

function isSamePhotoCultivar(record, target) {
  const targetKey = cultivarKey(target)
  if (!targetKey) return false
  if (cultivarKey(record) === targetKey) return true

  return targetKey === flowerNameKey(target) && flowerNameKey(record) === targetKey
}

function cleanCoreNotes(notes) {
  if (typeof notes !== 'string') return notes

  const cleaned = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== ONENOTE_IMPORT_NOTE)
    .join('\n')
    .trim()

  return cleaned || undefined
}

function cleanRecord(record) {
  const placement = record?.meta?.plantingState === 'in_garden' ? getPlacement(record) : {}
  return withPhotoDefaults({
    ...record,
    gardenLocation: record.meta?.plantingState === 'in_garden' ? record.gardenLocation || [placement.rowOrBed, placement.position].filter(Boolean).join('') : '',
    core: {
      ...(record.core ?? {}),
      notes: cleanCoreNotes(record.core?.notes),
    },
    meta: {
      ...(record.meta ?? {}),
      gardenZone: placement.zone,
      rowOrBed: placement.rowOrBed,
      position: placement.position,
    },
  })
}

export function toRecordSummary(record) {
  const placement = record?.meta?.plantingState === 'in_garden' ? getPlacement(record) : {}

  return {
    id: record.id,
    recordNumber: record.recordNumber,
    gardenId: record.gardenId,
    flowerName: record.flowerName,
    gardenLocation: record.gardenLocation,
    seasonYearStart: record.seasonYearStart,
    thumbnailUrl: record.thumbnailUrl,
    listThumbnailUrl: record.listThumbnailUrl,
    imageUrl: record.imageUrl,
    cultivarThumbnailUrl: record.cultivarThumbnailUrl,
    cultivarListThumbnailUrl: record.cultivarListThumbnailUrl,
    cultivarImageUrl: record.cultivarImageUrl,
    defaultPhotoScope: record.defaultPhotoScope,
    core: {
      color: record.core?.color,
      size: record.core?.size,
      cultivar: record.core?.cultivar,
      plantedDate: record.core?.plantedDate,
    },
    growth: {
      height: record.growth?.height,
    },
    tuber: {
      source: record.tuber?.source,
      linkedOrderItemIds: record.tuber?.linkedOrderItemIds,
    },
    meta: {
      gardenArea: placement.zone,
      gardenRow: placement.rowOrBed,
      gardenPosition: placement.position,
      gardenZone: placement.zone,
      rowOrBed: placement.rowOrBed,
      position: placement.position,
      plantingState: record.meta?.plantingState,
    },
  }
}

export async function hasLegacyUnassignedRecords() {
  if (legacyUnassignedCache && legacyUnassignedCache.expiresAt > Date.now()) {
    return legacyUnassignedCache.value
  }

  const { rows } = await query('SELECT EXISTS(SELECT 1 FROM dahlia_records WHERE garden_id IS NULL) AS "exists"')
  const value = rows[0].exists
  legacyUnassignedCache = { value, expiresAt: Date.now() + LEGACY_UNASSIGNED_CHECK_TTL_MS }
  return value
}

export async function listRecordSummaries(gardenId, options = {}) {
  const key = recordSummaryCacheKey(gardenId, options)
  const cached = recordSummaryCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  let rows
  if (gardenId) {
    const { rows: primary } = await query(`SELECT ${SUMMARY_SELECT_COLUMNS} FROM dahlia_records WHERE garden_id = $1 ORDER BY record_number ASC`, [gardenId])
    rows = primary
    if (options.includeLegacyUnassigned) {
      const { rows: legacy } = await query(`SELECT ${SUMMARY_SELECT_COLUMNS} FROM dahlia_records WHERE garden_id IS NULL ORDER BY record_number ASC`)
      rows = rows.concat(legacy)
    }
  } else {
    const { rows: all } = await query(`SELECT ${SUMMARY_SELECT_COLUMNS} FROM dahlia_records ORDER BY record_number ASC`)
    rows = all
  }

  const value = rows
    .map((row) => toRecordSummary({ ...row, gardenId: row.gardenId ?? (options.includeLegacyUnassigned ? gardenId : undefined) }))
    .sort((a, b) => a.recordNumber - b.recordNumber)

  recordSummaryCache.set(key, { value, expiresAt: Date.now() + RECORD_SUMMARY_CACHE_TTL_MS })
  return value
}

async function findGardenLocationConflict(input, excludeId, gardenId) {
  const inputKey = getGardenKey(input)
  if (!inputKey) return null

  const records = await listRecords(gardenId)
  return records.find((record) => record.id !== excludeId && (record.gardenId ?? gardenId) === gardenId && record.seasonYearStart === input.seasonYearStart && getGardenKey(record) === inputKey) ?? null
}

function normalizeRecordText(input) {
  return {
    ...input,
    flowerName: String(input.flowerName ?? '').trim(),
    core: {
      ...(input.core ?? {}),
      cultivar: input.core?.cultivar ? String(input.core.cultivar).trim() : input.core?.cultivar,
      color: input.core?.color ? String(input.core.color).trim() : input.core?.color,
      notes: cleanCoreNotes(input.core?.notes),
    },
  }
}

export async function listRecords(gardenId, options = {}) {
  let rows
  if (gardenId) {
    const { rows: primary } = await query(`SELECT ${FULL_SELECT_COLUMNS} FROM dahlia_records WHERE garden_id = $1 ORDER BY record_number ASC`, [gardenId])
    rows = primary
    if (options.includeLegacyUnassigned) {
      const { rows: legacy } = await query(`SELECT ${FULL_SELECT_COLUMNS} FROM dahlia_records WHERE garden_id IS NULL ORDER BY record_number ASC`)
      rows = rows.concat(legacy)
    }
  } else {
    const { rows: all } = await query(`SELECT ${FULL_SELECT_COLUMNS} FROM dahlia_records ORDER BY record_number ASC`)
    rows = all
  }

  return rows
    .map((record) => cleanRecord({ ...record, gardenId: record.gardenId ?? (options.includeLegacyUnassigned ? gardenId : undefined) }))
    .sort((a, b) => a.recordNumber - b.recordNumber)
}

export async function listRecordsPage(gardenId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 250)
  const startAfter = Number(options.startAfter)
  const hasCursor = Number.isFinite(startAfter)

  const conditions = []
  const params = []
  if (gardenId) {
    params.push(gardenId)
    conditions.push(`garden_id = $${params.length}`)
  }
  if (hasCursor) {
    params.push(startAfter)
    conditions.push(`record_number > $${params.length}`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(limit + 1)
  const sql = `SELECT ${FULL_SELECT_COLUMNS} FROM dahlia_records ${where} ORDER BY record_number ASC LIMIT $${params.length}`

  const { rows } = await query(sql, params)
  const pageRows = rows.slice(0, limit)
  const records = pageRows.map((record) => cleanRecord({ ...record, gardenId: record.gardenId ?? (options.includeLegacyUnassigned ? gardenId : undefined) }))

  return {
    records,
    nextCursor: rows.length > limit ? records.at(-1)?.recordNumber : undefined,
  }
}

export async function listRecordSummariesPage(gardenId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 250)
  const startAfter = Number(options.startAfter)
  const hasCursor = Number.isFinite(startAfter)

  const conditions = []
  const params = []
  if (gardenId) {
    params.push(gardenId)
    conditions.push(`garden_id = $${params.length}`)
  }
  if (hasCursor) {
    params.push(startAfter)
    conditions.push(`record_number > $${params.length}`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(limit + 1)
  const sql = `SELECT ${SUMMARY_SELECT_COLUMNS} FROM dahlia_records ${where} ORDER BY record_number ASC LIMIT $${params.length}`

  const { rows } = await query(sql, params)
  const pageRows = rows.slice(0, limit)
  const records = pageRows.map((row) => toRecordSummary({ ...row, gardenId: row.gardenId ?? (options.includeLegacyUnassigned ? gardenId : undefined) }))

  return {
    records,
    nextCursor: rows.length > limit ? records.at(-1)?.recordNumber : undefined,
  }
}

export async function getRecord(id) {
  const { rows } = await query(`SELECT ${FULL_SELECT_COLUMNS} FROM dahlia_records WHERE id = $1`, [id])
  if (rows.length === 0) return null
  return cleanRecord(rows[0])
}

export async function createRecord(input, gardenId) {
  const normalizedInput = normalizeRecordText(input)
  const conflict = await findGardenLocationConflict(normalizedInput, undefined, gardenId)
  if (conflict) {
    const error = new Error('Garden location is already assigned to another record.')
    error.code = 'garden_location_conflict'
    throw error
  }

  const timestamp = nowIso()
  const id = crypto.randomUUID()

  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [gardenId ?? ''])
    const { rows } = await client.query('SELECT COALESCE(MAX(record_number), 0) + 1 AS next FROM dahlia_records WHERE garden_id = $1', [gardenId])
    const recordNumber = Number(rows[0].next)
    const namedInput = withGeneratedName(normalizedInput, recordNumber)
    const base = {
      ...withPhotoDefaults(namedInput),
      gardenId,
      recordNumber,
      thumbnailUrl: namedInput.thumbnailUrl || undefined,
      imageUrl: namedInput.imageUrl || undefined,
      cultivarThumbnailUrl: namedInput.cultivarThumbnailUrl || undefined,
      cultivarImageUrl: namedInput.cultivarImageUrl || undefined,
      meta: {
        ...(namedInput.meta ?? {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    }
    await client.query(INSERT_RECORD_SQL, [id, ...recordToParams(base)])
  })

  clearRecordSummaryCache()
  const record = await getRecord(id)
  syncPhotoEmbeddings(record)
  return record
}

export async function updateRecord(id, input, gardenId) {
  const existing = await getRecord(id)
  if (!existing) return null

  const normalizedInput = normalizeRecordText(input)
  const namedInput = withGeneratedName(normalizedInput, existing.recordNumber)
  const targetGardenId = gardenId ?? existing.gardenId
  const conflict = await findGardenLocationConflict(namedInput, id, targetGardenId)
  if (conflict) {
    const error = new Error('Garden location is already assigned to another record.')
    error.code = 'garden_location_conflict'
    throw error
  }

  let adjustedInput = namedInput
  const oldKey = cultivarKey(existing)
  const newKey = cultivarKey(namedInput)
  if (oldKey !== newKey) {
    const gardenRecords = await listRecords(targetGardenId)
    const donor = gardenRecords.find((r) => r.id !== id && cultivarKey(r) === newKey && r.cultivarPhotos?.length)
    const oldKeyRetainedElsewhere = gardenRecords.some((r) => r.id !== id && cultivarKey(r) === oldKey)
    const newCultivarPhotos = donor
      ? uniquePhotos([...(existing.cultivarPhotos ?? []), ...donor.cultivarPhotos])
      : oldKeyRetainedElsewhere
        ? []
        : uniquePhotos(existing.cultivarPhotos)
    const byAge = (a, b) => (a.createdAt ?? 'z').localeCompare(b.createdAt ?? 'z')
    const userPick = newCultivarPhotos.find((p) => p.id === namedInput.defaultCultivarPhotoId)
    const oldestPhoto = newCultivarPhotos.length > 0 ? [...newCultivarPhotos].sort(byAge)[0] : undefined
    const newDefault = userPick ?? oldestPhoto
    adjustedInput = {
      ...namedInput,
      cultivarPhotos: newCultivarPhotos,
      defaultCultivarPhotoId: newDefault?.id,
      defaultPhotoScope: newDefault ? 'cultivar' : namedInput.defaultPhotoScope === 'cultivar' ? undefined : namedInput.defaultPhotoScope,
      cultivarImageUrl: undefined,
      cultivarThumbnailUrl: undefined,
    }
  }

  const next = {
    ...existing,
    ...withPhotoDefaults(adjustedInput),
    gardenId: targetGardenId,
    id: undefined,
    recordNumber: existing.recordNumber,
    meta: {
      ...(existing.meta ?? {}),
      ...(namedInput.meta ?? {}),
      createdAt: existing.meta?.createdAt ?? namedInput.meta?.createdAt,
      updatedAt: nowIso(),
    },
  }

  await query(UPDATE_RECORD_SQL, [id, ...recordToParams(next)])
  clearRecordSummaryCache()
  const record = await getRecord(id)
  syncPhotoEmbeddings(record)
  const removedUrls = [...photoImageUrls(existing)].filter((url) => !photoImageUrls(record).has(url))
  pruneOrphanedPhotoEmbeddings(removedUrls)
  return record
}

export async function updateCultivarPhoto(id, { cultivarImageUrl, cultivarThumbnailUrl, photo: inputPhoto }) {
  const source = await getRecord(id)
  if (!source) return null

  const timestamp = nowIso()
  const sharedThumbnailUrl = cultivarThumbnailUrl || cultivarImageUrl
  const photo = inputPhoto ?? {
    id: `cultivar-${Date.now()}`,
    imageUrl: cultivarImageUrl,
    thumbnailUrl: sharedThumbnailUrl,
    scope: 'cultivar',
    createdAt: timestamp,
  }
  const records = await listRecords()
  const matchedRecords = records.filter((record) => isSamePhotoCultivar(record, source))

  await withTransaction(async (client) => {
    for (const record of matchedRecords) {
      const { id: recordId, ...recordData } = record
      const next = {
        ...withPhotoDefaults({
          ...recordData,
          cultivarPhotos: uniquePhotos([photo, ...(record.cultivarPhotos ?? [])]),
          defaultCultivarPhotoId: record.defaultCultivarPhotoId || photo.id,
        }),
        meta: { ...(record.meta ?? {}), updatedAt: timestamp },
      }
      await client.query(UPDATE_RECORD_SQL, [recordId, ...recordToParams(next)])
    }
  })

  const updatedRecords = await Promise.all(matchedRecords.map((record) => getRecord(record.id)))
  clearRecordSummaryCache()
  syncPhotoEmbeddings(updatedRecords.filter(Boolean)[0])
  return {
    updatedCount: matchedRecords.length,
    records: updatedRecords.filter(Boolean),
  }
}

export async function updateCultivarPhotoDefault(id, { photo }) {
  const source = await getRecord(id)
  if (!source) return null

  const timestamp = nowIso()
  const records = await listRecords()
  const matchedRecords = records.filter((record) => isSamePhotoCultivar(record, source))

  await withTransaction(async (client) => {
    for (const record of matchedRecords) {
      const { id: recordId, ...recordData } = record
      const existingPhoto = record.cultivarPhotos?.find((candidate) => candidate.imageUrl === photo.imageUrl)
      const defaultCultivarPhoto = existingPhoto ?? { ...photo, id: `cultivar-${Date.now()}-${recordId}` }
      const next = {
        ...withPhotoDefaults({
          ...recordData,
          cultivarPhotos: uniquePhotos([defaultCultivarPhoto, ...(record.cultivarPhotos ?? [])]),
          defaultCultivarPhotoId: defaultCultivarPhoto.id,
          defaultPhotoScope: 'cultivar',
        }),
        meta: { ...(record.meta ?? {}), updatedAt: timestamp },
      }
      await client.query(UPDATE_RECORD_SQL, [recordId, ...recordToParams(next)])
    }
  })

  const updatedRecords = await Promise.all(matchedRecords.map((record) => getRecord(record.id)))
  clearRecordSummaryCache()
  return {
    updatedCount: matchedRecords.length,
    records: updatedRecords.filter(Boolean),
  }
}

export async function updateRecordPhotoDefault(id, { photo }) {
  const existing = await getRecord(id)
  if (!existing) return null

  const timestamp = nowIso()
  const existingPhoto = existing.recordPhotos?.find((candidate) => candidate.imageUrl === photo.imageUrl)
  const defaultRecordPhoto = existingPhoto ?? { ...photo, id: `record-${Date.now()}` }
  const { id: _id, ...recordData } = existing

  const next = {
    ...withPhotoDefaults({
      ...recordData,
      recordPhotos: uniquePhotos([defaultRecordPhoto, ...(existing.recordPhotos ?? [])]),
      defaultRecordPhotoId: defaultRecordPhoto.id,
      defaultPhotoScope: 'record',
    }),
    meta: { ...(existing.meta ?? {}), updatedAt: timestamp },
  }

  await query(UPDATE_RECORD_SQL, [id, ...recordToParams(next)])
  clearRecordSummaryCache()
  const updatedRecord = await getRecord(id)
  return {
    record: updatedRecord,
  }
}

export async function deleteCultivarPhoto(id, { imageUrl }) {
  const source = await getRecord(id)
  if (!source) return null

  const timestamp = nowIso()
  const records = await listRecords()
  const matchedRecords = records.filter((record) => isSamePhotoCultivar(record, source))

  await withTransaction(async (client) => {
    for (const record of matchedRecords) {
      const { id: recordId, ...recordData } = record
      const cultivarPhotos = (record.cultivarPhotos ?? []).filter((photo) => photo.imageUrl !== imageUrl)
      const currentDefault = record.cultivarPhotos?.find((photo) => photo.id === record.defaultCultivarPhotoId)
      const defaultCultivarPhotoId = currentDefault?.imageUrl === imageUrl ? cultivarPhotos[0]?.id : record.defaultCultivarPhotoId

      const next = {
        ...withPhotoDefaults({
          ...recordData,
          cultivarPhotos,
          defaultCultivarPhotoId,
          cultivarImageUrl: record.cultivarImageUrl === imageUrl ? undefined : record.cultivarImageUrl,
          cultivarThumbnailUrl: record.cultivarImageUrl === imageUrl ? undefined : record.cultivarThumbnailUrl,
        }),
        meta: { ...(record.meta ?? {}), updatedAt: timestamp },
      }
      await client.query(UPDATE_RECORD_SQL, [recordId, ...recordToParams(next)])
    }
  })

  const updatedRecords = await Promise.all(matchedRecords.map((record) => getRecord(record.id)))
  clearRecordSummaryCache()
  pruneOrphanedPhotoEmbeddings([imageUrl])
  return {
    updatedCount: matchedRecords.length,
    records: updatedRecords.filter(Boolean),
  }
}

export async function deleteRecord(id) {
  const existing = await getRecord(id)
  await query('DELETE FROM dahlia_records WHERE id = $1', [id])
  clearRecordSummaryCache()
  if (existing) pruneOrphanedPhotoEmbeddings([...photoImageUrls(existing)])
  return true
}

const DRIFT_FIELDS = [
  ['flowerName', (s) => s.flowerName],
  ['gardenLocation', (s) => s.gardenLocation],
  ['core.color', (s) => s.core?.color],
  ['core.size', (s) => s.core?.size],
  ['core.cultivar', (s) => s.core?.cultivar],
  ['core.plantedDate', (s) => s.core?.plantedDate],
  ['growth.height', (s) => s.growth?.height],
  ['tuber.source', (s) => s.tuber?.source],
  ['meta.plantingState', (s) => s.meta?.plantingState],
  ['meta.gardenZone', (s) => s.meta?.gardenZone],
  ['meta.rowOrBed', (s) => s.meta?.rowOrBed],
  ['meta.position', (s) => s.meta?.position],
  ['thumbnailUrl', (s) => s.thumbnailUrl],
  ['imageUrl', (s) => s.imageUrl],
  ['cultivarThumbnailUrl', (s) => s.cultivarThumbnailUrl],
  ['cultivarImageUrl', (s) => s.cultivarImageUrl],
]

const URL_DRIFT_FIELD_PATHS = new Set(['thumbnailUrl', 'imageUrl', 'cultivarThumbnailUrl', 'cultivarImageUrl'])

// The Firestore->Postgres photo migration re-hosts each blob (Firebase Storage -> Azure Blob) but
// keeps its filename/id unchanged, so a photo URL that only changed host+encoding isn't a real
// data disagreement to check against the garden — it's just the migration doing its job. Compare
// by decoded basename for URL fields so those don't get reported as drift.
function photoUrlBaseName(rawUrl) {
  if (!rawUrl) return undefined
  try {
    const url = new URL(rawUrl)
    const segments = decodeURIComponent(url.pathname).split('/').filter(Boolean)
    return segments.at(-1)
  } catch {
    return undefined
  }
}

function driftValuesEqual(path, a, b) {
  if (URL_DRIFT_FIELD_PATHS.has(path)) {
    const aName = photoUrlBaseName(a)
    const bName = photoUrlBaseName(b)
    if (aName && bName) return aName === bName
  }
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return (a ?? null) === (b ?? null)
}

// Diffs the frozen dahlia_record_summaries_snapshot (ported verbatim, unreconciled, during the
// Postgres migration) against live dahlia_records, so a drifted record can be manually checked
// against the physical garden before anyone decides which value was actually correct.
export async function listRecordDrift() {
  const { rows: snapshotRows } = await query(`
    SELECT id, record_number AS "recordNumber", garden_id AS "gardenId", flower_name AS "flowerName",
      garden_location AS "gardenLocation", thumbnail_url AS "thumbnailUrl", image_url AS "imageUrl",
      cultivar_thumbnail_url AS "cultivarThumbnailUrl", cultivar_image_url AS "cultivarImageUrl",
      core, growth, tuber, meta
    FROM dahlia_record_summaries_snapshot
    WHERE reviewed_at IS NULL
  `)
  const liveRecords = await listRecords()
  const liveById = new Map(liveRecords.map((record) => [record.id, record]))

  const drift = []
  const missingLive = []
  for (const snapshotRow of snapshotRows) {
    const liveRecord = liveById.get(snapshotRow.id)
    if (!liveRecord) {
      missingLive.push({ id: snapshotRow.id, recordNumber: snapshotRow.recordNumber, flowerName: snapshotRow.flowerName })
      continue
    }

    const liveSummary = toRecordSummary(liveRecord)
    const fields = DRIFT_FIELDS
      .map(([path, getter]) => ({ path, snapshotValue: getter(snapshotRow) ?? null, liveValue: getter(liveSummary) ?? null }))
      .filter((field) => !driftValuesEqual(field.path, field.snapshotValue, field.liveValue))

    if (fields.length > 0) {
      drift.push({
        id: snapshotRow.id,
        recordNumber: liveSummary.recordNumber,
        gardenId: liveSummary.gardenId,
        flowerName: liveSummary.flowerName,
        gardenLocation: liveSummary.gardenLocation,
        meta: liveSummary.meta,
        fields,
      })
    }
    liveById.delete(snapshotRow.id)
  }

  const missingSnapshot = [...liveById.values()].map((record) => ({ id: record.id, recordNumber: record.recordNumber, flowerName: record.flowerName }))

  return { drift, missingLive, missingSnapshot }
}

export async function markRecordDriftReviewed(id) {
  const { rowCount } = await query('UPDATE dahlia_record_summaries_snapshot SET reviewed_at = now() WHERE id = $1', [id])
  return rowCount > 0
}
