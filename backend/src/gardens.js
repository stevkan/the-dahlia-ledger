import crypto from 'node:crypto'
import { isGlobalAdmin } from './users.js'
import { query, withTransaction } from './db.js'
import { clearLegacyUnassignedCache } from './records.js'

export const GARDEN_ROLES = ['owner', 'admin', 'editor', 'viewer']

const GARDEN_SELECT_COLUMNS = `
  id, name, ownership_type AS "ownershipType", owner_user_id AS "ownerUserId", created_by_user_id AS "createdByUserId",
  organization_name AS "organizationName", location_name AS "locationName", address, notes,
  is_default AS "isDefault", garden_options AS "gardenOptions", created_at AS "createdAt", updated_at AS "updatedAt"
`

const MEMBER_SELECT_COLUMNS = `
  id, garden_id AS "gardenId", user_id AS "userId", email, display_name AS "displayName", role,
  invited_by_user_id AS "invitedByUserId", created_at AS "createdAt", updated_at AS "updatedAt"
`

const INVITE_SELECT_COLUMNS = `
  id, token, garden_id AS "gardenId", email, role, created_by_user_id AS "createdByUserId",
  expires_at AS "expiresAt", accepted_at AS "acceptedAt", accepted_by_user_id AS "acceptedByUserId",
  resent_at AS "resentAt", resent_by_user_id AS "resentByUserId", created_at AS "createdAt", updated_at AS "updatedAt"
`

function nowIso() {
  return new Date().toISOString()
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

async function dedupeMembersForGarden(gardenId) {
  const { rows } = await query(`SELECT ${MEMBER_SELECT_COLUMNS} FROM garden_members WHERE garden_id = $1`, [gardenId])
  const byUserId = new Map()
  const duplicates = []
  for (const member of rows) {
    const existing = byUserId.get(member.userId)
    if (!existing || isNewerMember(member, existing)) {
      if (existing) duplicates.push(existing)
      byUserId.set(member.userId, member)
    } else {
      duplicates.push(member)
    }
  }
  if (duplicates.length > 0) {
    await query('DELETE FROM garden_members WHERE id = ANY($1::text[])', [duplicates.map((member) => member.id)])
  }
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

async function getGardenById(gardenId) {
  const { rows } = await query(`SELECT ${GARDEN_SELECT_COLUMNS} FROM gardens WHERE id = $1`, [gardenId])
  return rows[0] ?? null
}

export async function ensureDefaultGarden(user) {
  const stableId = defaultGardenId(user)
  const stable = await getGardenById(stableId)
  if (stable) {
    await ensureGardenMembership(user, stableId, 'owner')
    return stable
  }

  const { rows: legacyDefaultRows } = await query(
    `SELECT ${GARDEN_SELECT_COLUMNS} FROM gardens WHERE owner_user_id = $1 AND is_default = true LIMIT 1`,
    [user.uid],
  )
  if (legacyDefaultRows.length > 0) {
    const legacy = legacyDefaultRows[0]
    await query(
      `INSERT INTO gardens (id, name, ownership_type, owner_user_id, created_by_user_id, organization_name, location_name, address, notes, is_default, garden_options, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        stableId,
        legacy.name,
        legacy.ownershipType,
        legacy.ownerUserId,
        legacy.createdByUserId,
        legacy.organizationName,
        legacy.locationName,
        legacy.address,
        legacy.notes,
        legacy.isDefault,
        legacy.gardenOptions ? JSON.stringify(legacy.gardenOptions) : null,
        legacy.createdAt,
        nowIso(),
      ],
    )
    await ensureGardenMembership(user, stableId, 'owner')
    return await getGardenById(stableId)
  }

  const { rows: membershipRows } = await query('SELECT garden_id AS "gardenId" FROM garden_members WHERE user_id = $1', [user.uid])
  for (const { gardenId } of membershipRows) {
    if (!gardenId) continue
    const garden = await getGardenById(gardenId)
    if (garden) return garden
  }

  const timestamp = nowIso()
  await query(
    `INSERT INTO gardens (id, name, ownership_type, owner_user_id, created_by_user_id, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [stableId, `${userDisplayName(user)} Garden`, 'personal', user.uid, user.uid, true, timestamp],
  )

  await ensureGardenMembership(user, stableId, 'owner')
  await assignLegacyRecordsToGarden(stableId)

  return await getGardenById(stableId)
}

async function ensureGardenMembership(user, gardenId, role) {
  const { rows } = await query('SELECT 1 AS present FROM garden_members WHERE garden_id = $1 AND user_id = $2 LIMIT 1', [gardenId, user.uid])
  if (rows.length > 0) return
  const timestamp = nowIso()
  await query(
    `INSERT INTO garden_members (id, garden_id, user_id, email, display_name, role, invited_by_user_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [crypto.randomUUID(), gardenId, user.uid, user.email || null, user.name || null, role, user.uid, timestamp],
  )
}

async function assignLegacyRecordsToGarden(gardenId) {
  const { rowCount } = await query(
    `UPDATE dahlia_records
     SET garden_id = $1
     WHERE garden_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM dahlia_records WHERE garden_id IS NOT NULL)`,
    [gardenId],
  )
  if (rowCount > 0) clearLegacyUnassignedCache()
  return rowCount
}

export async function listGardens(user) {
  await ensureDefaultGarden(user)
  const { rows: memberships } = await query('SELECT DISTINCT garden_id AS "gardenId" FROM garden_members WHERE user_id = $1', [user.uid])
  const gardenIds = memberships.map((membership) => membership.gardenId).filter(Boolean)
  if (gardenIds.length === 0) return []

  const { rows } = await query(`SELECT ${GARDEN_SELECT_COLUMNS} FROM gardens WHERE id = ANY($1::text[])`, [gardenIds])
  return rows.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
}

async function listAccessibleGardens(user) {
  const { rows: memberships } = await query('SELECT garden_id AS "gardenId" FROM garden_members WHERE user_id = $1', [user.uid])
  const gardenIds = new Set(memberships.map((membership) => membership.gardenId).filter(Boolean))

  const { rows: owned } = await query('SELECT id FROM gardens WHERE owner_user_id = $1', [user.uid])
  for (const row of owned) gardenIds.add(row.id)
  const { rows: created } = await query('SELECT id FROM gardens WHERE created_by_user_id = $1', [user.uid])
  for (const row of created) gardenIds.add(row.id)

  if (gardenIds.size === 0) return []
  const { rows } = await query(`SELECT ${GARDEN_SELECT_COLUMNS} FROM gardens WHERE id = ANY($1::text[])`, [[...gardenIds]])
  return rows.sort(sortGardensByCreatedAt)
}

async function listOwnerAccessibleGardens(user) {
  const gardens = await listAccessibleGardens(user)
  const access = await Promise.all(gardens.map(async (garden) => ({ garden, access: await getGardenAccess(user, garden.id) })))
  return access.filter(({ access }) => access?.role === 'owner').map(({ garden }) => garden)
}

export async function createGarden(user, input) {
  const timestamp = nowIso()
  const id = crypto.randomUUID()

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO gardens (id, name, ownership_type, owner_user_id, created_by_user_id, organization_name, location_name, address, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        id,
        String(input.name ?? '').trim(),
        'personal',
        user.uid,
        user.uid,
        input.organizationName || null,
        input.locationName || null,
        input.address || null,
        input.notes || null,
        timestamp,
      ],
    )

    await client.query(
      `INSERT INTO garden_members (id, garden_id, user_id, email, display_name, role, invited_by_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [crypto.randomUUID(), id, user.uid, user.email || null, user.name || user.displayName || null, 'owner', user.uid, timestamp],
    )
  })

  return await getGardenById(id)
}

export async function updateGarden(user, gardenId, input) {
  const access = await requireGardenAccess(user, gardenId)
  if (access.role !== 'owner' && access.role !== 'admin') {
    const error = new Error('Garden admin access denied.')
    error.code = 'garden_write_denied'
    throw error
  }

  const current = await getGardenById(gardenId)
  if (!current) return null

  const name = String(input.name ?? current.name ?? '').trim()
  const organizationName = input.organizationName === undefined ? current.organizationName : (input.organizationName || null)
  const locationName = input.locationName === undefined ? current.locationName : (input.locationName || null)
  const address = input.address === undefined ? current.address : (input.address || null)
  const notes = input.notes === undefined ? current.notes : (input.notes || null)
  const gardenOptions = input.gardenOptions ? normalizedGardenOptions(input.gardenOptions) : current.gardenOptions

  await query(
    `UPDATE gardens SET name = $2, organization_name = $3, location_name = $4, address = $5, notes = $6, garden_options = $7, updated_at = $8
     WHERE id = $1`,
    [gardenId, name, organizationName, locationName, address, notes, gardenOptions ? JSON.stringify(gardenOptions) : null, nowIso()],
  )
  return await getGardenById(gardenId)
}

export async function getGardenUsageCounts(gardenId) {
  const [recordCountResult, reminderCountResult, orderItemCountResult] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM dahlia_records WHERE garden_id = $1', [gardenId]),
    query('SELECT COUNT(*)::int AS count FROM maintenance_reminders WHERE garden_id = $1', [gardenId]),
    query('SELECT COUNT(*)::int AS count FROM order_items WHERE garden_id = $1', [gardenId]),
  ])
  return {
    records: recordCountResult.rows[0]?.count ?? 0,
    reminders: reminderCountResult.rows[0]?.count ?? 0,
    orderItems: orderItemCountResult.rows[0]?.count ?? 0,
  }
}

export async function deleteGarden(user, gardenId) {
  const access = await requireGardenAccess(user, gardenId)
  if (access.role !== 'owner') {
    const error = new Error('Garden admin access denied.')
    error.code = 'garden_write_denied'
    throw error
  }

  const garden = await getGardenById(gardenId)
  if (!garden) return { deleted: false, counts: { records: 0, reminders: 0, orderItems: 0 } }

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

  // garden_members and invites cascade automatically (ON DELETE CASCADE); the usage check above
  // already guarantees no records/reminders/order items remain to violate their FK into gardens.
  await query('DELETE FROM gardens WHERE id = $1', [gardenId])
  return { deleted: true, counts }
}

export async function listGardenMembers(user, gardenId) {
  await requireGardenAccess(user, gardenId)
  return await dedupeMembersForGarden(gardenId)
}

export async function getKnownUserGardenUsage(userId) {
  const [{ rows: memberships }, { rows: ownedGardens }] = await Promise.all([
    query(`SELECT ${MEMBER_SELECT_COLUMNS} FROM garden_members WHERE user_id = $1`, [userId]),
    query('SELECT id FROM gardens WHERE owner_user_id = $1', [userId]),
  ])
  const ownsGarden = ownedGardens.length > 0 || memberships.some((member) => member.role === 'owner')
  const addedByAnotherUser = memberships.some((member) => member.invitedByUserId && member.invitedByUserId !== userId)
  return { ownsGarden, addedByAnotherUser }
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

  await dedupeMembersForGarden(gardenId)
  const { rows: existingRows } = await query(
    `SELECT ${MEMBER_SELECT_COLUMNS} FROM garden_members WHERE garden_id = $1 AND user_id = $2 LIMIT 1`,
    [gardenId, userId],
  )
  const existingData = existingRows[0] ?? null
  if (existingData) throw duplicateMemberError()
  if (existingData?.role === 'owner' && role !== 'owner') {
    const members = await dedupeMembersForGarden(gardenId)
    if (members.filter((member) => member.role === 'owner').length <= 1) throw lastOwnerError()
  }

  const id = existingData ? existingData.id : crypto.randomUUID()
  const createdAt = existingData ? existingData.createdAt : timestamp

  await query(
    `INSERT INTO garden_members (id, garden_id, user_id, email, display_name, role, invited_by_user_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       garden_id = $2, user_id = $3, email = $4, display_name = $5, role = $6, invited_by_user_id = $7, updated_at = $9`,
    [id, gardenId, userId, input.email || null, input.displayName || null, role, input.invitedByUserId || null, createdAt, timestamp],
  )

  const { rows } = await query(`SELECT ${MEMBER_SELECT_COLUMNS} FROM garden_members WHERE id = $1`, [id])
  return rows[0]
}

export async function removeGardenMember(user, gardenId, memberId) {
  const access = await requireGardenAccess(user, gardenId)
  const { rows } = await query(`SELECT ${MEMBER_SELECT_COLUMNS} FROM garden_members WHERE id = $1`, [memberId])
  const member = rows[0]
  if (!member || member.gardenId !== gardenId) return false
  const isSelf = member.userId === user.uid
  if (access.role !== 'owner' && access.role !== 'admin' && !isSelf) {
    const error = new Error('Garden admin access denied.')
    error.code = 'garden_write_denied'
    throw error
  }
  if (member.role === 'owner') {
    const members = await dedupeMembersForGarden(gardenId)
    if (members.filter((m) => m.role === 'owner').length <= 1) throw lastOwnerError()
  }
  await query('DELETE FROM garden_members WHERE id = $1', [memberId])
  return true
}

// Only removes this user's own memberships and reports which gardens that orphans (no owner
// left) — it does NOT delete the orphaned gardens themselves. Callers that need those gardens'
// content gone (e.g. full account deletion) must clean up records/reminders/order items via
// their own modules FIRST, then call deleteOrphanedGardens — garden_id has a real foreign key
// into gardens now, so tearing down a garden shell while content still points at it would fail.
export async function removeUserFromAllGardens(userId) {
  const { rows: memberships } = await query('SELECT garden_id AS "gardenId" FROM garden_members WHERE user_id = $1', [userId])
  const gardenIds = [...new Set(memberships.map((membership) => membership.gardenId).filter(Boolean))]
  await query('DELETE FROM garden_members WHERE user_id = $1', [userId])

  const orphanedGardenIds = []
  for (const gardenId of gardenIds) {
    const remainingMembers = await dedupeMembersForGarden(gardenId)
    if (!remainingMembers.some((member) => member.role === 'owner')) orphanedGardenIds.push(gardenId)
  }
  return orphanedGardenIds
}

// garden_members/invites cascade automatically (ON DELETE CASCADE); dahlia_records,
// maintenance_reminders, and order_items do not, so their content must already be gone by the
// time this runs or the FK will reject the delete.
export async function deleteOrphanedGardens(gardenIds) {
  await Promise.all(gardenIds.map((gardenId) => query('DELETE FROM gardens WHERE id = $1', [gardenId])))
}

export async function createInvite(user, input) {
  const gardenId = input.gardenId || undefined
  if (!gardenId) throw new Error('Invite must target a garden.')

  const access = await requireGardenAccess(user, gardenId)
  if (access.role !== 'owner' && access.role !== 'admin') {
    const error = new Error('Garden admin access denied.')
    error.code = 'garden_write_denied'
    throw error
  }
  const timestamp = nowIso()
  const token = randomToken()
  const id = crypto.randomUUID()
  await query(
    `INSERT INTO invites (id, token, garden_id, email, role, created_by_user_id, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      id,
      token,
      gardenId,
      input.email || null,
      input.role || 'viewer',
      user.uid,
      input.expiresAt || new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
      timestamp,
    ],
  )
  const { rows } = await query(`SELECT ${INVITE_SELECT_COLUMNS} FROM invites WHERE id = $1`, [id])
  return rows[0]
}

export async function listInvites(user, { gardenId } = {}) {
  if (gardenId) await requireGardenAccess(user, gardenId)
  const { rows } = gardenId
    ? await query(`SELECT ${INVITE_SELECT_COLUMNS} FROM invites WHERE garden_id = $1`, [gardenId])
    : await query(`SELECT ${INVITE_SELECT_COLUMNS} FROM invites WHERE created_by_user_id = $1`, [user.uid])
  return rows.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
}

export async function resendInvite(user, inviteId) {
  const { rows } = await query(`SELECT ${INVITE_SELECT_COLUMNS} FROM invites WHERE id = $1`, [inviteId])
  const invite = rows[0]
  if (!invite) return null
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
  await query(
    `UPDATE invites SET token = $2, expires_at = $3, resent_at = $4, resent_by_user_id = $5, updated_at = $4 WHERE id = $1`,
    [inviteId, randomToken(), new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(), timestamp, user.uid],
  )
  const { rows: updatedRows } = await query(`SELECT ${INVITE_SELECT_COLUMNS} FROM invites WHERE id = $1`, [inviteId])
  return updatedRows[0]
}

export async function deleteInvite(user, inviteId) {
  const { rows } = await query(`SELECT ${INVITE_SELECT_COLUMNS} FROM invites WHERE id = $1`, [inviteId])
  const invite = rows[0]
  if (!invite) return false
  if (!invite.gardenId) return false

  const access = await requireGardenAccess(user, invite.gardenId)
  if (access.role !== 'owner' && access.role !== 'admin') {
    const error = new Error('Garden admin access denied.')
    error.code = 'garden_write_denied'
    throw error
  }

  await query('DELETE FROM invites WHERE id = $1', [inviteId])
  return true
}

export async function acceptInvite(user, token) {
  const { rows } = await query(`SELECT ${INVITE_SELECT_COLUMNS} FROM invites WHERE token = $1 LIMIT 1`, [token])
  const invite = rows[0]
  if (!invite) return null
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

  const timestamp = nowIso()
  await query(
    `UPDATE invites SET accepted_at = $2, accepted_by_user_id = $3, updated_at = $2 WHERE id = $1`,
    [invite.id, timestamp, user.uid],
  )
  const { rows: acceptedRows } = await query(`SELECT ${INVITE_SELECT_COLUMNS} FROM invites WHERE id = $1`, [invite.id])
  return acceptedRows[0]
}

export async function getGardenAccess(user, gardenId) {
  if (!gardenId) return null
  const garden = await getGardenById(gardenId)
  if (!garden) return null
  if (isGlobalAdmin(user)) return { garden, role: 'owner' }
  if (garden.ownerUserId === user.uid) return { garden, role: 'owner' }
  if (garden.createdByUserId === user.uid) return { garden, role: 'owner' }

  const { rows } = await query('SELECT role FROM garden_members WHERE garden_id = $1 AND user_id = $2 LIMIT 1', [gardenId, user.uid])
  if (rows.length > 0) return { garden, role: rows[0].role }

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
