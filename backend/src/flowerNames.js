import { query } from './db.js'
import { clearRecordSummaryCache } from './records.js'

export async function listFlowerNames(gardenId, { includeLegacyUnassigned = false } = {}) {
  const gardenClause = includeLegacyUnassigned ? '(garden_id = $1 OR garden_id IS NULL)' : 'garden_id = $1'
  const [recordsResult, itemsResult] = await Promise.all([
    query(`SELECT DISTINCT flower_name AS "flowerName" FROM dahlia_records WHERE ${gardenClause}`, [gardenId]),
    query(`SELECT DISTINCT flower_name AS "flowerName" FROM order_items WHERE ${gardenClause}`, [gardenId]),
  ])

  const names = new Set(recordsResult.rows.map((row) => row.flowerName))
  for (const row of itemsResult.rows) names.add(row.flowerName)

  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b))
}

export async function renameFlowerName(oldName, newName, gardenId, { includeLegacyUnassigned = false } = {}) {
  const gardenClause = includeLegacyUnassigned ? '(garden_id = $3 OR garden_id IS NULL)' : 'garden_id = $3'

  const { rowCount: recordsUpdated } = await query(
    `UPDATE dahlia_records
     SET flower_name = $1,
         core = CASE WHEN core->>'cultivar' = $2 THEN jsonb_set(core, '{cultivar}', to_jsonb($1::text)) ELSE core END
     WHERE flower_name = $2 AND ${gardenClause}`,
    [newName, oldName, gardenId],
  )
  if (recordsUpdated > 0) clearRecordSummaryCache()

  const { rowCount: itemsUpdated } = await query(
    `UPDATE order_items
     SET flower_name = $1,
         cultivar_name = CASE WHEN cultivar_name = $2 THEN $1 ELSE cultivar_name END
     WHERE flower_name = $2 AND ${gardenClause}`,
    [newName, oldName, gardenId],
  )

  return { updatedCount: recordsUpdated + itemsUpdated }
}
