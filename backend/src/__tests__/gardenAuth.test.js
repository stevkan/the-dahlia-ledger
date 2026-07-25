import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { isGlobalAdmin } = vi.hoisted(() => ({ isGlobalAdmin: vi.fn(() => false) }))
vi.mock('../users.js', () => ({ isGlobalAdmin }))

import '../env.js'
import { getPool } from '../db.js'
import { requireGardenAccess, requireGardenWriteAccess } from '../gardens.js'

const OWNER_GARDEN_ID = 'vitest-auth-owner-garden'
const CREATED_BY_GARDEN_ID = 'vitest-auth-created-by-garden'
const MEMBER_GARDEN_ID = 'vitest-auth-member-garden'
const TEST_GARDEN_IDS = [OWNER_GARDEN_ID, CREATED_BY_GARDEN_ID, MEMBER_GARDEN_ID]

const pool = getPool()
const user = { uid: 'user-1', email: 'user@example.com' }

async function cleanUpTestData() {
  await pool.query('DELETE FROM garden_members WHERE garden_id = ANY($1)', [TEST_GARDEN_IDS])
  await pool.query('DELETE FROM gardens WHERE id = ANY($1)', [TEST_GARDEN_IDS])
}

async function insertGarden(id, { ownerUserId = 'other', createdByUserId = 'other' } = {}) {
  await pool.query(
    `INSERT INTO gardens (id, name, owner_user_id, created_by_user_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, now()::text, now()::text)`,
    [id, id, ownerUserId, createdByUserId],
  )
}

async function insertMember(gardenId, role) {
  await pool.query(
    `INSERT INTO garden_members (id, garden_id, user_id, role, created_at, updated_at)
     VALUES ($1, $2, $3, $4, now()::text, now()::text)`,
    [`${gardenId}-member`, gardenId, user.uid, role],
  )
}

beforeEach(cleanUpTestData)

afterEach(() => {
  isGlobalAdmin.mockReturnValue(false)
})

afterAll(async () => {
  await cleanUpTestData()
  await pool.end()
})

describe('requireGardenAccess (Postgres)', () => {
  it('grants owner access via ownerUserId', async () => {
    await insertGarden(OWNER_GARDEN_ID, { ownerUserId: user.uid })
    const access = await requireGardenAccess(user, OWNER_GARDEN_ID)
    expect(access.role).toBe('owner')
    expect(access.garden.ownerUserId).toBe(user.uid)
  })

  it('grants owner access via createdByUserId', async () => {
    await insertGarden(CREATED_BY_GARDEN_ID, { createdByUserId: user.uid })
    const access = await requireGardenAccess(user, CREATED_BY_GARDEN_ID)
    expect(access.role).toBe('owner')
  })

  it('grants global admin owner-level access regardless of garden membership', async () => {
    isGlobalAdmin.mockReturnValue(true)
    await insertGarden(MEMBER_GARDEN_ID)
    const access = await requireGardenAccess(user, MEMBER_GARDEN_ID)
    expect(access.role).toBe('owner')
  })

  it('grants member access with the role stored in the member row', async () => {
    await insertGarden(MEMBER_GARDEN_ID)
    await insertMember(MEMBER_GARDEN_ID, 'editor')
    const access = await requireGardenAccess(user, MEMBER_GARDEN_ID)
    expect(access.role).toBe('editor')
  })

  it('grants viewer access to read-only members', async () => {
    await insertGarden(MEMBER_GARDEN_ID)
    await insertMember(MEMBER_GARDEN_ID, 'viewer')
    const access = await requireGardenAccess(user, MEMBER_GARDEN_ID)
    expect(access.role).toBe('viewer')
  })

  it('throws garden_access_denied when the garden does not exist', async () => {
    await expect(requireGardenAccess(user, 'no-such-garden')).rejects.toMatchObject({
      code: 'garden_access_denied',
    })
  })

  it('throws garden_access_denied when the user is neither owner nor member', async () => {
    await insertGarden(MEMBER_GARDEN_ID)
    await expect(requireGardenAccess(user, MEMBER_GARDEN_ID)).rejects.toMatchObject({
      code: 'garden_access_denied',
    })
  })
})

describe('requireGardenWriteAccess (Postgres)', () => {
  it('grants write access to the garden owner', async () => {
    await insertGarden(OWNER_GARDEN_ID, { ownerUserId: user.uid })
    const access = await requireGardenWriteAccess(user, OWNER_GARDEN_ID)
    expect(access.role).toBe('owner')
  })

  it('grants write access to admin members', async () => {
    await insertGarden(MEMBER_GARDEN_ID)
    await insertMember(MEMBER_GARDEN_ID, 'admin')
    const access = await requireGardenWriteAccess(user, MEMBER_GARDEN_ID)
    expect(access.role).toBe('admin')
  })

  it('grants write access to editor members', async () => {
    await insertGarden(MEMBER_GARDEN_ID)
    await insertMember(MEMBER_GARDEN_ID, 'editor')
    const access = await requireGardenWriteAccess(user, MEMBER_GARDEN_ID)
    expect(access.role).toBe('editor')
  })

  it('throws garden_write_denied for viewer members', async () => {
    await insertGarden(MEMBER_GARDEN_ID)
    await insertMember(MEMBER_GARDEN_ID, 'viewer')
    await expect(requireGardenWriteAccess(user, MEMBER_GARDEN_ID)).rejects.toMatchObject({
      code: 'garden_write_denied',
    })
  })

  it('throws garden_access_denied when the garden does not exist', async () => {
    await expect(requireGardenWriteAccess(user, 'no-such-garden')).rejects.toMatchObject({
      code: 'garden_access_denied',
    })
  })

  it('throws garden_access_denied when the user has no membership at all', async () => {
    await insertGarden(MEMBER_GARDEN_ID)
    await expect(requireGardenWriteAccess(user, MEMBER_GARDEN_ID)).rejects.toMatchObject({
      code: 'garden_access_denied',
    })
  })
})
