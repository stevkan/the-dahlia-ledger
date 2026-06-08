import { getDb } from '../src/firebase.js'

const COLLECTION = 'dahliaRecords'
const BATCH_SIZE = 450

let deleted = 0

while (true) {
  const snap = await getDb().collection(COLLECTION).limit(BATCH_SIZE).get()
  if (snap.empty) break

  const batch = getDb().batch()
  for (const doc of snap.docs) {
    batch.delete(doc.ref)
  }

  await batch.commit()
  deleted += snap.size
  console.log(`Deleted ${deleted} records...`)
}

console.log(`Deleted ${deleted} total records from ${COLLECTION}.`)
