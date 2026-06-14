import { getDb } from './firebase.js'
const COLLECTION = 'dahliaRecords'
const ONENOTE_IMPORT_NOTE = 'Imported from OneNote MHT.'

function nowIso() {
  return new Date().toISOString()
}

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v)]),
  )
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

function flowerNameKey(record) {
  return normalizedValue(record?.flowerName)
}

function photoUrl(photo) {
  return photo?.thumbnailUrl || photo?.imageUrl
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

function withPhotoDefaults(record) {
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
    defaultPhotoScope: record.defaultPhotoScope || (recordDefault ? 'record' : cultivarDefault ? 'cultivar' : undefined),
    imageUrl: recordDefault ? recordDefault.imageUrl : record.imageUrl,
    thumbnailUrl: recordDefault ? photoUrl(recordDefault) : record.thumbnailUrl,
    cultivarImageUrl: cultivarDefault ? cultivarDefault.imageUrl : record.cultivarImageUrl,
    cultivarThumbnailUrl: cultivarDefault ? photoUrl(cultivarDefault) : record.cultivarThumbnailUrl,
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
  const placement = getPlacement(record)
  return withPhotoDefaults({
    ...record,
    gardenLocation: record.gardenLocation || [placement.rowOrBed, placement.position].filter(Boolean).join(''),
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
  return {
    id: record.id,
    recordNumber: record.recordNumber,
    gardenId: record.gardenId,
    flowerName: record.flowerName,
    gardenLocation: record.gardenLocation,
    seasonYearStart: record.seasonYearStart,
    thumbnailUrl: record.thumbnailUrl,
    imageUrl: record.imageUrl,
    cultivarThumbnailUrl: record.cultivarThumbnailUrl,
    cultivarImageUrl: record.cultivarImageUrl,
    defaultPhotoScope: record.defaultPhotoScope,
    core: {
      color: record.core?.color,
      size: record.core?.size,
    },
    growth: {
      height: record.growth?.height,
    },
    tuber: {
      source: record.tuber?.source,
      linkedOrderItemIds: record.tuber?.linkedOrderItemIds,
    },
    meta: {
      gardenArea: record.meta?.gardenArea,
      gardenRow: record.meta?.gardenRow,
      gardenPosition: record.meta?.gardenPosition,
      gardenZone: record.meta?.gardenZone,
      rowOrBed: record.meta?.rowOrBed,
      position: record.meta?.position,
      plantingState: record.meta?.plantingState,
    },
  }
}

async function findGardenLocationConflict(input, excludeId, gardenId) {
  const inputKey = getGardenKey(input)
  if (!inputKey) return null

  const records = await listRecords(gardenId)
  return records.find((record) => record.id !== excludeId && (record.gardenId ?? gardenId) === gardenId && record.seasonYearStart === input.seasonYearStart && getGardenKey(record) === inputKey) ?? null
}

async function getNextRecordNumber(gardenId) {
  const snap = await getDb().collection(COLLECTION).where('gardenId', '==', gardenId).orderBy('recordNumber', 'desc').limit(1).get()
  const highest = snap.docs[0]?.data()?.recordNumber
  return Number.isInteger(highest) ? highest + 1 : 1
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
  const db = getDb()
  const snap = gardenId
    ? await db.collection(COLLECTION).where('gardenId', '==', gardenId).orderBy('recordNumber', 'asc').get()
    : await db.collection(COLLECTION).orderBy('recordNumber', 'asc').get()
  const docs = snap.docs

  if (gardenId && options.includeLegacyUnassigned) {
    const legacySnap = await db.collection(COLLECTION).orderBy('recordNumber', 'asc').get()
    docs.push(...legacySnap.docs.filter((doc) => !doc.data().gardenId))
  }

  return docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .map((record) => cleanRecord({ ...record, gardenId: record.gardenId ?? (options.includeLegacyUnassigned ? gardenId : undefined) }))
    .sort((a, b) => a.recordNumber - b.recordNumber)
}

export async function listRecordsPage(gardenId, options = {}) {
  const db = getDb()
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 250)
  const startAfter = Number(options.startAfter)
  let query = gardenId
    ? db.collection(COLLECTION).where('gardenId', '==', gardenId).orderBy('recordNumber', 'asc')
    : db.collection(COLLECTION).orderBy('recordNumber', 'asc')

  if (Number.isFinite(startAfter)) query = query.startAfter(startAfter)

  const snap = await query.limit(limit + 1).get()
  const docs = snap.docs
  const pageDocs = docs.slice(0, limit)

  const records = pageDocs
    .map((d) => ({ id: d.id, ...d.data() }))
    .map((record) => cleanRecord({ ...record, gardenId: record.gardenId ?? (options.includeLegacyUnassigned ? gardenId : undefined) }))

  return {
    records,
    nextCursor: docs.length > limit ? records.at(-1)?.recordNumber : undefined,
  }
}

export async function getRecord(id) {
  const doc = await getDb().collection(COLLECTION).doc(id).get()
  if (!doc.exists) return null
  return cleanRecord({ id: doc.id, ...doc.data() })
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
  const base = {
    ...withPhotoDefaults(normalizedInput),
    gardenId,
    recordNumber: await getNextRecordNumber(gardenId),
    thumbnailUrl: normalizedInput.thumbnailUrl || undefined,
    imageUrl: normalizedInput.imageUrl || undefined,
    cultivarThumbnailUrl: normalizedInput.cultivarThumbnailUrl || undefined,
    cultivarImageUrl: normalizedInput.cultivarImageUrl || undefined,
    meta: {
      ...(normalizedInput.meta ?? {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  }

  const ref = await getDb().collection(COLLECTION).add(withoutUndefined(base))
  return await getRecord(ref.id)
}

export async function updateRecord(id, input, gardenId) {
  const existing = await getRecord(id)
  if (!existing) return null

  const normalizedInput = normalizeRecordText(input)
  const targetGardenId = gardenId ?? existing.gardenId
  const conflict = await findGardenLocationConflict(normalizedInput, id, targetGardenId)
  if (conflict) {
    const error = new Error('Garden location is already assigned to another record.')
    error.code = 'garden_location_conflict'
    throw error
  }

  const next = {
    ...existing,
    ...withPhotoDefaults(normalizedInput),
    gardenId: targetGardenId,
    id: undefined,
    recordNumber: existing.recordNumber,
    meta: {
      ...(existing.meta ?? {}),
      ...(normalizedInput.meta ?? {}),
      createdAt: existing.meta?.createdAt ?? normalizedInput.meta?.createdAt,
      updatedAt: nowIso(),
    },
  }

  await getDb().collection(COLLECTION).doc(id).set(withoutUndefined(next), { merge: false })
  return await getRecord(id)
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

  await Promise.all(
    matchedRecords.map((record) => {
      const { id: recordId, ...recordData } = record

      return getDb().collection(COLLECTION).doc(recordId).set(
        withoutUndefined({
          ...withPhotoDefaults({
            ...recordData,
            cultivarPhotos: uniquePhotos([photo, ...(record.cultivarPhotos ?? [])]),
            defaultCultivarPhotoId: record.defaultCultivarPhotoId || photo.id,
          }),
          meta: {
            ...(record.meta ?? {}),
            updatedAt: timestamp,
          },
        }),
        { merge: false },
      )
    }),
  )

  const updatedRecords = await Promise.all(matchedRecords.map((record) => getRecord(record.id)))
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

  await Promise.all(
    matchedRecords.map((record) => {
      const { id: recordId, ...recordData } = record
      const existingPhoto = record.cultivarPhotos?.find((candidate) => candidate.imageUrl === photo.imageUrl)
      const defaultPhoto = existingPhoto ?? { ...photo, id: `cultivar-${Date.now()}-${recordId}` }

      return getDb().collection(COLLECTION).doc(recordId).set(
        withoutUndefined({
          ...withPhotoDefaults({
            ...recordData,
            cultivarPhotos: uniquePhotos([defaultPhoto, ...(record.cultivarPhotos ?? [])]),
            defaultCultivarPhotoId: defaultPhoto.id,
            defaultPhotoScope: 'cultivar',
          }),
          meta: {
            ...(record.meta ?? {}),
            updatedAt: timestamp,
          },
        }),
        { merge: false },
      )
    }),
  )

  const updatedRecords = await Promise.all(matchedRecords.map((record) => getRecord(record.id)))
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
  const defaultPhoto = existingPhoto ?? { ...photo, id: `record-${Date.now()}` }
  const { id: _id, ...recordData } = existing

  await getDb().collection(COLLECTION).doc(id).set(
    withoutUndefined({
      ...withPhotoDefaults({
        ...recordData,
        recordPhotos: uniquePhotos([defaultPhoto, ...(existing.recordPhotos ?? [])]),
        defaultRecordPhotoId: defaultPhoto.id,
        defaultPhotoScope: 'record',
      }),
      meta: {
        ...(existing.meta ?? {}),
        updatedAt: timestamp,
      },
    }),
    { merge: false },
  )

  return {
    record: await getRecord(id),
  }
}

export async function deleteCultivarPhoto(id, { imageUrl }) {
  const source = await getRecord(id)
  if (!source) return null

  const timestamp = nowIso()
  const records = await listRecords()
  const matchedRecords = records.filter((record) => isSamePhotoCultivar(record, source))

  await Promise.all(
    matchedRecords.map((record) => {
      const { id: recordId, ...recordData } = record
      const cultivarPhotos = (record.cultivarPhotos ?? []).filter((photo) => photo.imageUrl !== imageUrl)
      const currentDefault = record.cultivarPhotos?.find((photo) => photo.id === record.defaultCultivarPhotoId)
      const defaultCultivarPhotoId = currentDefault?.imageUrl === imageUrl ? cultivarPhotos[0]?.id : record.defaultCultivarPhotoId

      return getDb().collection(COLLECTION).doc(recordId).set(
        withoutUndefined({
          ...withPhotoDefaults({
            ...recordData,
            cultivarPhotos,
            defaultCultivarPhotoId,
            cultivarImageUrl: record.cultivarImageUrl === imageUrl ? undefined : record.cultivarImageUrl,
            cultivarThumbnailUrl: record.cultivarImageUrl === imageUrl ? undefined : record.cultivarThumbnailUrl,
          }),
          meta: {
            ...(record.meta ?? {}),
            updatedAt: timestamp,
          },
        }),
        { merge: false },
      )
    }),
  )

  const updatedRecords = await Promise.all(matchedRecords.map((record) => getRecord(record.id)))
  return {
    updatedCount: matchedRecords.length,
    records: updatedRecords.filter(Boolean),
  }
}

export async function deleteRecord(id) {
  await getDb().collection(COLLECTION).doc(id).delete()
  return true
}
