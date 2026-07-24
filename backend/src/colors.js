import { query } from './db.js'
import { clearRecordSummaryCache } from './records.js'

export async function listColors(gardenId, { includeLegacyUnassigned = false } = {}) {
  const gardenClause = includeLegacyUnassigned ? '(garden_id = $1 OR garden_id IS NULL)' : 'garden_id = $1'
  const { rows } = await query(`SELECT DISTINCT core->>'color' AS color FROM dahlia_records WHERE ${gardenClause}`, [gardenId])

  const colors = new Set(rows.map((row) => row.color).filter(Boolean))
  return [...colors].sort((a, b) => a.localeCompare(b))
}

export async function renameColor(oldColor, newColor, gardenId, { includeLegacyUnassigned = false } = {}) {
  const gardenClause = includeLegacyUnassigned ? '(garden_id = $3 OR garden_id IS NULL)' : 'garden_id = $3'
  const { rowCount } = await query(
    `UPDATE dahlia_records SET core = jsonb_set(core, '{color}', to_jsonb($1::text)) WHERE core->>'color' = $2 AND ${gardenClause}`,
    [newColor, oldColor, gardenId],
  )

  if (rowCount > 0) clearRecordSummaryCache()
  return { updatedCount: rowCount }
}
