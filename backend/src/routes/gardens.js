import express from 'express'
import { GardenInputSchema, InviteInputSchema, MemberInputSchema } from '../schema.js'
import { acceptInvite, createGarden, createInvite, deleteGarden, deleteInvite, listGardenMembers, listGardens, listInvites, removeGardenMember, resendInvite, updateGarden, upsertGardenMember } from '../gardens.js'
import { forbidden } from '../httpHelpers.js'

const router = express.Router()

router.get('/gardens', async (req, res) => {
  res.json({ gardens: await listGardens(req.user) })
})

router.post('/gardens', async (req, res) => {
  const parsed = GardenInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  try {
    res.json({ garden: await createGarden(req.user, parsed.data) })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

router.put('/gardens/:id', async (req, res) => {
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

router.delete('/gardens/:id', async (req, res) => {
  try {
    const result = await deleteGarden(req.user, req.params.id)
    if (!result.deleted) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true, counts: result.counts })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

router.get('/gardens/:id/members', async (req, res) => {
  try {
    res.json({ members: await listGardenMembers(req.user, req.params.id) })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

router.post('/gardens/:id/members', async (req, res) => {
  const parsed = MemberInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  try {
    res.json({ member: await upsertGardenMember(req.user, req.params.id, parsed.data) })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

router.delete('/gardens/:gardenId/members/:memberId', async (req, res) => {
  try {
    const deleted = await removeGardenMember(req.user, req.params.gardenId, req.params.memberId)
    if (!deleted) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

router.get('/invites', async (req, res) => {
  try {
    res.json({ invites: await listInvites(req.user, { gardenId: req.query.gardenId }) })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

router.post('/invites', async (req, res) => {
  const parsed = InviteInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  try {
    res.json({ invite: await createInvite(req.user, parsed.data) })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

router.post('/invites/:id/resend', async (req, res) => {
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

router.delete('/invites/:id', async (req, res) => {
  try {
    const deleted = await deleteInvite(req.user, req.params.id)
    if (!deleted) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

router.post('/invites/:token/accept', async (req, res) => {
  try {
    const invite = await acceptInvite(req.user, req.params.token)
    if (!invite) return res.status(404).json({ error: 'not_found' })
    res.json({ invite })
  } catch (e) {
    if (e?.code === 'invite_expired' || e?.code === 'invite_email_mismatch') return res.status(409).json({ error: e.code, message: e.message })
    throw e
  }
})

export default router
