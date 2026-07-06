import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from '../src/firebase.js'

const COMPANIES = 'companies'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../.env') })

function globalAdminUid() {
  const uid = String(process.env.GLOBAL_ADMIN_UIDS ?? '').split(',').map((value) => value.trim()).filter(Boolean)[0]
  if (!uid) throw new Error('GLOBAL_ADMIN_UIDS must include at least one UID to assign legacy companies.')
  return uid
}

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v)]),
  )
}

const ownerUserId = globalAdminUid()
const snap = await getDb().collection(COMPANIES).get()
const legacyCompanies = snap.docs.filter((doc) => !doc.data().ownerUserId)

await Promise.all(
  legacyCompanies.map((doc) => doc.ref.set(withoutUndefined({ ...doc.data(), ownerUserId }), { merge: false })),
)

console.log(`Assigned ${legacyCompanies.length} legacy compan${legacyCompanies.length === 1 ? 'y' : 'ies'} to Global Admin UID ${ownerUserId}.`)
