import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { getPool, withTransaction } from '../src/db.js'

const GARDENS_COLLECTION = 'gardens'
const GARDEN_MEMBERS_COLLECTION = 'gardenMembers'
const INVITES_COLLECTION = 'invites'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const GARDEN_WRITABLE_COLUMNS = ['name', 'ownership_type', 'owner_user_id', 'created_by_user_id', 'organization_name', 'location_name', 'address', 'notes', 'is_default', 'garden_options', 'created_at', 'updated_at']
const INSERT_GARDEN_SQL = `INSERT INTO gardens (id, ${GARDEN_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${GARDEN_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

const MEMBER_WRITABLE_COLUMNS = ['garden_id', 'user_id', 'email', 'display_name', 'role', 'invited_by_user_id', 'created_at', 'updated_at']
const INSERT_MEMBER_SQL = `INSERT INTO garden_members (id, ${MEMBER_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${MEMBER_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

const INVITE_WRITABLE_COLUMNS = ['token', 'garden_id', 'email', 'role', 'created_by_user_id', 'expires_at', 'accepted_at', 'accepted_by_user_id', 'resent_at', 'resent_by_user_id', 'created_at', 'updated_at']
const INSERT_INVITE_SQL = `INSERT INTO invites (id, ${INVITE_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${INVITE_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

function gardenToParams(garden) {
  return [
    garden.name ?? null,
    garden.ownershipType ?? null,
    garden.ownerUserId ?? null,
    garden.createdByUserId ?? null,
    garden.organizationName ?? null,
    garden.locationName ?? null,
    garden.address ?? null,
    garden.notes ?? null,
    Boolean(garden.isDefault),
    garden.gardenOptions ? JSON.stringify(garden.gardenOptions) : null,
    garden.createdAt ?? null,
    garden.updatedAt ?? null,
  ]
}

function memberToParams(member) {
  return [
    member.gardenId ?? null,
    member.userId ?? null,
    member.email ?? null,
    member.displayName ?? null,
    member.role ?? null,
    member.invitedByUserId ?? null,
    member.createdAt ?? null,
    member.updatedAt ?? null,
  ]
}

function inviteToParams(invite) {
  return [
    invite.token ?? null,
    invite.gardenId ?? null,
    invite.email ?? null,
    invite.role ?? null,
    invite.createdByUserId ?? null,
    invite.expiresAt ?? null,
    invite.acceptedAt ?? null,
    invite.acceptedByUserId ?? null,
    invite.resentAt ?? null,
    invite.resentByUserId ?? null,
    invite.createdAt ?? null,
    invite.updatedAt ?? null,
  ]
}

const db = getDb()
console.log(`${APPLY ? 'Apply' : 'Dry run'}: migrate-gardens-to-postgres`)

const [gardensSnap, membersSnap, invitesSnap] = await Promise.all([
  db.collection(GARDENS_COLLECTION).get(),
  db.collection(GARDEN_MEMBERS_COLLECTION).get(),
  db.collection(INVITES_COLLECTION).get(),
])

const gardens = gardensSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const members = membersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const invites = invitesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

console.log(`Firestore ${GARDENS_COLLECTION}: ${gardens.length}`)
console.log(`Firestore ${GARDEN_MEMBERS_COLLECTION}: ${members.length}`)
console.log(`Firestore ${INVITES_COLLECTION}: ${invites.length}`)

if (!APPLY) {
  console.log('\nDry run only — no Postgres writes made. Re-run with --apply to migrate verbatim.')
  process.exit(0)
}

const pool = getPool()
const [{ rows: existingGardens }, { rows: existingMembers }, { rows: existingInvites }] = await Promise.all([
  pool.query('SELECT count(*)::int AS count FROM gardens'),
  pool.query('SELECT count(*)::int AS count FROM garden_members'),
  pool.query('SELECT count(*)::int AS count FROM invites'),
])
const alreadyHasRows = existingGardens[0].count > 0 || existingMembers[0].count > 0 || existingInvites[0].count > 0
if (alreadyHasRows && !FORCE) {
  console.error(`\nRefusing to --apply: gardens has ${existingGardens[0].count}, garden_members has ${existingMembers[0].count}, invites has ${existingInvites[0].count} row(s) already. Pass --force to insert anyway.`)
  process.exit(1)
}

await withTransaction(async (client) => {
  for (const garden of gardens) {
    await client.query(INSERT_GARDEN_SQL, [garden.id, ...gardenToParams(garden)])
  }
  for (const member of members) {
    await client.query(INSERT_MEMBER_SQL, [member.id, ...memberToParams(member)])
  }
  for (const invite of invites) {
    await client.query(INSERT_INVITE_SQL, [invite.id, ...inviteToParams(invite)])
  }
})

console.log(`\nInserted ${gardens.length} rows into gardens.`)
console.log(`Inserted ${members.length} rows into garden_members.`)
console.log(`Inserted ${invites.length} rows into invites.`)
await pool.end()
