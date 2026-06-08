import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { toTitleCase } from '../src/textFormat.js'

const COLLECTION = 'dahliaRecords'

const snap = await getDb().collection(COLLECTION).get()
const batch = getDb().batch()
let changedCount = 0

for (const doc of snap.docs) {
  const record = doc.data()
  const color = record.core?.color
  if (typeof color !== 'string' || !color.trim()) continue

  const normalizedColor = toTitleCase(color)
  if (normalizedColor === color) continue

  batch.update(doc.ref, {
    'core.color': normalizedColor,
    'meta.updatedAt': new Date().toISOString(),
  })
  changedCount += 1
  console.log(`${record.flowerName ?? doc.id}: ${color} -> ${normalizedColor}`)
}

if (changedCount > 0) {
  await batch.commit()
}

console.log(`Updated ${changedCount} record color value${changedCount === 1 ? '' : 's'}.`)
