import express from 'express'
import cors from 'cors'
import compression from 'compression'
import multer from 'multer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import './env.js'
import { warmDinoModel } from './dino.js'
import { warmSegmentationModel } from './segmentation.js'
import { verifyFirebaseAppCheckToken, verifyFirebaseIdToken } from './firebase.js'
import { isGlobalAdmin, upsertKnownUser } from './users.js'
import { bearerToken } from './httpHelpers.js'
import { trackException, trackTrace } from './telemetry.js'

import gardensRouter from './routes/gardens.js'
import usersRouter from './routes/users.js'
import recordsRouter from './routes/records.js'
import maintenanceRemindersRouter from './routes/maintenanceReminders.js'
import companiesRouter from './routes/companies.js'
import ordersRouter from './routes/orders.js'
import assetsRouter from './routes/assets.js'
import uploadRouter from './routes/upload.js'
import importsRouter from './routes/imports.js'
import flowerNamesRouter from './routes/flowerNames.js'
import colorsRouter from './routes/colors.js'
import agentRouter from './routes/agent.js'
import settingsRouter from './routes/settings.js'
import appCheckRouter from './routes/appCheck.js'

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    credentials: false,
  }),
)
app.use(compression())
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

const requireAppCheck = process.env.REQUIRE_FIREBASE_APP_CHECK === 'true'

// These admin-only endpoints hand out (or rotate) the App Check debug token itself, so they
// must stay reachable even when a client has no valid App Check token yet.
const APP_CHECK_BOOTSTRAP_PATHS = new Set(['/app-check/debug-token', '/app-check/debug-token/generate'])

app.use('/api', async (req, res, next) => {
  if (req.path === '/health') return next()

  const idToken = bearerToken(req)
  if (!idToken) return res.status(401).json({ error: 'unauthenticated', message: 'Missing Firebase ID token.' })

  try {
    req.user = await verifyFirebaseIdToken(idToken)
  } catch (err) {
    console.error('Firebase ID token verification failed:', err)
    trackException(err, { url: req.originalUrl, method: req.method, stage: 'verifyFirebaseIdToken' })
    return res.status(401).json({ error: 'unauthenticated', message: 'Invalid Firebase ID token.' })
  }

  try {
    await upsertKnownUser(req.user)
  } catch (err) {
    console.error('upsertKnownUser failed for a verified token:', err)
    trackException(err, { url: req.originalUrl, method: req.method, stage: 'upsertKnownUser' })
    return res.status(500).json({ error: 'internal_error', message: 'Failed to record known user.' })
  }

  if (!requireAppCheck || APP_CHECK_BOOTSTRAP_PATHS.has(req.path)) return next()

  const appCheckToken = req.get('x-firebase-appcheck')
  if (!appCheckToken) return res.status(401).json({ error: 'app_check_required', message: 'Missing Firebase App Check token.' })

  try {
    req.appCheck = await verifyFirebaseAppCheckToken(appCheckToken)
    next()
  } catch (err) {
    console.error('Firebase App Check token verification failed:', err)
    trackException(err, { url: req.originalUrl, method: req.method, stage: 'verifyFirebaseAppCheckToken' })
    res.status(401).json({ error: 'app_check_failed', message: 'Invalid Firebase App Check token.' })
  }
})

app.get('/api/me', async (req, res) => {
  res.json({ user: { uid: req.user.uid, email: req.user.email, displayName: req.user.name || req.user.displayName, globalAdmin: isGlobalAdmin(req.user) } })
})

app.use('/api', gardensRouter)
app.use('/api', usersRouter)
app.use('/api', recordsRouter)
app.use('/api', maintenanceRemindersRouter)
app.use('/api', companiesRouter)
app.use('/api', ordersRouter)
app.use('/api', assetsRouter)
app.use('/api', uploadRouter)
app.use('/api', importsRouter)
app.use('/api', flowerNamesRouter)
app.use('/api', colorsRouter)
app.use('/api', agentRouter)
app.use('/api', settingsRouter)
app.use('/api', appCheckRouter)

const frontendDist = path.resolve(__dirname, '../../frontend/dist')
app.use(express.static(frontendDist))

app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'))
})

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).send('Uploaded file is too large for this import.')
  }

  trackException(err, { url: req.originalUrl, method: req.method })
  next(err)
})

Promise.all([warmSegmentationModel(), warmDinoModel()]).catch((error) => {
  console.error('Failed to warm photo identification models:', error)
})

const port = Number(process.env.PORT ?? 8787)
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`)
  trackTrace('Backend started', 1, { port: String(port) })
})
