import crypto from 'node:crypto'
import { getDb } from './firebase.js'
import { isGlobalAdmin } from './users.js'

const GARDENS = 'gardens'
const GARDEN_MEMBERS = 'gardenMembers'
const INVITES = 'invites'
const RECORDS = 'dahliaRecords'
const REMINDERS = 'maintenanceReminders'
const ORDER_ITEMS = 'orderItems'

export const GARDEN_ROLES = ['owner', 'admin', 'editor', 'viewer']

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

function userDisplayName(user) {
  return user?.name || user?.email || 'My'
}

function normalizedGardenOptions(options) {
  if (!options) return undefined
  return {
    gardenAreas: normalizedOptionList(options.gardenAreas),
    gardenRows: normalizedOptionList(options.gardenRows),
    gardenPositions: normalizedOptionList(options.gardenPositions),
  }
}

function normalizedOptionList(values) {
  const seen = new Set()
  return (values ?? [])
    .map((value) => String(value).trim().replace(/\s+/g, ' '))
    .filter((value) => {
      const key = value.toLowerCase()
      if (!value || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function isWriteRole(role) {
  return role === 'owner' || role === 'admin' || role === 'editor'
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex')
}

function sortMembers(a, b) {
  return String(a.email ?? a.userId).localeCompare(String(b.email ?? b.userId))
}

function sortGardensByCreatedAt(a, b) {
  return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id))
}

function isNewerMember(a, b) {
  return String(a.updatedAt ?? a.createdAt ?? '').localeCompare(String(b.updatedAt ?? b.createdAt ?? '')) > 0
}

async function dedupeMembers(collectionName, scopeKey, scopeId) {
  const snap = await getDb().collection(collectionName).where(scopeKey, '==', scopeId).get()
  const byUserId = new Map()
  const duplicates = []
  for (const doc of snap.docs) {
    const member = { id: doc.id, ...doc.data() }
    const existing = byUserId.get(member.userId)
    if (!existing || isNewerMember(member, existing)) {
      if (existing) duplicates.push(existing)
      byUserId.set(member.userId, member)
    } else {
      duplicates.push(member)
    }
  }
  await Promise.all(duplicates.map((member) => getDb().collection(collectionName).doc(member.id).delete()))
  return Array.from(byUserId.values()).sort(sortMembers)
}

function lastOwnerError() {
  const error = new Error('Cannot remove the last owner.')
  error.code = 'last_owner'
  return error
}

function duplicateMemberError() {
  const error = new Error('User is already a member.')
  error.code = 'duplicate_member'
  return error
}

function defaultGardenId(user) {
  return `default-${crypto.createHash('sha1').update(user.uid).digest('hex')}`
}

export async function ensureDefaultGarden(user) {
  const db = getDb()
  const stableRef = db.collection(GARDENS).doc(defaultGardenId(user))
  const stableDoc = await stableRef.get()
  if (stableDoc.exists) {
    await ensureGardenMembership(user, stableRef.id, 'owner')
    return { id: stableDoc.id, ...stableDoc.data() }
  }

  const existing = await db.collection(GARDENS).where('ownerUserId', '==', user.uid).where('isDefault', '==', true).get()
  if (!existing.empty) {
    const doc = existing.docs[0]
    await stableRef.set(withoutUndefined({ ...doc.data(), updatedAt: nowIso() }), { merge: false })
    await ensureGardenMembership(user, stableRef.id, 'owner')
    return { id: stableRef.id, ...(await stableRef.get()).data() }
  }

  const existingMemberships = await db.collection(GARDEN_MEMBERS).where('userId', '==', user.uid).get()
  for (const membershipDoc of existingMemberships.docs) {
    const gardenId = membershipDoc.data().gardenId
    if (!gardenId) continue
    const gardenDoc = await db.collection(GARDENS).doc(gardenId).get()
    if (gardenDoc.exists) return { id: gardenDoc.id, ...gardenDoc.data() }
  }

  const timestamp = nowIso()
  await stableRef.set(withoutUndefined({
    name: `${userDisplayName(user)} Garden`,
    ownershipType: 'personal',
    ownerUserId: user.uid,
    createdByUserId: user.uid,
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }), { merge: false })

  await ensureGardenMembership(user, stableRef.id, 'owner')
  await assignLegacyRecordsToGarden(stableRef.id)

  const doc = await stableRef.get()
  return { id: doc.id, ...doc.data() }
}

async function ensureGardenMembership(user, gardenId, role) {
  const existing = await getDb().collection(GARDEN_MEMBERS).where('gardenId', '==', gardenId).where('userId', '==', user.uid).limit(1).get()
  if (!existing.empty) return
  const timestamp = nowIso()
  await getDb().collection(GARDEN_MEMBERS).add(withoutUndefined({
    gardenId,
    userId: user.uid,
    email: user.email || undefined,
    displayName: user.name || undefined,
    role,
    invitedByUserId: user.uid,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
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

export async function listGardens(user) {
  await ensureDefaultGarden(user)
  const db = getDb()
  const directMemberships = await db.collection(GARDEN_MEMBERS).where('userId', '==', user.uid).get()
  const gardenIds = new Set(directMemberships.docs.map((doc) => doc.data().gardenId).filter(Boolean))

  const docs = await Promise.all([...gardenIds].map((id) => db.collection(GARDENS).doc(id).get()))
  const unique = new Map()
  for (const doc of docs.filter((doc) => doc.exists)) {
    const garden = { id: doc.id, ...doc.data() }
    unique.set(garden.id, garden)
  }
  return Array.from(unique.values()).sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
}

async function listAccessibleGardens(user) {
  const db = getDb()
  const directMemberships = await db.collection(GARDEN_MEMBERS).where('userId', '==', user.uid).get()
  const gardenIds = new Set(directMemberships.docs.map((doc) => doc.data().gardenId).filter(Boolean))
  const owned = await db.collection(GARDENS).where('ownerUserId', '==', user.uid).get()
  for (const doc of owned.docs) gardenIds.add(doc.id)
  const created = await db.collection(GARDENS).where('createdByUserId', '==', user.uid).get()
  for (const doc of created.docs) gardenIds.add(doc.id)

  const docs = await Promise.all([...gardenIds].map((id) => db.collection(GARDENS).doc(id).get()))
  return docs.filter((doc) => doc.exists).map((doc) => ({ id: doc.id, ...doc.data() })).sort(sortGardensByCreatedAt)
}

async function listOwnerAccessibleGardens(user) {
  const gardens = await listAccessibleGardens(user)
  const access = await Promise.all(gardens.map(async (garden) => ({ garden, access: await getGardenAccess(user, garden.id) })))
  return access.filter(({ access }) => access?.role === 'owner').map(({ garden }) => garden)
}

export async function createGarden(user, input) {
  const timestamp = nowIso()

  const ref = await getDb().collection(GARDENS).add(withoutUndefined({
    name: String(input.name ?? '').trim(),
    ownershipType: 'personal',
    ownerUserId: user.uid,
    organizationName: input.organizationName || undefined,
    locationName: input.locationName || undefined,
    address: input.address || undefined,
    notes: input.notes || undefined,
    createdByUserId: user.uid,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))

  await getDb().collection(GARDEN_MEMBERS).add(withoutUndefined({
    gardenId: ref.id,
    userId: user.uid,
    email: user.email || undefined,
    displayName: user.name || user.displayName || undefined,
    role: 'owner',
    invitedByUserId: user.uid,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))

  const doc = await ref.get()
  return { id: doc.id, ...doc.data() }
}

export async function updateGarden(user, gardenId, input) {
  const access = await requireGardenAccess(user, gardenId)
  if (access.role !== 'owner' && access.role !== 'admin') {
    const error = new Error('Garden admin access denied.')
    error.code = 'garden_write_denied'
    throw error
  }

  const ref = getDb().collection(GARDENS).doc(gardenId)
  const doc = await ref.get()
  if (!doc.exists) return null
  const current = doc.data()

  await ref.set(withoutUndefined({
    ...current,
    name: String(input.name ?? current.name ?? '').trim(),
    organizationName: input.organizationName === undefined ? current.organizationName : input.organizationName || undefined,
    locationName: input.locationName === undefined ? current.locationName : input.locationName || undefined,
    address: input.address === undefined ? current.address : input.address || undefined,
    notes: input.notes === undefined ? current.notes : input.notes || undefined,
    gardenOptions: input.gardenOptions ? normalizedGardenOptions(input.gardenOptions) : current.gardenOptions,
    updatedAt: nowIso(),
  }), { merge: false })
  const updated = await ref.get()
  return { id: updated.id, ...updated.data() }
}

export async function getGardenUsageCounts(gardenId) {
  const [recordsSnap, remindersSnap, orderItemsSnap] = await Promise.all([
    getDb().collection(RECORDS).where('gardenId', '==', gardenId).get(),
    getDb().collection(REMINDERS).where('gardenId', '==', gardenId).get(),
    getDb().collection(ORDER_ITEMS).where('gardenId', '==', gardenId).get(),
  ])
  return {
    records: recordsSnap.size,
    reminders: remindersSnap.size,
    orderItems: orderItemsSnap.size,
  }
}

export async function deleteGarden(user, gardenId) {
  const access = await requireGardenAccess(user, gardenId)
  if (access.role !== 'owner') {
    const error = new Error('Garden admin access denied.')
    error.code = 'garden_write_denied'
    throw error
  }

  const ref = getDb().collection(GARDENS).doc(gardenId)
  const doc = await ref.get()
  if (!doc.exists) return { deleted: false, counts: { records: 0, reminders: 0, orderItems: 0 } }
  const garden = { id: doc.id, ...doc.data() }

  const ownerAccessibleGardens = await listOwnerAccessibleGardens(user)
  if (ownerAccessibleGardens.filter((ownedGarden) => ownedGarden.id !== garden.id).length === 0) {
    const error = new Error('Cannot delete your last garden.')
    error.code = 'last_garden'
    throw error
  }

  const counts = await getGardenUsageCounts(gardenId)
  if (counts.records > 0 || counts.reminders > 0 || counts.orderItems > 0) {
    const error = new Error('Cannot delete a garden that still has records, reminders, or order items.')
    error.code = 'garden_in_use'
    error.counts = counts
    throw error
  }

  const [membersSnap, invitesSnap] = await Promise.all([
    getDb().collection(GARDEN_MEMBERS).where('gardenId', '==', gardenId).get(),
    getDb().collection(INVITES).where('gardenId', '==', gardenId).get(),
  ])
  await Promise.all([
    ...membersSnap.docs.map((member) => member.ref.delete()),
    ...invitesSnap.docs.map((invite) => invite.ref.delete()),
    ref.delete(),
  ])
  return { deleted: true, counts }
}

export async function listGardenMembers(user, gardenId) {
  await requireGardenAccess(user, gardenId)
  return await dedupeMembers(GARDEN_MEMBERS, 'gardenId', gardenId)
}

export async function upsertGardenMember(user, gardenId, input) {
  const access = await requireGardenAccess(user, gardenId)
  if (access.role !== 'owner' && access.role !== 'admin') {
    const error = new Error('Garden admin access denied.')
    error.code = 'garden_write_denied'
    throw error
  }
  return await writeGardenMember(gardenId, { ...input, invitedByUserId: input.invitedByUserId || user.uid })
}

async function writeGardenMember(gardenId, input) {
  const timestamp = nowIso()
  const role = GARDEN_ROLES.includes(input.role) ? input.role : 'viewer'
  const userId = String(input.userId ?? '').trim()
  if (!userId) throw new Error('Member user ID is required.')

  await dedupeMembers(GARDEN_MEMBERS, 'gardenId', gardenId)
  const existing = await getDb().collection(GARDEN_MEMBERS).where('gardenId', '==', gardenId).where('userId', '==', userId).limit(1).get()
  const existingData = existing.empty ? null : existing.docs[0].data()
  if (existingData) throw duplicateMemberError()
  if (existingData?.role === 'owner' && role !== 'owner') {
    const members = await dedupeMembers(GARDEN_MEMBERS, 'gardenId', gardenId)
    if (members.filter((member) => member.role === 'owner').length <= 1) throw lastOwnerError()
  }
  const ref = existing.empty ? getDb().collection(GARDEN_MEMBERS).doc() : existing.docs[0].ref
  await ref.set(withoutUndefined({
    gardenId,
    userId,
    email: input.email || undefined,
    displayName: input.displayName || undefined,
    role,
    invitedByUserId: input.invitedByUserId,
    createdAt: existing.empty ? timestamp : existingData.createdAt,
    updatedAt: timestamp,
  }), { merge: false })
  const doc = await ref.get()
  return { id: doc.id, ...doc.data() }
}

export async function removeGardenMember(user, gardenId, memberId) {
  const access = await requireGardenAccess(user, gardenId)
  if (access.role !== 'owner' && access.role !== 'admin') {
    const error = new Error('Garden admin access denied.')
    error.code = 'garden_write_denied'
    throw error
  }
  const ref = getDb().collection(GARDEN_MEMBERS).doc(memberId)
  const doc = await ref.get()
  if (!doc.exists || doc.data().gardenId !== gardenId) return false
  if (doc.data().role === 'owner') {
    const members = await dedupeMembers(GARDEN_MEMBERS, 'gardenId', gardenId)
    if (members.filter((member) => member.role === 'owner').length <= 1) throw lastOwnerError()
  }
  await ref.delete()
  return true
}

export async function createInvite(user, input) {
  const gardenId = input.gardenId || undefined
  if (!gardenId) throw new Error('Invite must target a garden.')
  if (gardenId) {
    const access = await requireGardenAccess(user, gardenId)
    if (access.role !== 'owner' && access.role !== 'admin') {
      const error = new Error('Garden admin access denied.')
      error.code = 'garden_write_denied'
      throw error
    }
  }
  const timestamp = nowIso()
  const token = randomToken()
  const ref = await getDb().collection(INVITES).add(withoutUndefined({
    token,
    gardenId,
    email: input.email || undefined,
    role: input.role || 'viewer',
    createdByUserId: user.uid,
    expiresAt: input.expiresAt || new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
  const doc = await ref.get()
  return { id: doc.id, ...doc.data() }
}

export async function listInvites(user, { gardenId } = {}) {
  if (gardenId) await requireGardenAccess(user, gardenId)
  let snap
  if (gardenId) snap = await getDb().collection(INVITES).where('gardenId', '==', gardenId).get()
  else snap = await getDb().collection(INVITES).where('createdByUserId', '==', user.uid).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
}

export async function resendInvite(user, inviteId) {
  const ref = getDb().collection(INVITES).doc(inviteId)
  const doc = await ref.get()
  if (!doc.exists) return null
  const invite = { id: doc.id, ...doc.data() }
  if (!invite.gardenId) return null

  const access = await requireGardenAccess(user, invite.gardenId)
  if (access.role !== 'owner' && access.role !== 'admin') {
    const error = new Error('Garden admin access denied.')
    error.code = 'garden_write_denied'
    throw error
  }
  if (invite.acceptedAt) {
    const error = new Error('Accepted invites cannot be resent.')
    error.code = 'invite_accepted'
    throw error
  }

  const timestamp = nowIso()
  await ref.set(withoutUndefined({
    ...invite,
    token: randomToken(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
    resentAt: timestamp,
    resentByUserId: user.uid,
    updatedAt: timestamp,
  }), { merge: false })
  const updated = await ref.get()
  return { id: updated.id, ...updated.data() }
}

export async function deleteInvite(user, inviteId) {
  const ref = getDb().collection(INVITES).doc(inviteId)
  const doc = await ref.get()
  if (!doc.exists) return false
  const invite = doc.data()
  if (!invite.gardenId) return false

  const access = await requireGardenAccess(user, invite.gardenId)
  if (access.role !== 'owner' && access.role !== 'admin') {
    const error = new Error('Garden admin access denied.')
    error.code = 'garden_write_denied'
    throw error
  }

  await ref.delete()
  return true
}

export async function acceptInvite(user, token) {
  const snap = await getDb().collection(INVITES).where('token', '==', token).limit(1).get()
  if (snap.empty) return null
  const inviteDoc = snap.docs[0]
  const invite = { id: inviteDoc.id, ...inviteDoc.data() }
  if (invite.acceptedAt) return invite
  if (invite.expiresAt && invite.expiresAt < nowIso()) {
    const error = new Error('Invite has expired.')
    error.code = 'invite_expired'
    throw error
  }
  if (invite.email && user.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
    const error = new Error('Invite is for a different email address.')
    error.code = 'invite_email_mismatch'
    throw error
  }

  if (invite.gardenId) await writeGardenMember(invite.gardenId, { userId: user.uid, email: user.email, displayName: user.name, role: invite.role, invitedByUserId: invite.createdByUserId })

  await inviteDoc.ref.set(withoutUndefined({ ...invite, acceptedAt: nowIso(), acceptedByUserId: user.uid, updatedAt: nowIso() }), { merge: false })
  const accepted = await inviteDoc.ref.get()
  return { id: accepted.id, ...accepted.data() }
}

export async function getGardenAccess(user, gardenId) {
  if (!gardenId) return null
  const gardenDoc = await getDb().collection(GARDENS).doc(gardenId).get()
  if (!gardenDoc.exists) return null
  const garden = { id: gardenDoc.id, ...gardenDoc.data() }
  if (isGlobalAdmin(user)) return { garden, role: 'owner' }
  if (garden.ownerUserId === user.uid) return { garden, role: 'owner' }
  if (garden.createdByUserId === user.uid) return { garden, role: 'owner' }

  const direct = await getDb().collection(GARDEN_MEMBERS).where('gardenId', '==', gardenId).where('userId', '==', user.uid).limit(1).get()
  if (!direct.empty) return { garden, role: direct.docs[0].data().role }

  return null
}

export async function requireGardenAccess(user, gardenId) {
  const access = await getGardenAccess(user, gardenId)
  if (!access) {
    const error = new Error('Garden access denied.')
    error.code = 'garden_access_denied'
    throw error
  }
  return access
}

export async function requireGardenWriteAccess(user, gardenId) {
  const access = await requireGardenAccess(user, gardenId)
  if (!isWriteRole(access.role)) {
    const error = new Error('Garden write access denied.')
    error.code = 'garden_write_denied'
    throw error
  }
  return access
}

export async function resolveGardenId(user, gardenId) {
  if (gardenId) {
    await requireGardenAccess(user, gardenId)
    return gardenId
  }
  await ensureDefaultGarden(user)
  const garden = (await listAccessibleGardens(user))[0]
  return garden.id
}

export async function isFallbackGarden(user, gardenId) {
  if (!gardenId) return false
  await ensureDefaultGarden(user)
  return gardenId === (await listAccessibleGardens(user))[0]?.id
}

export async function resolveWritableGardenId(user, gardenId) {
  let resolvedGardenId = gardenId
  if (!resolvedGardenId) {
    await ensureDefaultGarden(user)
    resolvedGardenId = (await listOwnerAccessibleGardens(user))[0]?.id
  }
  await requireGardenWriteAccess(user, resolvedGardenId)
  return resolvedGardenId
}
