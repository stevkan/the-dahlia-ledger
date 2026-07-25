import '../src/env.js'
import { getDb } from '../src/firebase.js'

const RECORDS_COLLECTION = 'dahliaRecords'
const SUMMARY_COLLECTION = 'dahliaRecordSummaries'
const DRY_RUN = process.argv.includes('--dry-run')
const BATCH_LIMIT = 450

const db = getDb()

const [recordsSnap, summariesSnap] = await Promise.all([
  db.collection(RECORDS_COLLECTION).get(),
  db.collection(SUMMARY_COLLECTION).get(),
])

const recordsByPlantedDate = new Map(
  recordsSnap.docs.map((doc) => [doc.id, doc.data().core?.plantedDate]),
)

const toUpdate = summariesSnap.docs.filter((doc) => {
  const storedPlantedDate = doc.data().core?.plantedDate
  const sourcePlantedDate = recordsByPlantedDate.get(doc.id)
  return sourcePlantedDate !== undefined && storedPlantedDate !== sourcePlantedDate
})

if (toUpdate.length === 0) {
  console.log('No summaries need updating.')
  process.exit(0)
}

let batch = db.batch()
let pendingWrites = 0
let updatedCount = 0

for (const doc of toUpdate) {
  const plantedDate = recordsByPlantedDate.get(doc.id)
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}${doc.id} -> core.plantedDate: ${plantedDate ?? '(none)'}`)
  if (!DRY_RUN) {
    batch.update(doc.ref, { 'core.plantedDate': plantedDate ?? null })
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

console.log(`${DRY_RUN ? 'Would update' : 'Updated'} ${updatedCount} of ${summariesSnap.docs.length} summaries.`)
