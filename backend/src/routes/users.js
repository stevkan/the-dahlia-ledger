import express from 'express'
import { deleteKnownUser, listKnownUsers } from '../users.js'
import { requireGlobalAdminRoute } from '../httpHelpers.js'

const router = express.Router()

router.get('/users', async (req, res) => {
  res.json({ users: await listKnownUsers() })
})

router.delete('/users/:id', requireGlobalAdminRoute, async (req, res) => {
  const deleted = await deleteKnownUser(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

export default router
