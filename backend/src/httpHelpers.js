import { isGlobalAdmin } from './users.js'

export function bearerToken(req) {
  const value = req.get('authorization') ?? ''
  const match = value.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

export function forbidden(res, e) {
  if (e?.code === 'global_admin_required') {
    res.status(403).json({ error: e.code, message: e.message })
    return true
  }
  if (e?.code === 'garden_access_denied' || e?.code === 'garden_write_denied') {
    res.status(403).json({ error: e.code, message: e.message })
    return true
  }
  if (e?.code === 'last_owner') {
    res.status(409).json({ error: e.code, message: e.message })
    return true
  }
  if (e?.code === 'duplicate_member') {
    res.status(409).json({ error: e.code, message: e.message })
    return true
  }
  if (e?.code === 'garden_in_use') {
    res.status(409).json({ error: e.code, message: e.message, counts: e.counts })
    return true
  }
  if (e?.code === 'last_garden') {
    res.status(409).json({ error: e.code, message: e.message })
    return true
  }
  if (e?.code === 'known_user_in_use') {
    res.status(409).json({ error: e.code, message: e.message, reasons: e.reasons })
    return true
  }
  return false
}

export function requireGlobalAdmin(req) {
  if (isGlobalAdmin(req.user)) return
  const error = new Error('This action requires global admin access.')
  error.code = 'global_admin_required'
  throw error
}

export function requireGlobalAdminRoute(req, res, next) {
  try {
    requireGlobalAdmin(req)
    next()
  } catch (e) {
    if (forbidden(res, e)) return
    next(e)
  }
}
