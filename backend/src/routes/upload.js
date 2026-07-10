import express from 'express'
import multer from 'multer'
import path from 'node:path'
import { uploadPhotoBuffer } from '../photos.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })

  const ext = path.extname(req.file.originalname || '').toLowerCase()
  const safeExt = ext && ext.length <= 8 ? ext : ''
  res.json(await uploadPhotoBuffer(req.file.buffer, req.file.mimetype, safeExt))
})

export default router
