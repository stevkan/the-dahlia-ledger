import { getDb } from './firebase.js'

const COLLECTION = 'excelImportHistory'

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

function locationSnapshot(record) {
  return {
    gardenLocation: record.gardenLocation ?? null,
    meta: {
      plantingState: record.meta?.plantingState ?? null,
      gardenArea: record.meta?.gardenArea ?? null,
      gardenRow: record.meta?.gardenRow ?? null,
      gardenPosition: record.meta?.gardenPosition ?? null,
    },
  }
}

export function excelImportRollbackEntry(record, nextLocation) {
  return {
    recordId: record.id,
    flowerName: record.flowerName,
    cultivar: record.core?.cultivar ?? null,
    previous: locationSnapshot(record),
    imported: nextLocation,
  }
}

export async function createExcelImportHistory({ originalFileName, result, rollbackEntries }) {
  const timestamp = nowIso()
  const ref = await getDb().collection(COLLECTION).add(
    withoutUndefined({
      originalFileName: originalFileName || 'Excel import',
      status: rollbackEntries.length ? 'active' : 'empty',
      createdAt: timestamp,
      updatedAt: timestamp,
      revertedAt: null,
      counts: result.counts,
      updated: result.updated,
      unmatched: result.unmatched,
      ambiguous: result.ambiguous,
      priorSeasonMissing: result.priorSeasonMissing,
      skipped: result.skipped,
      rollbackEntries,
    }),
  )

  return ref.id
}

export async function getLatestActiveExcelImportHistory() {
  const snap = await getDb().collection(COLLECTION).where('status', '==', 'active').orderBy('createdAt', 'desc').limit(1).get()
  const doc = snap.docs[0]
  return doc ? { id: doc.id, ...doc.data() } : null
}

export async function markExcelImportHistoryReverted(id, { revertedCount }) {
  await getDb().collection(COLLECTION).doc(id).set(
    withoutUndefined({
      status: 'reverted',
      revertedAt: nowIso(),
      updatedAt: nowIso(),
      revertedCount,
    }),
    { merge: true },
  )
}
