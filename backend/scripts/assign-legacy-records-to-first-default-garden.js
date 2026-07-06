import { getDb } from '../src/firebase.js'

const GARDENS = 'gardens'
const RECORDS = 'dahliaRecords'

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v)]),
  )
}

async function assignLegacyRecordsToGarden(gardenId) {
  const snap = await getDb().collection(RECORDS).get()
  if (snap.docs.some((doc) => doc.data().gardenId)) return 0

  const unassigned = snap.docs.filter((doc) => !doc.data().gardenId)
  await Promise.all(
    unassigned.map((doc) => doc.ref.set(withoutUndefined({ ...doc.data(), gardenId }), { merge: false })),
  )
  return unassigned.length
}

const gardensSnap = await getDb().collection(GARDENS).where('isDefault', '==', true).get()
const defaultGardens = gardensSnap.docs
  .map((doc) => ({ id: doc.id, ...doc.data() }))
  .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id)))

const firstDefaultGarden = defaultGardens[0]
if (!firstDefaultGarden) {
  console.log('No default garden found. No records were updated.')
  process.exit(0)
}

const updatedCount = await assignLegacyRecordsToGarden(firstDefaultGarden.id)
console.log(`First default garden: ${firstDefaultGarden.id} (${firstDefaultGarden.name ?? 'unnamed'})`)
console.log(`Assigned ${updatedCount} legacy record${updatedCount === 1 ? '' : 's'} to the first default garden.`)
