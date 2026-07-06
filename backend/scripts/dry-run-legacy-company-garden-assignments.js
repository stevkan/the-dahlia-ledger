import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from '../src/firebase.js'

const COMPANIES = 'companies'
const GARDENS = 'gardens'
const GARDEN_MEMBERS = 'gardenMembers'
const USERS = 'users'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const applyChanges = process.argv.includes('--apply')

dotenv.config({ path: path.resolve(__dirname, '../.env') })

function sortByName(a, b) {
  return String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.id).localeCompare(String(b.id))
}

function sortGardens(a, b) {
  return Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id))
}

function userLabel(userId, user) {
  if (!user) return userId || '(missing owner)'
  return `${user.displayName || user.email || user.userId || userId} (${user.userId || userId})`
}

async function listUsersById(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))]
  const docs = await Promise.all(uniqueIds.map((id) => getDb().collection(USERS).doc(id).get()))
  return new Map(docs.filter((doc) => doc.exists).map((doc) => [doc.id, { id: doc.id, ...doc.data() }]))
}

async function listGardensByOwnerUserId(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))]
  const byOwner = new Map(uniqueIds.map((id) => [id, []]))
  const snapshots = await Promise.all(uniqueIds.map(async (userId) => {
    const [ownerSnap, createdSnap, memberSnap] = await Promise.all([
      getDb().collection(GARDENS).where('ownerUserId', '==', userId).get(),
      getDb().collection(GARDENS).where('createdByUserId', '==', userId).get(),
      getDb().collection(GARDEN_MEMBERS).where('userId', '==', userId).where('role', '==', 'owner').get(),
    ])

    const memberGardenIds = [...new Set(memberSnap.docs.map((doc) => doc.data().gardenId).filter(Boolean))]
    const memberGardenDocs = await Promise.all(memberGardenIds.map((gardenId) => getDb().collection(GARDENS).doc(gardenId).get()))
    return { userId, ownerSnap, createdSnap, memberGardenDocs }
  }))

  for (const { userId, ownerSnap, createdSnap, memberGardenDocs } of snapshots) {
    const gardensById = new Map()
    for (const doc of ownerSnap.docs) gardensById.set(doc.id, { id: doc.id, ...doc.data(), ownershipSource: 'garden.ownerUserId' })
    for (const doc of createdSnap.docs) {
      const existing = gardensById.get(doc.id)
      gardensById.set(doc.id, { id: doc.id, ...doc.data(), ownershipSource: existing ? `${existing.ownershipSource}, garden.createdByUserId` : 'garden.createdByUserId' })
    }
    for (const doc of memberGardenDocs.filter((doc) => doc.exists)) {
      const existing = gardensById.get(doc.id)
      gardensById.set(doc.id, { id: doc.id, ...doc.data(), ownershipSource: existing ? `${existing.ownershipSource}, gardenMembers.owner` : 'gardenMembers.owner' })
    }
    byOwner.set(userId, Array.from(gardensById.values()).sort(sortGardens))
  }

  return byOwner
}

function assignmentFor(company, gardensByOwner) {
  if (!company.ownerUserId) return { status: 'skip', reason: 'missing ownerUserId' }

  const gardens = gardensByOwner.get(company.ownerUserId) ?? []
  if (!gardens.length) return { status: 'skip', reason: 'owner has no owned gardens' }

  const defaultGardens = gardens.filter((garden) => garden.isDefault)
  const selectedGarden = defaultGardens[0] ?? gardens[0]
  const reason = defaultGardens.length
    ? 'default owned garden'
    : gardens.length === 1
      ? 'only owned garden'
      : 'first owned garden by createdAt; no default garden'

  return { status: 'assign', garden: selectedGarden, reason, gardenCount: gardens.length }
}

const companiesSnap = await getDb().collection(COMPANIES).get()
const legacyCompanies = companiesSnap.docs
  .map((doc) => ({ id: doc.id, ...doc.data() }))
  .filter((company) => !company.gardenId)
  .sort(sortByName)

const ownerUserIds = legacyCompanies.map((company) => company.ownerUserId).filter(Boolean)
const [usersById, gardensByOwner] = await Promise.all([
  listUsersById(ownerUserIds),
  listGardensByOwnerUserId(ownerUserIds),
])

const assignments = legacyCompanies.map((company) => ({
  company,
  owner: usersById.get(company.ownerUserId),
  assignment: assignmentFor(company, gardensByOwner),
}))

const assignable = assignments.filter((entry) => entry.assignment.status === 'assign')
const skipped = assignments.filter((entry) => entry.assignment.status !== 'assign')

if (applyChanges) {
  const timestamp = new Date().toISOString()
  await Promise.all(assignable.map(({ company, assignment }) => getDb().collection(COMPANIES).doc(company.id).set({
    ...company,
    gardenId: assignment.garden.id,
    updatedAt: timestamp,
  }, { merge: false })))
}

console.log(`${applyChanges ? 'Apply' : 'Dry run'}: legacy company garden assignments`)
console.log(`Companies missing gardenId: ${legacyCompanies.length}`)
console.log(`Assignable: ${assignable.length}`)
console.log(`Skipped: ${skipped.length}`)
if (applyChanges) console.log(`Updated: ${assignable.length}`)
console.log('')

for (const { company, owner, assignment } of assignments) {
  const ownerText = userLabel(company.ownerUserId, owner)
  if (assignment.status === 'assign') {
    console.log(`ASSIGN | ${company.name || '(unnamed company)'} | companyId=${company.id}`)
    console.log(`  owner: ${ownerText}`)
    console.log(`  garden: ${assignment.garden.name || '(unnamed garden)'} (${assignment.garden.id})`)
    console.log(`  ownership source: ${assignment.garden.ownershipSource}`)
    console.log(`  reason: ${assignment.reason}; owned gardens=${assignment.gardenCount}`)
  } else {
    console.log(`SKIP   | ${company.name || '(unnamed company)'} | companyId=${company.id}`)
    console.log(`  owner: ${ownerText}`)
    console.log(`  reason: ${assignment.reason}`)
  }
}
