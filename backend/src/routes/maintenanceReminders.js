import express from 'express'
import { MaintenanceReminderInputSchema } from '../schema.js'
import { completeMaintenanceReminder, createMaintenanceReminder, deleteMaintenanceReminder, listMaintenanceReminders, reopenMaintenanceReminder, updateMaintenanceReminder } from '../maintenanceReminders.js'
import { isFallbackGarden, resolveGardenId, resolveWritableGardenId } from '../gardens.js'
import { forbidden } from '../httpHelpers.js'

const router = express.Router()

router.get('/maintenance-reminders', async (req, res) => {
  try {
    const gardenId = await resolveGardenId(req.user, req.query.gardenId)
    res.json({ reminders: await listMaintenanceReminders({ gardenId, userId: req.user.uid, includeLegacyUnassigned: await isFallbackGarden(req.user, gardenId) }), gardenId })
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }
})

router.post('/maintenance-reminders', async (req, res) => {
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

router.put('/maintenance-reminders/:id', async (req, res) => {
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

router.post('/maintenance-reminders/:id/complete', async (req, res) => {
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

router.post('/maintenance-reminders/:id/reopen', async (req, res) => {
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

router.delete('/maintenance-reminders/:id', async (req, res) => {
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

export default router
