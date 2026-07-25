import { describe, it, expect, afterEach, vi } from 'vitest'

const { query } = vi.hoisted(() => {
  const query = vi.fn()
  return { query }
})

vi.mock('../db.js', () => ({ query }))

import { deleteKnownUser, isGlobalAdmin } from '../users.js'

describe('isGlobalAdmin', () => {
  afterEach(() => {
    delete process.env.GLOBAL_ADMIN_UIDS
    delete process.env.GLOBAL_ADMIN_EMAILS
  })

  it('returns false for null', () => {
    expect(isGlobalAdmin(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isGlobalAdmin(undefined)).toBe(false)
  })

  it('returns false when env vars are absent', () => {
    expect(isGlobalAdmin({ uid: 'user-1', email: 'user@example.com' })).toBe(false)
  })

  it('returns true when uid matches GLOBAL_ADMIN_UIDS', () => {
    process.env.GLOBAL_ADMIN_UIDS = 'admin-uid'
    expect(isGlobalAdmin({ uid: 'admin-uid' })).toBe(true)
  })

  it('matches uid case-insensitively', () => {
    process.env.GLOBAL_ADMIN_UIDS = 'Admin-UID'
    expect(isGlobalAdmin({ uid: 'admin-uid' })).toBe(true)
  })

  it('returns true when email matches GLOBAL_ADMIN_EMAILS', () => {
    process.env.GLOBAL_ADMIN_EMAILS = 'admin@example.com'
    expect(isGlobalAdmin({ uid: 'other', email: 'admin@example.com' })).toBe(true)
  })

  it('matches email case-insensitively', () => {
    process.env.GLOBAL_ADMIN_EMAILS = 'ADMIN@EXAMPLE.COM'
    expect(isGlobalAdmin({ uid: 'other', email: 'admin@example.com' })).toBe(true)
  })

  it('returns false when uid and email do not match any admin value', () => {
    process.env.GLOBAL_ADMIN_UIDS = 'other-uid'
    process.env.GLOBAL_ADMIN_EMAILS = 'other@example.com'
    expect(isGlobalAdmin({ uid: 'user-uid', email: 'user@example.com' })).toBe(false)
  })

  it('supports comma-separated lists of admin uids', () => {
    process.env.GLOBAL_ADMIN_UIDS = 'uid-1, uid-2, uid-3'
    expect(isGlobalAdmin({ uid: 'uid-2' })).toBe(true)
    expect(isGlobalAdmin({ uid: 'uid-4' })).toBe(false)
  })

  it('ignores empty-string env vars', () => {
    process.env.GLOBAL_ADMIN_UIDS = ''
    process.env.GLOBAL_ADMIN_EMAILS = ''
    expect(isGlobalAdmin({ uid: 'user-uid' })).toBe(false)
  })
})

describe('deleteKnownUser', () => {
  afterEach(() => {
    query.mockReset()
  })

  it('throws known_user_in_use when the user owns a garden', async () => {
    await expect(deleteKnownUser('user-1', { ownsGarden: true, addedByAnotherUser: false })).rejects.toMatchObject({
      code: 'known_user_in_use',
      reasons: { ownsGarden: true, addedByAnotherUser: false },
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('throws known_user_in_use when the user was added to a garden by another user', async () => {
    await expect(deleteKnownUser('user-1', { ownsGarden: false, addedByAnotherUser: true })).rejects.toMatchObject({
      code: 'known_user_in_use',
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('deletes the user when they own no garden and were not added by another user', async () => {
    query.mockResolvedValue({ rowCount: 1 })
    await expect(deleteKnownUser('user-1', { ownsGarden: false, addedByAnotherUser: false })).resolves.toBe(true)
    expect(query).toHaveBeenCalledWith('DELETE FROM users WHERE id = $1', ['user-1'])
  })

  it('returns false when the user does not exist', async () => {
    query.mockResolvedValue({ rowCount: 0 })
    await expect(deleteKnownUser('user-1', {})).resolves.toBe(false)
  })
})
