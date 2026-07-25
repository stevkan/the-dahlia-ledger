import { query } from './db.js'

const USER_SELECT_COLUMNS = `
  id, user_id AS "userId", email, display_name AS "displayName", photo_url AS "photoUrl", provider,
  created_at AS "createdAt", last_seen_at AS "lastSeenAt", updated_at AS "updatedAt"
`

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

export async function upsertKnownUser(user) {
  if (!user?.uid) return null
  const timestamp = nowIso()

  const { rows } = await query(
    `INSERT INTO users (id, user_id, email, display_name, photo_url, provider, created_at, last_seen_at, updated_at)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $6, $6)
     ON CONFLICT (id) DO UPDATE SET
       user_id = $1, email = $2, display_name = $3, photo_url = $4, provider = $5,
       last_seen_at = $6, updated_at = $6
     RETURNING ${USER_SELECT_COLUMNS}`,
    [
      user.uid,
      user.email || null,
      user.name || user.displayName || null,
      user.picture || null,
      user.firebase?.sign_in_provider || null,
      timestamp,
    ],
  )
  return rows[0]
}

export async function listKnownUsers() {
  const { rows } = await query(`SELECT ${USER_SELECT_COLUMNS} FROM users`)
  return rows.sort((a, b) => String(a.displayName || a.email || a.userId).localeCompare(String(b.displayName || b.email || b.userId)))
}

export async function getKnownUser(userId) {
  const id = String(userId ?? '').trim()
  if (!id) return null

  const { rows } = await query(`SELECT ${USER_SELECT_COLUMNS} FROM users WHERE id = $1`, [id])
  return rows[0] ?? null
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

  const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id])
  return rowCount > 0
}
