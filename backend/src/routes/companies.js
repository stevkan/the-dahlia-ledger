import express from 'express'
import { CompanyInputSchema, CompanyReassignmentSchema } from '../schema.js'
import { createCompany, deleteCompany, listCompaniesWithUsage, reassignCompanies, updateCompany } from '../orders.js'
import { getKnownUser } from '../users.js'
import { requireGardenAccess, resolveGardenId } from '../gardens.js'
import { requireGlobalAdminRoute } from '../httpHelpers.js'

const router = express.Router()

router.get('/companies', async (req, res) => {
  const gardenId = await resolveGardenId(req.user, req.query.gardenId)
  const access = await requireGardenAccess(req.user, gardenId)
  const companies = await listCompaniesWithUsage({ user: req.user, userId: req.user.uid, gardenId, gardenOwnerIds: access.role === 'owner' ? new Set([gardenId]) : new Set(), gardenOwnerUserIds: new Set([access.garden.ownerUserId, access.garden.createdByUserId].filter(Boolean)) })
  res.json({ companies })
})

router.post('/companies', async (req, res) => {
  const parsed = CompanyInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const gardenId = await resolveGardenId(req.user, parsed.data.gardenId || req.query.gardenId)
  const access = await requireGardenAccess(req.user, gardenId)
  const company = await createCompany(parsed.data, { user: req.user, userId: req.user.uid, gardenId, gardenOwnerIds: access.role === 'owner' ? new Set([gardenId]) : new Set(), gardenOwnerUserIds: new Set([access.garden.ownerUserId, access.garden.createdByUserId].filter(Boolean)) })
  res.json({ company })
})

router.put('/companies/:id', async (req, res) => {
  const parsed = CompanyInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const gardenId = await resolveGardenId(req.user, parsed.data.gardenId || req.query.gardenId)
  const access = await requireGardenAccess(req.user, gardenId)
  const company = await updateCompany(req.params.id, parsed.data, { user: req.user, userId: req.user.uid, gardenId, gardenOwnerIds: access.role === 'owner' ? new Set([gardenId]) : new Set(), gardenOwnerUserIds: new Set([access.garden.ownerUserId, access.garden.createdByUserId].filter(Boolean)) })
  if (!company) return res.status(404).json({ error: 'not_found' })
  res.json({ company })
})

router.delete('/companies/:id', async (req, res) => {
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

router.post('/admin/companies/reassign', requireGlobalAdminRoute, async (req, res) => {
  const parsed = CompanyReassignmentSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  const targetUser = await getKnownUser(parsed.data.ownerUserId)
  if (!targetUser) return res.status(404).json({ error: 'user_not_found', message: 'Target user was not found.' })

  const companies = await reassignCompanies(parsed.data.companyIds, parsed.data.ownerUserId)
  res.json({ companies, updatedCount: companies.length })
})

export default router
