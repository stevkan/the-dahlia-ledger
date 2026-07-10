import express from 'express'
import multer from 'multer'
import path from 'node:path'
import { requireGlobalAdminRoute } from '../httpHelpers.js'
import { createRecord, getRecord, listRecords, updateRecord } from '../records.js'
import { ensureCompany, normalizeCompanyKey } from '../orders.js'
import { importExcelLocations } from '../excelImport.js'
import { createExcelImportHistory, getLatestActiveExcelImportHistory, markExcelImportHistoryReverted } from '../excelImportHistory.js'
import { extractOneNoteImages, imageRefKeys, oneNoteEntryToRecord, parseOneNoteMht } from '../onenoteImport.js'
import { uploadPhotoBuffer } from '../photos.js'
import { toTitleCase } from '../textFormat.js'

const router = express.Router()
const oneNoteUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } })
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

router.post('/import/onenote', requireGlobalAdminRoute, oneNoteUpload.single('file'), async (req, res) => {
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

router.post('/import/excel', requireGlobalAdminRoute, excelUpload.single('file'), async (req, res) => {
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

router.use('/import/excel', (err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).send('Uploaded Excel file is too large. Excel imports support files up to 200 MB.')
  }
  next(err)
})

router.post('/import/excel/revert-latest', requireGlobalAdminRoute, async (req, res) => {
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

export default router
