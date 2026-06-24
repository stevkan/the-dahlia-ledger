import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { z } from 'zod'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import './env.js'
import { AssetInputSchema, CompanyInputSchema, DahliaPhotoSchema, DahliaRecordInputSchema, OrderInputSchema } from './schema.js'
import { listRecords, listRecordsPage, listRecordSummaries, listRecordSummariesPage, getRecord, createRecord, updateRecord, updateCultivarPhoto, updateCultivarPhotoDefault, updateRecordPhotoDefault, deleteCultivarPhoto, deleteRecord } from './records.js'
import { addOrderFile, countOrderFiles, createCompany, createOrder, deleteCompany, deleteOrder, deleteOrderFile, ensureCompany, listCompaniesWithUsage, listOrders, normalizeCompanyKey, reassignCompanies, updateCompany, updateOrder } from './orders.js'
import { addAssetFile, countAssetFiles, createAsset, deleteAsset, deleteAssetFile, listAssets, updateAsset } from './assets.js'
import { ingestText, reviewRecordMapping, proposeMissedIssueCorrection, runMetricRequest, runMetricDrilldown } from './agent.js'
import { getBucket, verifyFirebaseAppCheckToken, verifyFirebaseIdToken } from './firebase.js'
import { uploadPhotoBuffer } from './photos.js'
import { getSettings, updateSettings } from './settings.js'
import { completeMaintenanceReminder, createMaintenanceReminder, deleteMaintenanceReminder, listMaintenanceReminders, reopenMaintenanceReminder, updateMaintenanceReminder } from './maintenanceReminders.js'
import { acceptInvite, createGarden, createInvite, deleteGarden, deleteInvite, isFallbackGarden, listGardenMembers, listGardens, listInvites, removeGardenMember, resendInvite, resolveGardenId, resolveWritableGardenId, requireGardenAccess, requireGardenWriteAccess, updateGarden, upsertGardenMember } from './gardens.js'
import { extractOneNoteImages, imageRefKeys, oneNoteEntryToRecord, parseOneNoteMht } from './onenoteImport.js'
import { importExcelLocations } from './excelImport.js'
import { createExcelImportHistory, getLatestActiveExcelImportHistory, markExcelImportHistoryReverted } from './excelImportHistory.js'
import { toTitleCase } from './textFormat.js'
import { deleteKnownUser, getKnownUser, isGlobalAdmin, listKnownUsers, upsertKnownUser } from './users.js'
import { listFlowerNames, renameFlowerName } from './flowerNames.js'

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    credentials: false,
  }),
)
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

const requireAppCheck = process.env.REQUIRE_FIREBASE_APP_CHECK === 'true'

function bearerToken(req) {
  const value = req.get('authorization') ?? ''
  const match = value.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

app.use('/api', async (req, res, next) => {
  if (req.path === '/health') return next()

  const idToken = bearerToken(req)
  if (!idToken) return res.status(401).json({ error: 'unauthenticated', message: 'Missing Firebase ID token.' })

  try {
    req.user = await verifyFirebaseIdToken(idToken)
    await upsertKnownUser(req.user)
  } catch {
    return res.status(401).json({ error: 'unauthenticated', message: 'Invalid Firebase ID token.' })
  }

  if (!requireAppCheck) return next()

  const appCheckToken = req.get('x-firebase-appcheck')
  if (!appCheckToken) return res.status(401).json({ error: 'app_check_required', message: 'Missing Firebase App Check token.' })

  try {
    req.appCheck = await verifyFirebaseAppCheckToken(appCheckToken)
    next()
  } catch {
    res.status(401).json({ error: 'app_check_failed', message: 'Invalid Firebase App Check token.' })
  }
})

const GardenInputSchema = z.object({
  name: z.string().trim().min(1),
  organizationName: z.string().optional().nullable(),
  locationName: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  gardenOptions: z.object({
    gardenAreas: z.array(z.string().trim().min(1)),
    gardenRows: z.array(z.string().trim().min(1)),
    gardenPositions: z.array(z.string().trim().min(1)),
  }).optional(),
})

const MemberInputSchema = z.object({
  userId: z.string().trim().min(1),
  email: z.string().trim().optional().nullable(),
  displayName: z.string().trim().optional().nullable(),
  role: z.string().trim().min(1),
})

const InviteInputSchema = z.object({
  gardenId: z.string().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  role: z.string().trim().min(1),
  expiresAt: z.string().optional().nullable(),
})

const CompanyReassignmentSchema = z.object({
  companyIds: z.array(z.string().trim().min(1)).min(1),
  ownerUserId: z.string().trim().min(1),
})

function forbidden(res, e) {
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
  return false
}

function requireGlobalAdmin(req) {
  if (isGlobalAdmin(req.user)) return
  const error = new Error('This action requires global admin access.')
  error.code = 'global_admin_required'
  throw error
}

function requireGlobalAdminRoute(req, res, next) {
  try {
    requireGlobalAdmin(req)
    next()
  } catch (e) {
    if (forbidden(res, e)) return
    next(e)
  }
}

app.get('/api/me', async (req, res) => {
  res.json({ user: { uid: req.user.uid, email: req.user.email, displayName: req.user.name || req.user.displayName, globalAdmin: isGlobalAdmin(req.user) } })
})

app.get('/api/gardens', async (req, res) => {
  res.json({ gardens: await listGardens(req.user) })
})

app.post('/api/gardens', async (req, res) => {
  const parsed = GardenInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  try {
    res.json({ garden: await createGarden(req.user, parsed.data) })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.put('/api/gardens/:id', async (req, res) => {
  const parsed = GardenInputSchema.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  try {
    const garden = await updateGarden(req.user, req.params.id, parsed.data)
    if (!garden) return res.status(404).json({ error: 'not_found' })
    res.json({ garden })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.delete('/api/gardens/:id', async (req, res) => {
  try {
    const result = await deleteGarden(req.user, req.params.id)
    if (!result.deleted) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true, counts: result.counts })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.get('/api/gardens/:id/members', async (req, res) => {
  try {
    res.json({ members: await listGardenMembers(req.user, req.params.id) })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.post('/api/gardens/:id/members', async (req, res) => {
  const parsed = MemberInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  try {
    res.json({ member: await upsertGardenMember(req.user, req.params.id, parsed.data) })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.delete('/api/gardens/:gardenId/members/:memberId', async (req, res) => {
  try {
    const deleted = await removeGardenMember(req.user, req.params.gardenId, req.params.memberId)
    if (!deleted) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.get('/api/users', async (req, res) => {
  res.json({ users: await listKnownUsers() })
})

app.delete('/api/users/:id', requireGlobalAdminRoute, async (req, res) => {
  const deleted = await deleteKnownUser(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

app.get('/api/invites', async (req, res) => {
  try {
    res.json({ invites: await listInvites(req.user, { gardenId: req.query.gardenId }) })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.post('/api/invites', async (req, res) => {
  const parsed = InviteInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  try {
    res.json({ invite: await createInvite(req.user, parsed.data) })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.post('/api/invites/:id/resend', async (req, res) => {
  try {
    const invite = await resendInvite(req.user, req.params.id)
    if (!invite) return res.status(404).json({ error: 'not_found' })
    res.json({ invite })
  } catch (e) {
    if (forbidden(res, e)) return
    if (e?.code === 'invite_accepted') return res.status(409).json({ error: e.code, message: e.message })
    throw e
  }
})

app.delete('/api/invites/:id', async (req, res) => {
  try {
    const deleted = await deleteInvite(req.user, req.params.id)
    if (!deleted) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.post('/api/invites/:token/accept', async (req, res) => {
  try {
    const invite = await acceptInvite(req.user, req.params.token)
    if (!invite) return res.status(404).json({ error: 'not_found' })
    res.json({ invite })
  } catch (e) {
    if (e?.code === 'invite_expired' || e?.code === 'invite_email_mismatch') return res.status(409).json({ error: e.code, message: e.message })
    throw e
  }
})

app.get('/api/records', async (req, res) => {
  try {
    const gardenId = await resolveGardenId(req.user, req.query.gardenId)
    const includeLegacyUnassigned = await isFallbackGarden(req.user, gardenId)
    if (req.query.limit && !includeLegacyUnassigned) {
      const page = req.query.view === 'summary'
        ? await listRecordSummariesPage(gardenId, { limit: req.query.limit, startAfter: req.query.startAfter })
        : await listRecordsPage(gardenId, { limit: req.query.limit, startAfter: req.query.startAfter })
      res.json({ records: page.records, nextCursor: page.nextCursor, gardenId })
      return
    }

    const records = req.query.view === 'summary'
      ? await listRecordSummaries(gardenId, { includeLegacyUnassigned })
      : await listRecords(gardenId, { includeLegacyUnassigned })
    res.json({ records, gardenId })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.get('/api/records/:id', async (req, res) => {
  const r = await getRecord(req.params.id)
  if (!r) return res.status(404).json({ error: 'not_found' })
  try {
    await requireGardenAccess(req.user, r.gardenId || await resolveGardenId(req.user, req.query.gardenId))
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
  res.json({ record: r })
})

app.post('/api/records', async (req, res) => {
  const parsed = DahliaRecordInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  try {
    const gardenId = await resolveWritableGardenId(req.user, parsed.data.gardenId || req.query.gardenId)
    const record = await createRecord(parsed.data, gardenId)
    res.json({ record })
  } catch (e) {
    if (forbidden(res, e)) return
    if (e?.code === 'garden_location_conflict') return res.status(409).send(e.message)
    throw e
  }
})

app.put('/api/records/:id/cultivar-photo', async (req, res) => {
  const Body = z.object({
    cultivarImageUrl: z.string().min(1),
    cultivarThumbnailUrl: z.string().optional().nullable(),
    photo: DahliaPhotoSchema.optional(),
  })
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const source = await getRecord(req.params.id)
  if (!source) return res.status(404).json({ error: 'not_found' })
  try {
    await requireGardenWriteAccess(req.user, source.gardenId || await resolveGardenId(req.user, req.query.gardenId))
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }

  const result = await updateCultivarPhoto(req.params.id, parsed.data)
  if (!result) return res.status(404).json({ error: 'not_found' })
  res.json(result)
})

app.put('/api/records/:id/cultivar-photo-default', async (req, res) => {
  const Body = z.object({
    photo: DahliaPhotoSchema,
  })
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const source = await getRecord(req.params.id)
  if (!source) return res.status(404).json({ error: 'not_found' })
  try {
    await requireGardenWriteAccess(req.user, source.gardenId || await resolveGardenId(req.user, req.query.gardenId))
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }

  const result = await updateCultivarPhotoDefault(req.params.id, parsed.data)
  if (!result) return res.status(404).json({ error: 'not_found' })
  res.json(result)
})

app.put('/api/records/:id/record-photo-default', async (req, res) => {
  const Body = z.object({
    photo: DahliaPhotoSchema,
  })
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const source = await getRecord(req.params.id)
  if (!source) return res.status(404).json({ error: 'not_found' })
  try {
    await requireGardenWriteAccess(req.user, source.gardenId || await resolveGardenId(req.user, req.query.gardenId))
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }

  const result = await updateRecordPhotoDefault(req.params.id, parsed.data)
  if (!result) return res.status(404).json({ error: 'not_found' })
  res.json(result)
})

app.delete('/api/records/:id/cultivar-photo', async (req, res) => {
  const Body = z.object({
    imageUrl: z.string().min(1),
  })
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const source = await getRecord(req.params.id)
  if (!source) return res.status(404).json({ error: 'not_found' })
  try {
    await requireGardenWriteAccess(req.user, source.gardenId || await resolveGardenId(req.user, req.query.gardenId))
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }

  const result = await deleteCultivarPhoto(req.params.id, parsed.data)
  if (!result) return res.status(404).json({ error: 'not_found' })
  res.json(result)
})

app.put('/api/records/:id', async (req, res) => {
  const parsed = DahliaRecordInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  try {
    const existing = await getRecord(req.params.id)
    if (!existing) return res.status(404).json({ error: 'not_found' })
    const gardenId = existing.gardenId || await resolveWritableGardenId(req.user, parsed.data.gardenId || req.query.gardenId)
    await requireGardenWriteAccess(req.user, gardenId)
    const record = await updateRecord(req.params.id, parsed.data, gardenId)
    if (!record) return res.status(404).json({ error: 'not_found' })
    res.json({ record })
  } catch (e) {
    if (forbidden(res, e)) return
    if (e?.code === 'garden_location_conflict') return res.status(409).send(e.message)
    throw e
  }
})

app.delete('/api/records/:id', async (req, res) => {
  const existing = await getRecord(req.params.id)
  if (!existing) return res.json({ ok: true })
  try {
    await requireGardenWriteAccess(req.user, existing.gardenId || await resolveGardenId(req.user, req.query.gardenId))
    await deleteRecord(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

const MaintenanceReminderInputSchema = z.object({
  title: z.string().trim().min(1),
  notes: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  relatedRecordIds: z.array(z.string()).optional(),
  source: z.enum(['user', 'agent']).optional(),
  gardenId: z.string().optional().nullable(),
  ownerUserId: z.string().optional().nullable(),
  assignedToUserId: z.string().optional().nullable(),
  visibility: z.enum(['private', 'garden']).optional(),
  priority: z.enum(['normal', 'high']).optional(),
})

app.get('/api/maintenance-reminders', async (req, res) => {
  try {
    const gardenId = await resolveGardenId(req.user, req.query.gardenId)
    res.json({ reminders: await listMaintenanceReminders({ gardenId, userId: req.user.uid, includeLegacyUnassigned: await isFallbackGarden(req.user, gardenId) }), gardenId })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.post('/api/maintenance-reminders', async (req, res) => {
  const parsed = MaintenanceReminderInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    const gardenId = await resolveWritableGardenId(req.user, parsed.data.gardenId || req.query.gardenId)
    res.json({ reminder: await createMaintenanceReminder(parsed.data, { gardenId, userId: req.user.uid }) })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.put('/api/maintenance-reminders/:id', async (req, res) => {
  const parsed = MaintenanceReminderInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    const gardenId = await resolveWritableGardenId(req.user, parsed.data.gardenId || req.query.gardenId)
    const reminder = await updateMaintenanceReminder(req.params.id, parsed.data, { gardenId, userId: req.user.uid })
    if (!reminder) return res.status(404).json({ error: 'not_found' })
    res.json({ reminder })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.post('/api/maintenance-reminders/:id/complete', async (req, res) => {
  try {
    const gardenId = await resolveWritableGardenId(req.user, req.query.gardenId)
    const reminder = await completeMaintenanceReminder(req.params.id, { gardenId, userId: req.user.uid })
    if (!reminder) return res.status(404).json({ error: 'not_found' })
    res.json({ reminder })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.post('/api/maintenance-reminders/:id/reopen', async (req, res) => {
  try {
    const gardenId = await resolveWritableGardenId(req.user, req.query.gardenId)
    const reminder = await reopenMaintenanceReminder(req.params.id, { gardenId, userId: req.user.uid })
    if (!reminder) return res.status(404).json({ error: 'not_found' })
    res.json({ reminder })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.delete('/api/maintenance-reminders/:id', async (req, res) => {
  try {
    const gardenId = await resolveWritableGardenId(req.user, req.query.gardenId)
    const deleted = await deleteMaintenanceReminder(req.params.id, { gardenId })
    if (!deleted) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

app.get('/api/companies', async (req, res) => {
  const gardenId = await resolveGardenId(req.user, req.query.gardenId)
  const access = await requireGardenAccess(req.user, gardenId)
  const companies = await listCompaniesWithUsage({ user: req.user, userId: req.user.uid, gardenId, gardenOwnerIds: access.role === 'owner' ? new Set([gardenId]) : new Set(), gardenOwnerUserIds: new Set([access.garden.ownerUserId, access.garden.createdByUserId].filter(Boolean)) })
  res.json({ companies })
})

app.post('/api/companies', async (req, res) => {
  const parsed = CompanyInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const gardenId = await resolveGardenId(req.user, parsed.data.gardenId || req.query.gardenId)
  const access = await requireGardenAccess(req.user, gardenId)
  const company = await createCompany(parsed.data, { user: req.user, userId: req.user.uid, gardenId, gardenOwnerIds: access.role === 'owner' ? new Set([gardenId]) : new Set(), gardenOwnerUserIds: new Set([access.garden.ownerUserId, access.garden.createdByUserId].filter(Boolean)) })
  res.json({ company })
})

app.put('/api/companies/:id', async (req, res) => {
  const parsed = CompanyInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const gardenId = await resolveGardenId(req.user, parsed.data.gardenId || req.query.gardenId)
  const access = await requireGardenAccess(req.user, gardenId)
  const company = await updateCompany(req.params.id, parsed.data, { user: req.user, userId: req.user.uid, gardenId, gardenOwnerIds: access.role === 'owner' ? new Set([gardenId]) : new Set(), gardenOwnerUserIds: new Set([access.garden.ownerUserId, access.garden.createdByUserId].filter(Boolean)) })
  if (!company) return res.status(404).json({ error: 'not_found' })
  res.json({ company })
})

app.delete('/api/companies/:id', async (req, res) => {
  try {
    const gardenId = await resolveGardenId(req.user, req.query.gardenId)
    const access = await requireGardenAccess(req.user, gardenId)
    await deleteCompany(req.params.id, { user: req.user, userId: req.user.uid, gardenId, gardenOwnerIds: access.role === 'owner' ? new Set([gardenId]) : new Set(), gardenOwnerUserIds: new Set([access.garden.ownerUserId, access.garden.createdByUserId].filter(Boolean)) })
    res.json({ ok: true })
  } catch (e) {
    if (e?.code === 'company_in_use') return res.status(409).json({ error: 'company_in_use', message: e.message, usage: e.usage })
    if (e?.code === 'company_delete_denied') return res.status(403).json({ error: 'company_delete_denied', message: e.message })
    throw e
  }
})

app.post('/api/admin/companies/reassign', requireGlobalAdminRoute, async (req, res) => {
  const parsed = CompanyReassignmentSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  const targetUser = await getKnownUser(parsed.data.ownerUserId)
  if (!targetUser) return res.status(404).json({ error: 'user_not_found', message: 'Target user was not found.' })

  const companies = await reassignCompanies(parsed.data.companyIds, parsed.data.ownerUserId)
  res.json({ companies, updatedCount: companies.length })
})

app.get('/api/orders', async (req, res) => {
  const orders = await listOrders({ userId: req.user.uid })
  res.json({ orders })
})

app.post('/api/orders', async (req, res) => {
  const parsed = OrderInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const order = await createOrder(parsed.data, { userId: req.user.uid })
  res.json({ order })
})

app.put('/api/orders/:id', async (req, res) => {
  const parsed = OrderInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const order = await updateOrder(req.params.id, parsed.data, { userId: req.user.uid })
  if (!order) return res.status(404).json({ error: 'not_found' })
  res.json({ order })
})

app.delete('/api/orders/:id', async (req, res) => {
  const deleted = await deleteOrder(req.params.id, { userId: req.user.uid })
  if (!deleted) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

app.get('/api/flower-names', async (req, res) => {
  const gardenId = await resolveGardenId(req.user, req.query.gardenId)
  await requireGardenAccess(req.user, gardenId)
  const includeLegacyUnassigned = await isFallbackGarden(req.user, gardenId)
  res.json({ flowerNames: await listFlowerNames(gardenId, { includeLegacyUnassigned }) })
})

app.put('/api/flower-names/:name', async (req, res) => {
  const gardenId = await resolveGardenId(req.user, req.query.gardenId)
  await requireGardenWriteAccess(req.user, gardenId)
  const includeLegacyUnassigned = await isFallbackGarden(req.user, gardenId)
  const oldName = decodeURIComponent(req.params.name)
  const { newName } = req.body
  if (!newName || typeof newName !== 'string' || !newName.trim()) {
    return res.status(400).json({ error: 'bad_request', message: 'newName is required.' })
  }
  const result = await renameFlowerName(oldName, newName.trim(), gardenId, { includeLegacyUnassigned })
  res.json(result)
})

app.get('/api/assets', async (req, res) => {
  const assets = await listAssets({ userId: req.user.uid })
  res.json({ assets })
})

app.post('/api/assets', async (req, res) => {
  const parsed = AssetInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const asset = await createAsset(parsed.data, { userId: req.user.uid })
  res.json({ asset })
})

app.put('/api/assets/:id', async (req, res) => {
  const parsed = AssetInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const asset = await updateAsset(req.params.id, parsed.data, { userId: req.user.uid })
  if (!asset) return res.status(404).json({ error: 'not_found' })
  res.json({ asset })
})

app.delete('/api/assets/:id', async (req, res) => {
  const deleted = await deleteAsset(req.params.id, { userId: req.user.uid })
  if (!deleted) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })
const oneNoteUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } })
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })

  const ext = path.extname(req.file.originalname || '').toLowerCase()
  const safeExt = ext && ext.length <= 8 ? ext : ''
  res.json(await uploadPhotoBuffer(req.file.buffer, req.file.mimetype, safeExt))
})

app.post('/api/import/onenote', requireGlobalAdminRoute, oneNoteUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })

  const ext = path.extname(req.file.originalname || '').toLowerCase()
  if (ext !== '.mht' && ext !== '.mhtml') return res.status(400).json({ error: 'mht_required' })

  const entries = parseOneNoteMht(req.file.buffer)
  const images = extractOneNoteImages(req.file.buffer)
  const imageByRef = new Map()
  for (const image of images) {
    for (const key of [...imageRefKeys(image.contentLocation), ...imageRefKeys(image.contentId), ...imageRefKeys(`cid:${image.contentId}`)]) {
      imageByRef.set(key, image)
    }
  }
  const existing = await listRecords()
  const existingKeys = new Set(existing.map((record) => `${normalizeCompanyKey(record.tuber?.source)}|${record.flowerName.toLowerCase()}`))
  const records = []
  const companyByKey = new Map()
  const createdCompanyKeys = new Set()
  let skippedCount = 0

  for (const entry of entries) {
    const normalizedFarm = entry.farm ? toTitleCase(entry.farm) : ''
    const companyKey = normalizeCompanyKey(normalizedFarm)
    let company = companyByKey.get(companyKey)
    if (!company && normalizedFarm) {
      const ensured = await ensureCompany(normalizedFarm, { userId: req.user.uid })
      company = ensured.company
      companyByKey.set(companyKey, company)
      if (ensured.created) createdCompanyKeys.add(companyKey)
    }

    const key = `${companyKey}|${entry.name.toLowerCase()}`
    if (existingKeys.has(key)) {
      skippedCount += 1
      continue
    }

    const image = entry.imageRef ? imageRefKeys(entry.imageRef).map((key) => imageByRef.get(key)).find(Boolean) : undefined
    const photo = image ? await uploadPhotoBuffer(image.data, image.contentType, image.extension) : undefined
    const record = await createRecord(oneNoteEntryToRecord({ ...entry, farm: company?.name ?? normalizedFarm, ...photo }))
    records.push(record)
    existingKeys.add(key)
  }

  res.json({ importedCount: records.length, skippedCount, createdCompanyCount: createdCompanyKeys.size, records })
})

app.post('/api/import/excel', requireGlobalAdminRoute, excelUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })

  const ext = path.extname(req.file.originalname || '').toLowerCase()
  if (ext !== '.xlsx' && ext !== '.xls') return res.status(400).json({ error: 'excel_required' })

  try {
    const records = await listRecords()
    const result = await importExcelLocations(req.file.buffer, { records, updateRecord })
    const importId = await createExcelImportHistory({ originalFileName: req.file.originalname, result, rollbackEntries: result.rollbackEntries })
    const { rollbackEntries, ...response } = result
    res.json({ ...response, importId, canRevert: rollbackEntries.length > 0 })
  } catch (e) {
    if (e?.code === 'garden_location_conflict') return res.status(409).send(e.message)
    throw e
  }
})

app.use('/api/import/excel', (err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).send('Uploaded Excel file is too large. Excel imports support files up to 200 MB.')
  }

  next(err)
})

app.post('/api/import/excel/revert-latest', requireGlobalAdminRoute, async (req, res) => {
  const history = await getLatestActiveExcelImportHistory()
  if (!history) return res.status(404).json({ error: 'no_active_excel_import' })

  let revertedCount = 0
  const skipped = []

  for (const entry of history.rollbackEntries ?? []) {
    const record = await getRecord(entry.recordId)
    if (!record) {
      skipped.push({ recordId: entry.recordId, flowerName: entry.flowerName, reason: 'Record no longer exists.' })
      continue
    }

    await updateRecord(entry.recordId, {
      ...record,
      gardenLocation: entry.previous?.gardenLocation ?? '',
      meta: {
        ...(record.meta ?? {}),
        plantingState: entry.previous?.meta?.plantingState ?? undefined,
        gardenArea: entry.previous?.meta?.gardenArea ?? undefined,
        gardenRow: entry.previous?.meta?.gardenRow ?? undefined,
        gardenPosition: entry.previous?.meta?.gardenPosition ?? undefined,
      },
    })
    revertedCount += 1
  }

  await markExcelImportHistoryReverted(history.id, { revertedCount })
  res.json({ importId: history.id, revertedCount, skipped })
})

app.post('/api/orders/:id/files', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })
  if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'pdf_required' })

  const objectName = `order-invoices/${req.params.id}/${Date.now()}-${crypto.randomUUID()}.pdf`
  const file = getBucket().file(objectName)

  await file.save(req.file.buffer, {
    metadata: {
      contentType: 'application/pdf',
      cacheControl: 'private, max-age=3600',
    },
  })
  await file.makePublic()

  const existingCount = await countOrderFiles(req.params.id)
  const orderFile = await addOrderFile(req.params.id, {
    originalFileName: `Doc ${existingCount + 1}`,
    storedFileName: path.basename(objectName),
    mimeType: req.file.mimetype,
    fileSize: req.file.size,
    fileUrl: file.publicUrl(),
    sourceType: req.body.sourceType || 'uploaded_pdf',
  })

  res.json({ file: orderFile })
})

app.delete('/api/orders/:id/files/:fileId', async (req, res) => {
  const orderFile = await deleteOrderFile(req.params.id, req.params.fileId)
  if (!orderFile) return res.status(404).json({ error: 'not_found' })

  const objectName = `order-invoices/${req.params.id}/${orderFile.storedFileName}`
  await getBucket().file(objectName).delete({ ignoreNotFound: true })

  res.json({ ok: true })
})

app.post('/api/assets/:id/files', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })
  if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'pdf_required' })

  const objectName = `asset-invoices/${req.params.id}/${Date.now()}-${crypto.randomUUID()}.pdf`
  const file = getBucket().file(objectName)

  await file.save(req.file.buffer, {
    metadata: {
      contentType: 'application/pdf',
      cacheControl: 'private, max-age=3600',
    },
  })
  await file.makePublic()

  const existingAssetCount = await countAssetFiles(req.params.id)
  const assetFile = await addAssetFile(req.params.id, {
    originalFileName: `Doc ${existingAssetCount + 1}`,
    storedFileName: path.basename(objectName),
    mimeType: req.file.mimetype,
    fileSize: req.file.size,
    fileUrl: file.publicUrl(),
    sourceType: req.body.sourceType || 'uploaded_pdf',
  })

  res.json({ file: assetFile })
})

app.delete('/api/assets/:id/files/:fileId', async (req, res) => {
  const assetFile = await deleteAssetFile(req.params.id, req.params.fileId)
  if (!assetFile) return res.status(404).json({ error: 'not_found' })

  const objectName = `asset-invoices/${req.params.id}/${assetFile.storedFileName}`
  await getBucket().file(objectName).delete({ ignoreNotFound: true })

  res.json({ ok: true })
})

app.post('/api/agent/ingest', async (req, res) => {
  const Body = z.object({ text: z.string().min(1) })
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    const out = await ingestText(parsed.data.text)
    const settings = await getSettings()
    if (settings.agentDebugReviewEnabled && out.record) {
      out.review = await reviewRecordMapping({ originalText: parsed.data.text, record: out.record })
    }
    res.json(out)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Agent ingest failed:', message)
    res.status(503).json({ status: 'needs_clarification', message: `Agent unavailable: ${message}` })
  }
})

app.post('/api/agent/metrics', async (req, res) => {
  const Body = z.object({
    metric: z.enum([
      'flower_purchase_count_by_company',
      'flower_count_by_color',
      'flower_count_by_garden_area',
      'flower_count_by_planting_state',
      'flower_count_by_form',
      'invoice_total_by_company',
      'flower_count_by_season',
      'height_vs_bloom_size',
      'average_item_cost_by_company',
      'linked_vs_unlinked_purchase_records',
      'missing_data_summary',
      'garden_area_by_planting_state',
      'invoice_total_by_season',
      'flower_count_by_company_and_season',
      'average_item_cost_by_form',
      'garden_fill_by_area',
      'not_viable_reason_summary',
      'not_planted_reason_summary',
    ]),
    seasonYearStart: z.number().int().min(1900).max(3000).optional(),
    seasonYearStarts: z.array(z.number().int().min(1900).max(3000)).optional(),
    filters: z.object({
      companies: z.array(z.string()).optional(),
      gardenAreas: z.array(z.string()).optional(),
      plantingStates: z.array(z.string()).optional(),
      colors: z.array(z.string()).optional(),
      forms: z.array(z.string()).optional(),
    }).optional(),
    sortBy: z.enum(['company', 'value_desc', 'value_asc']).optional(),
    visualization: z.object({
      type: z.enum(['bar', 'line', 'pie', 'scatter', 'table']).optional(),
      renderer: z.enum(['recharts', 'd3', 'table']).optional(),
      xLabelAngle: z.number().optional(),
    }).optional(),
  })
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    res.json(await runMetricRequest(parsed.data))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Agent metrics failed:', message)
    res.status(503).json({ status: 'needs_clarification', message: `Analytics unavailable: ${message}` })
  }
})

app.post('/api/agent/metrics/drilldown', async (req, res) => {
  const Body = z.object({
    metric: z.enum([
      'missing_data_summary',
      'flower_count_by_color',
      'flower_count_by_garden_area',
      'flower_count_by_form',
      'flower_count_by_planting_state',
      'linked_vs_unlinked_purchase_records',
      'flower_purchase_count_by_company',
      'invoice_total_by_company',
      'flower_count_by_season',
      'height_vs_bloom_size',
      'garden_area_by_planting_state',
      'invoice_total_by_season',
      'flower_count_by_company_and_season',
      'average_item_cost_by_form',
      'garden_fill_by_area',
      'not_viable_reason_summary',
      'not_planted_reason_summary',
    ]),
    field: z.enum(['Color', 'Form', 'Height', 'Bloom size', 'Source', 'Linked invoice item', 'Garden area', 'Garden row', 'Garden position']).optional(),
    bucket: z.string().optional(),
    seasonYearStart: z.number().int().min(1900).max(3000).optional(),
    seasonYearStarts: z.array(z.number().int().min(1900).max(3000)).optional(),
    filters: z.object({
      companies: z.array(z.string()).optional(),
      gardenAreas: z.array(z.string()).optional(),
      plantingStates: z.array(z.string()).optional(),
      colors: z.array(z.string()).optional(),
      forms: z.array(z.string()).optional(),
    }).optional(),
  }).refine((value) => value.metric === 'missing_data_summary' ? Boolean(value.field) : Boolean(value.bucket), 'field is required for missing_data_summary; bucket is required for other drilldowns')
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    res.json(await runMetricDrilldown(parsed.data))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Agent metrics drilldown failed:', message)
    res.status(503).json({ title: 'Drilldown unavailable', records: [], error: message })
  }
})

app.get('/api/settings', async (req, res) => {
  res.json({ settings: await getSettings() })
})

app.put('/api/settings', async (req, res) => {
  const Body = z.object({ agentDebugReviewEnabled: z.boolean().optional() })
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  res.json({ settings: await updateSettings(parsed.data) })
})

app.post('/api/agent/review', async (req, res) => {
  const Body = z.object({
    originalText: z.string().optional(),
    record: z.any().optional(),
    recordId: z.string().optional(),
  }).refine((value) => value.record || value.recordId, 'record or recordId is required')
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    const review = await reviewRecordMapping(parsed.data)
    res.json({ review })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Agent review failed:', message)
    res.status(503).json({ error: `Agent review unavailable: ${message}` })
  }
})

app.post('/api/agent/correction', async (req, res) => {
  const Body = z.object({
    originalText: z.string().optional(),
    record: z.any().optional(),
    recordId: z.string().optional(),
    review: z.any().optional(),
    userCorrection: z.string().min(1),
  }).refine((value) => value.record || value.recordId, 'record or recordId is required')
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    const correction = await proposeMissedIssueCorrection(parsed.data)
    res.json({ correction })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Agent correction failed:', message)
    res.status(503).json({ error: `Agent correction unavailable: ${message}` })
  }
})

const frontendDist = path.resolve(__dirname, '../../frontend/dist')
app.use(express.static(frontendDist))

app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'))
})

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).send('Uploaded file is too large for this import.')
  }

  next(err)
})

const port = Number(process.env.PORT ?? 8787)
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`)
})
