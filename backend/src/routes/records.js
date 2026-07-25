import express from 'express'
import { z } from 'zod'
import { DahliaPhotoSchema, DahliaRecordInputSchema } from '../schema.js'
import { createRecord, deleteCultivarPhoto, deleteRecord, getRecord, hasLegacyUnassignedRecords, listRecordDrift, listRecords, listRecordsPage, listRecordSummaries, listRecordSummariesPage, markRecordDriftReviewed, updateCultivarPhoto, updateCultivarPhotoDefault, updateRecord, updateRecordPhotoDefault } from '../records.js'
import { isFallbackGarden, requireGardenAccess, requireGardenWriteAccess, resolveGardenId, resolveWritableGardenId } from '../gardens.js'
import { forbidden, requireGlobalAdminRoute } from '../httpHelpers.js'

const router = express.Router()

// Admin-only audit of drift between the frozen Postgres migration snapshot and live records.
// Registered ahead of '/records/:id' so 'audit' never matches as an :id.
router.get('/records/audit/drift', requireGlobalAdminRoute, async (req, res) => {
  res.json(await listRecordDrift())
})

router.post('/records/audit/drift/:id/reviewed', requireGlobalAdminRoute, async (req, res) => {
  const ok = await markRecordDriftReviewed(req.params.id)
  if (!ok) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

router.get('/records', async (req, res) => {
  try {
    const gardenId = await resolveGardenId(req.user, req.query.gardenId)
    const includeLegacyUnassigned = (await isFallbackGarden(req.user, gardenId)) && (await hasLegacyUnassignedRecords())
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

router.get('/records/:id', async (req, res) => {
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

router.post('/records', async (req, res) => {
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

router.put('/records/:id/cultivar-photo', async (req, res) => {
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

router.put('/records/:id/cultivar-photo-default', async (req, res) => {
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

router.put('/records/:id/record-photo-default', async (req, res) => {
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

router.delete('/records/:id/cultivar-photo', async (req, res) => {
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

router.put('/records/:id', async (req, res) => {
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

router.delete('/records/:id', async (req, res) => {
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

export default router
