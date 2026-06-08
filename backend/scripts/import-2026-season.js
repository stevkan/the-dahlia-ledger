import fs from 'node:fs'

import '../src/env.js'
import { ensureCompany, normalizeCompanyKey } from '../src/orders.js'
import { createRecord, listRecords } from '../src/records.js'
import { extractOneNoteImages, imageRefKeys, oneNoteEntryToRecord, parseOneNoteMht } from '../src/onenoteImport.js'
import { uploadPhotoBuffer } from '../src/photos.js'

const buffer = fs.readFileSync('./2026 Season.mht')
const entries = parseOneNoteMht(buffer)
const images = extractOneNoteImages(buffer)
const imageByRef = new Map()

for (const image of images) {
  for (const key of [...imageRefKeys(image.contentLocation), ...imageRefKeys(image.contentId), ...imageRefKeys(`cid:${image.contentId}`)]) {
    imageByRef.set(key, image)
  }
}

const existing = await listRecords()
const existingKeys = new Set(existing.map((record) => `${normalizeCompanyKey(record.tuber?.source)}|${record.flowerName.toLowerCase()}`))
const companyByKey = new Map()
const createdCompanyKeys = new Set()
let importedCount = 0
let skippedCount = 0
let imageCount = 0

for (const entry of entries) {
  const companyKey = normalizeCompanyKey(entry.farm)
  let company = companyByKey.get(companyKey)

  if (!company && entry.farm) {
    const ensured = await ensureCompany(entry.farm)
    company = ensured.company
    companyByKey.set(companyKey, company)
    if (ensured.created) createdCompanyKeys.add(companyKey)
  }

  const key = `${companyKey}|${entry.name.toLowerCase()}`
  if (existingKeys.has(key)) {
    skippedCount += 1
    continue
  }

  const image = entry.imageRef ? imageRefKeys(entry.imageRef).map((ref) => imageByRef.get(ref)).find(Boolean) : undefined
  const photo = image ? await uploadPhotoBuffer(image.data, image.contentType, image.extension) : undefined
  if (photo) imageCount += 1

  await createRecord(oneNoteEntryToRecord({ ...entry, farm: company?.name ?? entry.farm, ...photo }))
  existingKeys.add(key)
  importedCount += 1
}

console.log({ importedCount, skippedCount, imageCount, createdCompanyCount: createdCompanyKeys.size, entries: entries.length, imageParts: images.length })
