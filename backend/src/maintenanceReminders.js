import { getDb } from './firebase.js'

const COLLECTION = 'maintenanceReminders'

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

function sortReminders(a, b) {
  if (a.completedAt && !b.completedAt) return 1
  if (!a.completedAt && b.completedAt) return -1
  return String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
}

export async function listMaintenanceReminders() {
  const snap = await getDb().collection(COLLECTION).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort(sortReminders)
}

export async function createMaintenanceReminder(input) {
  const timestamp = nowIso()
  const ref = await getDb()
    .collection(COLLECTION)
    .add(
      withoutUndefined({
        title: input.title,
        notes: input.notes || undefined,
        dueDate: input.dueDate || undefined,
        relatedRecordIds: input.relatedRecordIds ?? [],
        source: input.source ?? 'user',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    )
  const doc = await ref.get()
  return { id: doc.id, ...doc.data() }
}

export async function updateMaintenanceReminder(id, input) {
  const doc = await getDb().collection(COLLECTION).doc(id).get()
  if (!doc.exists) return null

  await doc.ref.set(
    withoutUndefined({
      ...doc.data(),
      ...input,
      notes: input.notes || undefined,
      dueDate: input.dueDate || undefined,
      relatedRecordIds: input.relatedRecordIds ?? doc.data().relatedRecordIds ?? [],
      updatedAt: nowIso(),
    }),
    { merge: false },
  )
  const updated = await doc.ref.get()
  return { id: updated.id, ...updated.data() }
}

export async function completeMaintenanceReminder(id) {
  const doc = await getDb().collection(COLLECTION).doc(id).get()
  if (!doc.exists) return null

  const timestamp = nowIso()
  await doc.ref.set(
    withoutUndefined({
      ...doc.data(),
      completedAt: timestamp,
      updatedAt: timestamp,
    }),
    { merge: false },
  )
  const updated = await doc.ref.get()
  return { id: updated.id, ...updated.data() }
}

export async function deleteMaintenanceReminder(id) {
  await getDb().collection(COLLECTION).doc(id).delete()
  return true
}
