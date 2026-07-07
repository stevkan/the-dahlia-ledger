import express from 'express'
import { isFallbackGarden, requireGardenAccess, requireGardenWriteAccess, resolveGardenId } from '../gardens.js'
import { listColors, renameColor } from '../colors.js'

const router = express.Router()

router.get('/colors', async (req, res) => {
  const gardenId = await resolveGardenId(req.user, req.query.gardenId)
  await requireGardenAccess(req.user, gardenId)
  const includeLegacyUnassigned = await isFallbackGarden(req.user, gardenId)
  res.json({ colors: await listColors(gardenId, { includeLegacyUnassigned }) })
})

router.put('/colors/:name', async (req, res) => {
  const gardenId = await resolveGardenId(req.user, req.query.gardenId)
  await requireGardenWriteAccess(req.user, gardenId)
  const includeLegacyUnassigned = await isFallbackGarden(req.user, gardenId)
  const oldName = decodeURIComponent(req.params.name)
  const { newName } = req.body
  if (!newName || typeof newName !== 'string' || !newName.trim()) {
    return res.status(400).json({ error: 'bad_request', message: 'newName is required.' })
  }
  const result = await renameColor(oldName, newName.trim(), gardenId, { includeLegacyUnassigned })
  res.json(result)
})

export default router
