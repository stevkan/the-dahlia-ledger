import express from 'express'
import { z } from 'zod'
import { getSettings, updateSettings } from '../settings.js'

const router = express.Router()

router.get('/settings', async (req, res) => {
  res.json({ settings: await getSettings() })
})

router.put('/settings', async (req, res) => {
  const Body = z.object({ agentDebugReviewEnabled: z.boolean().optional() })
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  res.json({ settings: await updateSettings(parsed.data) })
})

export default router
