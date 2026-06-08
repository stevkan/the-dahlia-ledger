import fs from 'node:fs'

import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { normalizeCompanyKey } from '../src/orders.js'
import { listRecords } from '../src/records.js'
import { extractOneNoteImages, imageRefKeys, parseOneNoteMht } from '../src/onenoteImport.js'
import { toTitleCase } from '../src/textFormat.js'
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

const records = await listRecords()
const recordsByKey = new Map(records.map((record) => [`${normalizeCompanyKey(record.tuber?.source)}|${record.flowerName.toLowerCase()}`, record]))
let updated = 0
let missingImage = 0
let missingRecord = 0

for (const entry of entries) {
  const image = entry.imageRef ? imageRefKeys(entry.imageRef).map((ref) => imageByRef.get(ref)).find(Boolean) : undefined
  if (!image) {
    missingImage += 1
    continue
  }

  const record = recordsByKey.get(`${normalizeCompanyKey(entry.farm)}|${toTitleCase(entry.name).toLowerCase()}`)
  if (!record) {
    missingRecord += 1
    continue
  }

  if (record.imageUrl || record.thumbnailUrl) continue

  const photo = await uploadPhotoBuffer(image.data, image.contentType, image.extension)
  await getDb().collection('dahliaRecords').doc(record.id).set(photo, { merge: true })
  updated += 1
}

console.log({ updated, missingImage, missingRecord, entries: entries.length, imageParts: images.length })
