import '../src/env.js'
import { getDb } from '../src/firebase.js'

const GARDEN_ID = 'default-e2bfbc813611e5b3324b6f746e2298bb537a7814'
const DRY_RUN = process.argv.includes('--dry-run')
const BATCH_LIMIT = 450

const db = getDb()

async function backfillCollection(collectionName) {
  const snap = await db.collection(collectionName).get()
  const missing = snap.docs.filter((doc) => !doc.data().gardenId)

  if (missing.length === 0) {
    console.log(`${collectionName}: no documents missing gardenId.`)
    return
  }

  let batch = db.batch()
  let pendingWrites = 0
  let updatedCount = 0

  for (const doc of missing) {
    console.log(`${DRY_RUN ? '[dry-run] ' : ''}${collectionName}/${doc.id} -> gardenId: ${GARDEN_ID}`)
    if (!DRY_RUN) {
      batch.update(doc.ref, { gardenId: GARDEN_ID })
      pendingWrites += 1
      if (pendingWrites >= BATCH_LIMIT) {
        await batch.commit()
        batch = db.batch()
        pendingWrites = 0
      }
    }
    updatedCount += 1
  }

  if (!DRY_RUN && pendingWrites > 0) await batch.commit()

  console.log([
    `${collectionName}:`,
    `${DRY_RUN ? 'Would update' : 'Updated'} ${updatedCount} of ${snap.docs.length} documents.`,
  ].join(' '))
}

await backfillCollection('dahliaRecords')
await backfillCollection('orderItems')
