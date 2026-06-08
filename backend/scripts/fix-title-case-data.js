import { getDb } from '../src/firebase.js'
import { toTitleCase } from '../src/textFormat.js'

const COLLECTION = 'dahliaRecords'

function normalizeRecord(record) {
  const next = {
    flowerName: toTitleCase(record.flowerName),
    core: {
      ...(record.core ?? {}),
      cultivar: record.core?.cultivar ? toTitleCase(record.core.cultivar) : record.core?.cultivar,
      color: record.core?.color ? toTitleCase(record.core.color) : record.core?.color,
    },
  }

  const changed = next.flowerName !== record.flowerName
    || next.core.cultivar !== record.core?.cultivar
    || next.core.color !== record.core?.color

  return changed ? next : null
}

const snap = await getDb().collection(COLLECTION).get()
let updated = 0

for (const doc of snap.docs) {
  const patch = normalizeRecord(doc.data())
  if (!patch) continue

  await doc.ref.set(patch, { merge: true })
  updated += 1
  console.log(`Updated ${doc.id}: ${patch.flowerName}`)
}

console.log(`Checked ${snap.size} records. Updated ${updated}.`)
