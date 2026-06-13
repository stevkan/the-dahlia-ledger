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

export async function listMaintenanceReminders({ gardenId, userId, includeLegacyUnassigned = false } = {}) {
  const snap = await getDb().collection(COLLECTION).get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((reminder) => !gardenId || reminder.gardenId === gardenId || (includeLegacyUnassigned && !reminder.gardenId))
    .map((reminder) => ({
      ...reminder,
      gardenId: reminder.gardenId ?? (includeLegacyUnassigned ? gardenId : undefined),
      ownerUserId: reminder.ownerUserId ?? userId,
      visibility: reminder.visibility ?? 'garden',
      priority: reminder.priority ?? 'normal',
    }))
    .sort(sortReminders)
}

export async function createMaintenanceReminder(input, { gardenId, userId } = {}) {
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
        gardenId,
        createdByUserId: userId,
        ownerUserId: input.ownerUserId || userId,
        assignedToUserId: input.assignedToUserId || undefined,
        visibility: input.visibility ?? 'garden',
        priority: input.priority ?? 'normal',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    )
  const doc = await ref.get()
  return { id: doc.id, ...doc.data() }
}

export async function updateMaintenanceReminder(id, input, { gardenId, userId } = {}) {
  const doc = await getDb().collection(COLLECTION).doc(id).get()
  if (!doc.exists) return null
  if (gardenId && doc.data().gardenId && doc.data().gardenId !== gardenId) return null

  await doc.ref.set(
    withoutUndefined({
      ...doc.data(),
      ...input,
      notes: input.notes || undefined,
      dueDate: input.dueDate || undefined,
      relatedRecordIds: input.relatedRecordIds ?? doc.data().relatedRecordIds ?? [],
      gardenId: doc.data().gardenId ?? gardenId,
      createdByUserId: doc.data().createdByUserId ?? userId,
      ownerUserId: input.ownerUserId ?? doc.data().ownerUserId ?? userId,
      assignedToUserId: input.assignedToUserId || undefined,
      visibility: input.visibility ?? doc.data().visibility ?? 'garden',
      priority: input.priority ?? doc.data().priority ?? 'normal',
      updatedAt: nowIso(),
    }),
    { merge: false },
  )
  const updated = await doc.ref.get()
  return { id: updated.id, ...updated.data() }
}

export async function completeMaintenanceReminder(id, { gardenId, userId } = {}) {
  const doc = await getDb().collection(COLLECTION).doc(id).get()
  if (!doc.exists) return null
  if (gardenId && doc.data().gardenId && doc.data().gardenId !== gardenId) return null

  const timestamp = nowIso()
  await doc.ref.set(
    withoutUndefined({
      ...doc.data(),
      gardenId: doc.data().gardenId ?? gardenId,
      createdByUserId: doc.data().createdByUserId ?? userId,
      ownerUserId: doc.data().ownerUserId ?? userId,
      visibility: doc.data().visibility ?? 'garden',
      priority: doc.data().priority ?? 'normal',
      completedAt: timestamp,
      completedByUserId: userId,
      updatedAt: timestamp,
    }),
    { merge: false },
  )
  const updated = await doc.ref.get()
  return { id: updated.id, ...updated.data() }
}

export async function reopenMaintenanceReminder(id, { gardenId, userId } = {}) {
  const doc = await getDb().collection(COLLECTION).doc(id).get()
  if (!doc.exists) return null
  if (gardenId && doc.data().gardenId && doc.data().gardenId !== gardenId) return null

  const timestamp = nowIso()
  const { completedAt, completedByUserId, ...data } = doc.data()
  await doc.ref.set(
    withoutUndefined({
      ...data,
      gardenId: data.gardenId ?? gardenId,
      createdByUserId: data.createdByUserId ?? userId,
      ownerUserId: data.ownerUserId ?? userId,
      visibility: data.visibility ?? 'garden',
      priority: data.priority ?? 'normal',
      updatedAt: timestamp,
    }),
    { merge: false },
  )
  const updated = await doc.ref.get()
  return { id: updated.id, ...updated.data() }
}

export async function deleteMaintenanceReminder(id, { gardenId } = {}) {
  const doc = await getDb().collection(COLLECTION).doc(id).get()
  if (!doc.exists) return true
  if (gardenId && doc.data().gardenId && doc.data().gardenId !== gardenId) return false
  await doc.ref.delete()
  return true
}
