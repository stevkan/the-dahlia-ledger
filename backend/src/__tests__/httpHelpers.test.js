import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../firebase.js', () => ({ getDb: vi.fn() }))
vi.mock('../users.js', () => ({ isGlobalAdmin: vi.fn() }))

import { bearerToken, forbidden, requireGlobalAdmin } from '../httpHelpers.js'
import { isGlobalAdmin } from '../users.js'

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() }
  res.status.mockReturnValue(res)
  return res
}

function codeError(code, message = code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra })
}

// ---------------------------------------------------------------------------
// bearerToken
// ---------------------------------------------------------------------------

describe('bearerToken', () => {
  it('extracts the token from a well-formed Authorization header', () => {
    expect(bearerToken({ get: () => 'Bearer my-token-123' })).toBe('my-token-123')
  })

  it('is case-insensitive for the Bearer prefix', () => {
    expect(bearerToken({ get: () => 'bearer abc' })).toBe('abc')
    expect(bearerToken({ get: () => 'BEARER abc' })).toBe('abc')
  })

  it('returns undefined when the header is absent', () => {
    expect(bearerToken({ get: () => '' })).toBeUndefined()
  })

  it('returns undefined when the header has no token', () => {
    expect(bearerToken({ get: () => 'Bearer' })).toBeUndefined()
  })

  it('returns undefined when the header is not a Bearer scheme', () => {
    expect(bearerToken({ get: () => 'Basic dXNlcjpwYXNz' })).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// forbidden
// ---------------------------------------------------------------------------

describe('forbidden', () => {
  it('returns 403 for global_admin_required', () => {
    const res = mockRes()
    expect(forbidden(res, codeError('global_admin_required', 'Admin required'))).toBe(true)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'global_admin_required', message: 'Admin required' })
  })

  it('returns 403 for garden_access_denied', () => {
    const res = mockRes()
    expect(forbidden(res, codeError('garden_access_denied', 'No access'))).toBe(true)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'garden_access_denied', message: 'No access' })
  })

  it('returns 403 for garden_write_denied', () => {
    const res = mockRes()
    expect(forbidden(res, codeError('garden_write_denied', 'No write'))).toBe(true)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('returns 409 for last_owner', () => {
    const res = mockRes()
    expect(forbidden(res, codeError('last_owner', 'Cannot remove last owner'))).toBe(true)
    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('returns 409 for duplicate_member', () => {
    const res = mockRes()
    expect(forbidden(res, codeError('duplicate_member', 'Already a member'))).toBe(true)
    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('returns 409 with counts for garden_in_use', () => {
    const res = mockRes()
    const e = codeError('garden_in_use', 'Garden has records', { counts: { records: 5 } })
    expect(forbidden(res, e)).toBe(true)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'garden_in_use', message: 'Garden has records', counts: { records: 5 } })
  })

  it('returns 409 for last_garden', () => {
    const res = mockRes()
    expect(forbidden(res, codeError('last_garden', 'Cannot delete last garden'))).toBe(true)
    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('returns false and sends nothing for an unknown error code', () => {
    const res = mockRes()
    expect(forbidden(res, codeError('something_unexpected'))).toBe(false)
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  it('returns false for null', () => {
    const res = mockRes()
    expect(forbidden(res, null)).toBe(false)
  })

  it('returns false for undefined', () => {
    const res = mockRes()
    expect(forbidden(res, undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// requireGlobalAdmin
// ---------------------------------------------------------------------------

describe('requireGlobalAdmin', () => {
  beforeEach(() => {
    isGlobalAdmin.mockReset()
  })

  it('does not throw when the user is a global admin', () => {
    isGlobalAdmin.mockReturnValue(true)
    expect(() => requireGlobalAdmin({ user: { uid: 'admin' } })).not.toThrow()
  })

  it('throws an error with code global_admin_required for non-admin users', () => {
    isGlobalAdmin.mockReturnValue(false)
    expect(() => requireGlobalAdmin({ user: { uid: 'regular' } })).toThrowError(
      expect.objectContaining({ code: 'global_admin_required' }),
    )
  })
})
