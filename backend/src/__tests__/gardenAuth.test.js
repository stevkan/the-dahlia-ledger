import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../firebase.js', () => ({ getDb: vi.fn() }))
vi.mock('../users.js', () => ({ isGlobalAdmin: vi.fn(() => false) }))

import { requireGardenAccess, requireGardenWriteAccess } from '../gardens.js'
import { getDb } from '../firebase.js'
import { isGlobalAdmin } from '../users.js'

/**
 * Builds a minimal Firestore double that handles:
 *   getDb().collection('gardens').doc(id).get()        → gardenDoc
 *   getDb().collection('gardenMembers').where(...).where(...).limit(1).get() → memberSnap
 */
function makeDb({ garden = null, member = null } = {}) {
  return {
    collection: vi.fn((name) => {
      if (name === 'gardens') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn(async () => ({
              exists: !!garden,
              id: 'garden-1',
              data: () => garden,
            })),
          })),
        }
      }
      // gardenMembers
      return {
        where: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: vi.fn(async () => ({
                empty: !member,
                docs: member ? [{ data: () => member }] : [],
              })),
            })),
          })),
        })),
      }
    }),
  }
}

const user = { uid: 'user-1', email: 'user@example.com' }
const ownerGarden = { ownerUserId: 'user-1', createdByUserId: 'other' }
const otherGarden = { ownerUserId: 'other', createdByUserId: 'other' }

describe('requireGardenAccess', () => {
  beforeEach(() => {
    isGlobalAdmin.mockReturnValue(false)
  })

  it('grants owner access via ownerUserId', async () => {
    getDb.mockReturnValue(makeDb({ garden: ownerGarden }))
    const access = await requireGardenAccess(user, 'garden-1')
    expect(access.role).toBe('owner')
    expect(access.garden.ownerUserId).toBe('user-1')
  })

  it('grants owner access via createdByUserId', async () => {
    getDb.mockReturnValue(makeDb({ garden: { ownerUserId: 'other', createdByUserId: 'user-1' } }))
    const access = await requireGardenAccess(user, 'garden-1')
    expect(access.role).toBe('owner')
  })

  it('grants global admin owner-level access regardless of garden membership', async () => {
    isGlobalAdmin.mockReturnValue(true)
    getDb.mockReturnValue(makeDb({ garden: otherGarden }))
    const access = await requireGardenAccess(user, 'garden-1')
    expect(access.role).toBe('owner')
  })

  it('grants member access with the role stored in the member doc', async () => {
    getDb.mockReturnValue(makeDb({ garden: otherGarden, member: { role: 'editor' } }))
    const access = await requireGardenAccess(user, 'garden-1')
    expect(access.role).toBe('editor')
  })

  it('grants viewer access to read-only members', async () => {
    getDb.mockReturnValue(makeDb({ garden: otherGarden, member: { role: 'viewer' } }))
    const access = await requireGardenAccess(user, 'garden-1')
    expect(access.role).toBe('viewer')
  })

  it('throws garden_access_denied when the garden does not exist', async () => {
    getDb.mockReturnValue(makeDb({ garden: null }))
    await expect(requireGardenAccess(user, 'garden-1')).rejects.toMatchObject({
      code: 'garden_access_denied',
    })
  })

  it('throws garden_access_denied when the user is neither owner nor member', async () => {
    getDb.mockReturnValue(makeDb({ garden: otherGarden, member: null }))
    await expect(requireGardenAccess(user, 'garden-1')).rejects.toMatchObject({
      code: 'garden_access_denied',
    })
  })
})

describe('requireGardenWriteAccess', () => {
  beforeEach(() => {
    isGlobalAdmin.mockReturnValue(false)
  })

  it('grants write access to the garden owner', async () => {
    getDb.mockReturnValue(makeDb({ garden: ownerGarden }))
    const access = await requireGardenWriteAccess(user, 'garden-1')
    expect(access.role).toBe('owner')
  })

  it('grants write access to admin members', async () => {
    getDb.mockReturnValue(makeDb({ garden: otherGarden, member: { role: 'admin' } }))
    const access = await requireGardenWriteAccess(user, 'garden-1')
    expect(access.role).toBe('admin')
  })

  it('grants write access to editor members', async () => {
    getDb.mockReturnValue(makeDb({ garden: otherGarden, member: { role: 'editor' } }))
    const access = await requireGardenWriteAccess(user, 'garden-1')
    expect(access.role).toBe('editor')
  })

  it('throws garden_write_denied for viewer members', async () => {
    getDb.mockReturnValue(makeDb({ garden: otherGarden, member: { role: 'viewer' } }))
    await expect(requireGardenWriteAccess(user, 'garden-1')).rejects.toMatchObject({
      code: 'garden_write_denied',
    })
  })

  it('throws garden_access_denied when the garden does not exist', async () => {
    getDb.mockReturnValue(makeDb({ garden: null }))
    await expect(requireGardenWriteAccess(user, 'garden-1')).rejects.toMatchObject({
      code: 'garden_access_denied',
    })
  })

  it('throws garden_access_denied when the user has no membership at all', async () => {
    getDb.mockReturnValue(makeDb({ garden: otherGarden, member: null }))
    await expect(requireGardenWriteAccess(user, 'garden-1')).rejects.toMatchObject({
      code: 'garden_access_denied',
    })
  })
})
