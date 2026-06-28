import { getDb } from './firebase.js'

export async function listColors(gardenId, { includeLegacyUnassigned = false } = {}) {
  const db = getDb()
  const snap = await db.collection('dahliaRecords').where('gardenId', '==', gardenId).select('core').get()
  const docs = [...snap.docs]

  if (includeLegacyUnassigned) {
    const legacySnap = await db.collection('dahliaRecords').select('core', 'gardenId').get()
    docs.push(...legacySnap.docs.filter((doc) => !doc.data().gardenId))
  }

  const colors = new Set()
  for (const doc of docs) {
    const color = doc.data().core?.color
    if (color) colors.add(color)
  }
  return [...colors].filter(Boolean).sort((a, b) => a.localeCompare(b))
}

export async function renameColor(oldColor, newColor, gardenId, { includeLegacyUnassigned = false } = {}) {
  const db = getDb()
  const [recordsSnap, summariesSnap] = await Promise.all([
    db.collection('dahliaRecords').where('gardenId', '==', gardenId).select('core').get(),
    db.collection('dahliaRecordSummaries').where('gardenId', '==', gardenId).select('core').get(),
  ])

  const updates = [
    ...recordsSnap.docs
      .filter((doc) => doc.data().core?.color === oldColor)
      .map((doc) => ({ ref: doc.ref, update: { 'core.color': newColor } })),
    ...summariesSnap.docs
      .filter((doc) => doc.data().core?.color === oldColor)
      .map((doc) => ({ ref: doc.ref, update: { 'core.color': newColor } })),
  ]

  if (includeLegacyUnassigned) {
    const [legacyRecordsSnap, legacySummariesSnap] = await Promise.all([
      db.collection('dahliaRecords').select('core', 'gardenId').get(),
      db.collection('dahliaRecordSummaries').select('core', 'gardenId').get(),
    ])
    for (const doc of legacyRecordsSnap.docs) {
      if (!doc.data().gardenId && doc.data().core?.color === oldColor) updates.push({ ref: doc.ref, update: { 'core.color': newColor } })
    }
    for (const doc of legacySummariesSnap.docs) {
      if (!doc.data().gardenId && doc.data().core?.color === oldColor) updates.push({ ref: doc.ref, update: { 'core.color': newColor } })
    }
  }

  for (let i = 0; i < updates.length; i += 500) {
    const batch = db.batch()
    for (const { ref, update } of updates.slice(i, i + 500)) {
      batch.update(ref, update)
    }
    await batch.commit()
  }

  return { updatedCount: updates.length }
}
