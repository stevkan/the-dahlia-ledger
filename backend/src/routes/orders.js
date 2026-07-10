import express from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import path from 'node:path'
import { OrderInputSchema } from '../schema.js'
import { addOrderFile, countOrderFiles, createOrder, deleteOrder, deleteOrderFile, listOrders, updateOrder } from '../orders.js'
import { getBucket } from '../firebase.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

router.get('/orders', async (req, res) => {
  const orders = await listOrders({ userId: req.user.uid })
  res.json({ orders })
})

router.post('/orders', async (req, res) => {
  const parsed = OrderInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const order = await createOrder(parsed.data, { userId: req.user.uid })
  res.json({ order })
})

router.put('/orders/:id', async (req, res) => {
  const parsed = OrderInputSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())
  const order = await updateOrder(req.params.id, parsed.data, { userId: req.user.uid })
  if (!order) return res.status(404).json({ error: 'not_found' })
  res.json({ order })
})

router.delete('/orders/:id', async (req, res) => {
  const deleted = await deleteOrder(req.params.id, { userId: req.user.uid })
  if (!deleted) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

router.post('/orders/:id/files', upload.single('file'), async (req, res) => {
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

router.delete('/orders/:id/files/:fileId', async (req, res) => {
  const orderFile = await deleteOrderFile(req.params.id, req.params.fileId)
  if (!orderFile) return res.status(404).json({ error: 'not_found' })

  const objectName = `order-invoices/${req.params.id}/${orderFile.storedFileName}`
  await getBucket().file(objectName).delete({ ignoreNotFound: true })

  res.json({ ok: true })
})

export default router
