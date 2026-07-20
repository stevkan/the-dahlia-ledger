import type { DahliaRecord, DahliaRecordSummary } from './types'

export type RecordsPage<T> = {
  records: T[]
  nextCursor?: number
}

export type InfiniteRecordsData<T> = {
  pages: RecordsPage<T>[]
  pageParams: unknown[]
}

export function recordToSummary(record: DahliaRecord): DahliaRecordSummary {
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
      color: record.core.color,
      size: record.core.size,
      cultivar: record.core.cultivar,
      plantedDate: record.core.plantedDate,
    },
    growth: {
      height: record.growth.height,
    },
    tuber: {
      source: record.tuber.source,
      linkedOrderItemIds: record.tuber.linkedOrderItemIds,
    },
    meta: {
      gardenArea: record.meta.gardenArea,
      gardenRow: record.meta.gardenRow,
      gardenPosition: record.meta.gardenPosition,
      gardenZone: record.meta.gardenZone,
      rowOrBed: record.meta.rowOrBed,
      position: record.meta.position,
      plantingState: record.meta.plantingState,
    },
  }
}

export function patchRecords(records: DahliaRecord[] | undefined, changedRecords: DahliaRecord[]) {
  if (!records || changedRecords.length === 0) return records

  const changedById = new Map(changedRecords.map((record) => [record.id, record]))
  let changed = false
  const next = records.map((record) => {
    const replacement = changedById.get(record.id)
    if (!replacement) return record
    changed = true
    return replacement
  })

  return changed ? next : records
}

export function patchRecordSummaries(
  data: InfiniteRecordsData<DahliaRecordSummary> | undefined,
  changedRecords: DahliaRecord[],
  deletedRecordIds: string[] = [],
) {
  if (!data || (changedRecords.length === 0 && deletedRecordIds.length === 0)) return data

  const changedById = new Map(changedRecords.map((record) => [record.id, recordToSummary(record)]))
  const deletedIds = new Set(deletedRecordIds)
  const seenIds = new Set<string>()
  let changed = false

  const pages = data.pages.map((page, pageIndex) => {
    const records: DahliaRecordSummary[] = []
    for (const record of page.records) {
      if (deletedIds.has(record.id)) {
        changed = true
        continue
      }

      const replacement = changedById.get(record.id)
      if (replacement) {
        records.push(replacement)
        seenIds.add(record.id)
        changed = true
      } else {
        records.push(record)
      }
    }

    if (pageIndex === 0) {
      for (const [id, record] of changedById) {
        if (!seenIds.has(id)) {
          records.unshift(record)
          seenIds.add(id)
          changed = true
        }
      }
    }

    return records === page.records ? page : { ...page, records }
  })

  return changed ? { ...data, pages } : data
}
