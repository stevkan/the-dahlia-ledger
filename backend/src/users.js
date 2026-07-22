import { getDb } from './firebase.js'

const USERS = 'users'

function adminValues(name) {
  return new Set(String(process.env[name] ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))
}

export function isGlobalAdmin(user) {
  if (!user) return false
  const adminUids = adminValues('GLOBAL_ADMIN_UIDS')
  const adminEmails = adminValues('GLOBAL_ADMIN_EMAILS')
  return adminUids.has(String(user.uid ?? '').toLowerCase()) || adminEmails.has(String(user.email ?? '').toLowerCase())
}

function nowIso() {
  return new Date().toISOString()
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

export async function upsertKnownUser(user) {
  if (!user?.uid) return null
  const timestamp = nowIso()
  const ref = getDb().collection(USERS).doc(user.uid)
  const existing = await ref.get()
  await ref.set(withoutUndefined({
    userId: user.uid,
    email: user.email || undefined,
    displayName: user.name || user.displayName || undefined,
    photoUrl: user.picture || undefined,
    provider: user.firebase?.sign_in_provider || undefined,
    createdAt: existing.exists ? existing.data().createdAt : timestamp,
    lastSeenAt: timestamp,
    updatedAt: timestamp,
  }), { merge: false })
  const doc = await ref.get()
  return { id: doc.id, ...doc.data() }
}

export async function listKnownUsers() {
  const snap = await getDb().collection(USERS).get()
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(a.displayName || a.email || a.userId).localeCompare(String(b.displayName || b.email || b.userId)))
}

export async function getKnownUser(userId) {
  const id = String(userId ?? '').trim()
  if (!id) return null

  const doc = await getDb().collection(USERS).doc(id).get()
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() }
}

export async function deleteKnownUser(userId, usage = {}) {
  const id = String(userId ?? '').trim()
  if (!id) return false

  if (usage.ownsGarden || usage.addedByAnotherUser) {
    const reasons = []
    if (usage.ownsGarden) reasons.push('own a garden')
    if (usage.addedByAnotherUser) reasons.push('was added to a garden by another user')
    const error = new Error(`This user cannot be deleted because they ${reasons.join(' and ')}. Remove them from that garden first.`)
    error.code = 'known_user_in_use'
    error.reasons = usage
    throw error
  }

  const ref = getDb().collection(USERS).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return false

  await ref.delete()
  return true
}
