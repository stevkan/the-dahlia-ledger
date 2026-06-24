import { getDb } from './firebase.js'

export async function listFlowerNames(gardenId, { includeLegacyUnassigned = false } = {}) {
  const db = getDb()
  const [recordsSnap, itemsSnap] = await Promise.all([
    db.collection('dahliaRecords').where('gardenId', '==', gardenId).select('flowerName').get(),
    db.collection('orderItems').where('gardenId', '==', gardenId).select('flowerName').get(),
  ])

  const allDocs = [...recordsSnap.docs, ...itemsSnap.docs]

  if (includeLegacyUnassigned) {
    const [legacyRecords, legacyItems] = await Promise.all([
      db.collection('dahliaRecords').select('flowerName', 'gardenId').get(),
      db.collection('orderItems').select('flowerName', 'gardenId').get(),
    ])
    allDocs.push(
      ...legacyRecords.docs.filter((doc) => !doc.data().gardenId),
      ...legacyItems.docs.filter((doc) => !doc.data().gardenId),
    )
  }

  const names = new Set()
  for (const doc of allDocs) {
    const name = doc.data().flowerName
    if (name) names.add(name)
  }

  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b))
}

function recordUpdate(data, oldName, newName) {
  const update = { flowerName: newName }
  if (data.core?.cultivar === oldName) update['core.cultivar'] = newName
  return update
}

function itemUpdate(data, oldName, newName) {
  const update = { flowerName: newName }
  if (data.cultivarName === oldName) update.cultivarName = newName
  return update
}

export async function renameFlowerName(oldName, newName, gardenId, { includeLegacyUnassigned = false } = {}) {
  const db = getDb()
  const [recordsSnap, itemsSnap] = await Promise.all([
    db.collection('dahliaRecords').where('gardenId', '==', gardenId).where('flowerName', '==', oldName).get(),
    db.collection('orderItems').where('gardenId', '==', gardenId).where('flowerName', '==', oldName).get(),
  ])

  const updates = [
    ...recordsSnap.docs.map((doc) => ({ ref: doc.ref, update: recordUpdate(doc.data(), oldName, newName) })),
    ...itemsSnap.docs.map((doc) => ({ ref: doc.ref, update: itemUpdate(doc.data(), oldName, newName) })),
  ]

  if (includeLegacyUnassigned) {
    const [legacyRecords, legacyItems] = await Promise.all([
      db.collection('dahliaRecords').where('flowerName', '==', oldName).get(),
      db.collection('orderItems').where('flowerName', '==', oldName).get(),
    ])
    updates.push(
      ...legacyRecords.docs.filter((doc) => !doc.data().gardenId).map((doc) => ({ ref: doc.ref, update: recordUpdate(doc.data(), oldName, newName) })),
      ...legacyItems.docs.filter((doc) => !doc.data().gardenId).map((doc) => ({ ref: doc.ref, update: itemUpdate(doc.data(), oldName, newName) })),
    )
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
