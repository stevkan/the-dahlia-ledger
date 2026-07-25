import express from 'express'
import { requireGlobalAdminRoute } from '../httpHelpers.js'
import { getAppCheckDebugToken, generateAppCheckDebugToken } from '../appCheckConfig.js'

const router = express.Router()

// Any authenticated user needs this to bootstrap App Check (see APP_CHECK_BOOTSTRAP_PATHS in
// server.js and the comment in frontend/src/firebase.ts) — it's app attestation, not a
// per-user permission, so only rotating the shared token is restricted to global admins.
router.get('/app-check/debug-token', async (req, res) => {
  res.json({ debugToken: await getAppCheckDebugToken() })
})

router.post('/app-check/debug-token/generate', requireGlobalAdminRoute, async (req, res) => {
  res.json({ debugToken: await generateAppCheckDebugToken(req.user) })
})

export default router
