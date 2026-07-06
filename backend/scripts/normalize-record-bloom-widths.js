import '../src/env.js'
import admin from 'firebase-admin'
import { getDb } from '../src/firebase.js'

const COLLECTION = 'dahliaRecords'
const DRY_RUN = process.argv.includes('--dry-run')
const BATCH_LIMIT = 450

const BLOOM_WIDTH_OPTIONS = [
  'AA - over 10"',
  'A - 8" to 10"',
  'B - 6" to 8"',
  'BB - 4" to 6"',
  'M - up to 4"',
  'MC - up to 2"',
]

function normalizeBloomWidthValue(value) {
  const normalized = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  if (!normalized) return undefined

  const existingOption = BLOOM_WIDTH_OPTIONS.find((option) => option.toLowerCase() === normalized.toLowerCase())
  if (existingOption) return existingOption

  const compact = normalized.toLowerCase().replace(/inches|inch|in\.?|"/g, '').replace(/\s+/g, '')
  if (/^aa$|^over10$|^>10$|^10\+$/.test(compact)) return 'AA - over 10"'
  if (/^a$|^8-10$|^8to10$/.test(compact)) return 'A - 8" to 10"'
  if (/^b$|^6-8$|^6to8$/.test(compact)) return 'B - 6" to 8"'
  if (/^bb$|^4-6$|^4to6$/.test(compact)) return 'BB - 4" to 6"'
  if (/^m$|^upto4$|^<=4$|^<4$/.test(compact)) return 'M - up to 4"'
  if (/^mc$|^upto2$|^<=2$|^<2$/.test(compact)) return 'MC - up to 2"'

  const numericValue = Number(compact)
  if (Number.isFinite(numericValue)) {
    if (numericValue > 10) return 'AA - over 10"'
    if (numericValue > 8) return 'A - 8" to 10"'
    if (numericValue > 6) return 'B - 6" to 8"'
    if (numericValue > 4) return 'BB - 4" to 6"'
    if (numericValue > 2) return 'M - up to 4"'
    if (numericValue > 0) return 'MC - up to 2"'
  }

  return undefined
}

function notesWithLegacyBloomWidth(notes, size) {
  const note = `Bloom Width: ${size}`
  const currentNotes = typeof notes === 'string' ? notes.trim() : ''
  if (!currentNotes) return note
  if (currentNotes.split(/\r?\n/).some((line) => line.trim() === note)) return currentNotes
  return `${currentNotes}\n${note}`
}

function describeRecord(record, docId) {
  return record.recordNumber ? `#${record.recordNumber} ${record.flowerName ?? docId}` : `${record.flowerName ?? docId}`
}

async function commitBatch(batch, pendingWrites) {
  if (!pendingWrites || DRY_RUN) return
  await batch.commit()
}

const db = getDb()
const snap = await db.collection(COLLECTION).get()
let batch = db.batch()
let pendingWrites = 0
let checkedCount = 0
let matchedCount = 0
let unmatchedCount = 0
let unchangedCount = 0

for (const doc of snap.docs) {
  checkedCount += 1
  const record = doc.data()
  const size = record.core?.size
  if (size === undefined || size === null || String(size).trim() === '') {
    unchangedCount += 1
    continue
  }

  const normalizedSize = normalizeBloomWidthValue(size)
  if (normalizedSize === size) {
    unchangedCount += 1
    continue
  }

  const timestamp = new Date().toISOString()
  if (normalizedSize) {
    matchedCount += 1
    console.log(`${DRY_RUN ? '[dry-run] ' : ''}${describeRecord(record, doc.id)}: ${size} -> ${normalizedSize}`)
    batch.update(doc.ref, {
      'core.size': normalizedSize,
      'meta.updatedAt': timestamp,
    })
  } else {
    unmatchedCount += 1
    const notes = notesWithLegacyBloomWidth(record.core?.notes, size)
    console.log(`${DRY_RUN ? '[dry-run] ' : ''}${describeRecord(record, doc.id)}: moved unmatched Bloom Width "${size}" to notes`)
    batch.update(doc.ref, {
      'core.size': admin.firestore.FieldValue.delete(),
      'core.notes': notes,
      'meta.updatedAt': timestamp,
    })
  }

  pendingWrites += 1
  if (pendingWrites >= BATCH_LIMIT) {
    await commitBatch(batch, pendingWrites)
    batch = db.batch()
    pendingWrites = 0
  }
}

await commitBatch(batch, pendingWrites)

console.log([
  `${DRY_RUN ? 'Dry run checked' : 'Checked'} ${checkedCount} records.`,
  `${DRY_RUN ? 'Would update' : 'Updated'} ${matchedCount + unmatchedCount}.`,
  `Matched ${matchedCount}.`,
  `Moved unmatched ${unmatchedCount}.`,
  `Unchanged ${unchangedCount}.`,
].join(' '))
