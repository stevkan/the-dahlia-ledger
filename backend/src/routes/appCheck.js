import express from 'express'
import { requireGlobalAdminRoute } from '../httpHelpers.js'
import { getAppCheckDebugToken, generateAppCheckDebugToken } from '../appCheckConfig.js'

const router = express.Router()

router.get('/app-check/debug-token', requireGlobalAdminRoute, async (req, res) => {
  res.json({ debugToken: await getAppCheckDebugToken() })
})

router.post('/app-check/debug-token/generate', requireGlobalAdminRoute, async (req, res) => {
  res.json({ debugToken: await generateAppCheckDebugToken(req.user) })
})

export default router
