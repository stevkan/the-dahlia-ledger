import '../src/env.js'
import { getDb } from '../src/firebase.js'

const DRY_RUN = process.argv.includes('--dry-run')
const BATCH_LIMIT = 450

const db = getDb()

async function backfillCollection(collectionName, idField) {
  const snap = await db.collection(collectionName).get()

  const byParent = new Map()
  for (const doc of snap.docs) {
    const data = doc.data()
    const parentId = data[idField]
    if (!parentId) continue
    const list = byParent.get(parentId) ?? []
    list.push({ ref: doc.ref, data })
    byParent.set(parentId, list)
  }

  let batch = db.batch()
  let pendingWrites = 0
  let checkedCount = 0
  let updatedCount = 0
  let unchangedCount = 0

  for (const [parentId, files] of byParent) {
    files.sort((a, b) => {
      const ta = a.data.createdAt ?? ''
      const tb = b.data.createdAt ?? ''
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })

    for (let i = 0; i < files.length; i++) {
      checkedCount += 1
      const { ref, data } = files[i]
      const newName = `Doc ${i + 1}`
      if (data.originalFileName === newName) {
        unchangedCount += 1
        continue
      }

      console.log(`${DRY_RUN ? '[dry-run] ' : ''}${collectionName}/${ref.id} (${idField}: ${parentId}): "${data.originalFileName ?? ''}" -> "${newName}"`)
      if (!DRY_RUN) {
        batch.update(ref, { originalFileName: newName })
        pendingWrites += 1
        if (pendingWrites >= BATCH_LIMIT) {
          await batch.commit()
          batch = db.batch()
          pendingWrites = 0
        }
      }
      updatedCount += 1
    }
  }

  if (!DRY_RUN && pendingWrites > 0) await batch.commit()

  console.log([
    `${collectionName}:`,
    `${DRY_RUN ? 'Dry run checked' : 'Checked'} ${checkedCount} files.`,
    `${DRY_RUN ? 'Would update' : 'Updated'} ${updatedCount}.`,
    `Unchanged ${unchangedCount}.`,
  ].join(' '))
}

await backfillCollection('orderFiles', 'orderId')
await backfillCollection('assetFiles', 'assetId')
