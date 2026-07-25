import express from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import { AssetInputSchema } from '../schema.js'
import { addAssetFile, countAssetFiles, createAsset, deleteAsset, deleteAssetFile, listAssets, updateAsset } from '../assets.js'
import { uploadPublicBlob, deleteBlob } from '../blobStorage.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

router.get('/assets', async (req, res) => {
  const assets = await listAssets({ userId: req.user.uid })
  res.json({ assets })
})

router.post('/assets', async (req, res) => {
  const parsed = AssetInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const asset = await createAsset(parsed.data, { userId: req.user.uid })
  res.json({ asset })
})

router.put('/assets/:id', async (req, res) => {
  const parsed = AssetInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const asset = await updateAsset(req.params.id, parsed.data, { userId: req.user.uid })
  if (!asset) return res.status(404).json({ error: 'not_found' })
  res.json({ asset })
})

router.delete('/assets/:id', async (req, res) => {
  const deleted = await deleteAsset(req.params.id, { userId: req.user.uid })
  if (!deleted) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

router.post('/assets/:id/files', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })
  if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'pdf_required' })

  const storedFileName = `${Date.now()}-${crypto.randomUUID()}.pdf`
  const blobPath = `asset-invoices/${req.params.id}/${storedFileName}`
  const fileUrl = await uploadPublicBlob(blobPath, req.file.buffer, 'application/pdf', 'private, max-age=3600')

  const existingAssetCount = await countAssetFiles(req.params.id)
  const assetFile = await addAssetFile(req.params.id, {
    originalFileName: `Doc ${existingAssetCount + 1}`,
    storedFileName,
    mimeType: req.file.mimetype,
    fileSize: req.file.size,
    fileUrl,
    sourceType: req.body.sourceType || 'uploaded_pdf',
  })

  res.json({ file: assetFile })
})

router.delete('/assets/:id/files/:fileId', async (req, res) => {
  const assetFile = await deleteAssetFile(req.params.id, req.params.fileId)
  if (!assetFile) return res.status(404).json({ error: 'not_found' })

  const blobPath = `asset-invoices/${req.params.id}/${assetFile.storedFileName}`
  await deleteBlob(blobPath)

  res.json({ ok: true })
})

export default router
