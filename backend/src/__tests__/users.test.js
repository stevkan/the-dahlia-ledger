import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('../firebase.js', () => ({ getDb: vi.fn() }))

import { isGlobalAdmin } from '../users.js'

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
