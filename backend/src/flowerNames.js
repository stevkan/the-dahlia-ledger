import { getDb } from './firebase.js'
import { query } from './db.js'
import { clearRecordSummaryCache } from './records.js'

export async function listFlowerNames(gardenId, { includeLegacyUnassigned = false } = {}) {
  const db = getDb()
  const gardenClause = includeLegacyUnassigned ? '(garden_id = $1 OR garden_id IS NULL)' : 'garden_id = $1'
  const [recordsResult, itemsSnap] = await Promise.all([
    query(`SELECT DISTINCT flower_name AS "flowerName" FROM dahlia_records WHERE ${gardenClause}`, [gardenId]),
    db.collection('orderItems').where('gardenId', '==', gardenId).select('flowerName').get(),
  ])

  const names = new Set(recordsResult.rows.map((row) => row.flowerName))
  for (const doc of itemsSnap.docs) names.add(doc.data().flowerName)

  if (includeLegacyUnassigned) {
    const legacyItems = await db.collection('orderItems').select('flowerName', 'gardenId').get()
    for (const doc of legacyItems.docs.filter((doc) => !doc.data().gardenId)) names.add(doc.data().flowerName)
  }

  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b))
}

function itemUpdate(data, oldName, newName) {
  const update = { flowerName: newName }
  if (data.cultivarName === oldName) update.cultivarName = newName
  return update
}

export async function renameFlowerName(oldName, newName, gardenId, { includeLegacyUnassigned = false } = {}) {
  const db = getDb()

  const gardenClause = includeLegacyUnassigned ? '(garden_id = $3 OR garden_id IS NULL)' : 'garden_id = $3'
  const { rowCount: recordsUpdated } = await query(
    `UPDATE dahlia_records
     SET flower_name = $1,
         core = CASE WHEN core->>'cultivar' = $2 THEN jsonb_set(core, '{cultivar}', to_jsonb($1::text)) ELSE core END
     WHERE flower_name = $2 AND ${gardenClause}`,
    [newName, oldName, gardenId],
  )
  if (recordsUpdated > 0) clearRecordSummaryCache()

  const itemsSnap = await db.collection('orderItems').where('gardenId', '==', gardenId).where('flowerName', '==', oldName).get()
  const updates = [
    ...itemsSnap.docs.map((doc) => ({ ref: doc.ref, update: itemUpdate(doc.data(), oldName, newName) })),
  ]

  if (includeLegacyUnassigned) {
    const legacyItems = await db.collection('orderItems').where('flowerName', '==', oldName).get()
    updates.push(
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

  return { updatedCount: recordsUpdated + updates.length }
}
