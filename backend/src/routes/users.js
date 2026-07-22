import express from 'express'
import { deleteKnownUser, listKnownUsers } from '../users.js'
import { getKnownUserGardenUsage } from '../gardens.js'
import { forbidden, requireGlobalAdminRoute } from '../httpHelpers.js'

const router = express.Router()

router.get('/users', async (req, res) => {
  res.json({ users: await listKnownUsers() })
})

router.delete('/users/:id', requireGlobalAdminRoute, async (req, res) => {
  try {
    const usage = await getKnownUserGardenUsage(req.params.id)
    const deleted = await deleteKnownUser(req.params.id, usage)
    if (!deleted) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

export default router
