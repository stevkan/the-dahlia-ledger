import crypto from 'node:crypto'
import { query } from './db.js'
import { toTitleCase } from './textFormat.js'

const ASSET_SELECT_COLUMNS = `
  id, owner_user_id AS "ownerUserId", company_id AS "companyId", asset, category, quantity,
  total_cost AS "totalCost", purchase_date AS "purchaseDate", notes,
  linked_order_item_ids AS "linkedOrderItemIds", invoice_number AS "invoiceNumber",
  invoice_total AS "invoiceTotal", created_at AS "createdAt", updated_at AS "updatedAt"
`

const ASSET_FILE_SELECT_COLUMNS = `
  id, asset_id AS "assetId", original_file_name AS "originalFileName", stored_file_name AS "storedFileName",
  mime_type AS "mimeType", file_size AS "fileSize", file_url AS "fileUrl", source_type AS "sourceType",
  created_at AS "createdAt"
`

// Nests the joined company as a single JSON object per asset, null when there's no match,
// instead of fetching every company into a Map for an app-side lookup.
const COMPANY_JSON_BUILD = `
  CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', c.id, 'gardenId', c.garden_id, 'ownerUserId', c.owner_user_id, 'name', c.name,
    'website', c.website, 'email', c.email, 'phone', c.phone, 'notes', c.notes,
    'createdAt', c.created_at, 'updatedAt', c.updated_at
  ) END AS company
`

function nowIso() {
  return new Date().toISOString()
}

function contextMatches(doc, context = {}) {
  if (context.userId) return doc.ownerUserId === context.userId
  return true
}

function cleanAssetInput(input, context = {}, existing = {}) {
  return {
    ownerUserId: input.ownerUserId || existing.ownerUserId || context.userId || null,
    companyId: input.companyId || null,
    asset: toTitleCase(input.asset),
    category: input.category || null,
    quantity: input.quantity ?? null,
    totalCost: input.totalCost ?? null,
    purchaseDate: input.purchaseDate || null,
    notes: input.notes || null,
    linkedOrderItemIds: input.linkedOrderItemIds ?? [],
    invoiceNumber: input.invoiceNumber || null,
    invoiceTotal: input.invoiceTotal ?? null,
  }
}

export async function listAssets(context = {}) {
  const [{ rows: assets }, { rows: files }] = await Promise.all([
    query(`
      SELECT
        a.id, a.owner_user_id AS "ownerUserId", a.company_id AS "companyId", a.asset, a.category, a.quantity,
        a.total_cost AS "totalCost", a.purchase_date AS "purchaseDate", a.notes,
        a.linked_order_item_ids AS "linkedOrderItemIds", a.invoice_number AS "invoiceNumber",
        a.invoice_total AS "invoiceTotal", a.created_at AS "createdAt", a.updated_at AS "updatedAt",
        ${COMPANY_JSON_BUILD}
      FROM assets a
      LEFT JOIN companies c ON a.company_id = c.id
    `),
    query(`SELECT ${ASSET_FILE_SELECT_COLUMNS} FROM asset_files`),
  ])
  const filesByAsset = new Map()

  for (const file of files) {
    const list = filesByAsset.get(file.assetId) ?? []
    list.push(file)
    filesByAsset.set(file.assetId, list)
  }

  return assets
    .map((asset) => {
      if (!contextMatches(asset, context)) return null
      return {
        ...asset,
        files: filesByAsset.get(asset.id) ?? [],
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.purchaseDate ?? b.createdAt ?? '').localeCompare(String(a.purchaseDate ?? a.createdAt ?? '')))
}

export async function createAsset(input, context = {}) {
  const timestamp = nowIso()
  const id = crypto.randomUUID()
  const cleaned = cleanAssetInput(input, context)

  await query(
    `INSERT INTO assets (id, owner_user_id, company_id, asset, category, quantity, total_cost, purchase_date, notes, linked_order_item_ids, invoice_number, invoice_total, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      id,
      cleaned.ownerUserId,
      cleaned.companyId,
      cleaned.asset,
      cleaned.category,
      cleaned.quantity,
      cleaned.totalCost,
      cleaned.purchaseDate,
      cleaned.notes,
      JSON.stringify(cleaned.linkedOrderItemIds),
      cleaned.invoiceNumber,
      cleaned.invoiceTotal,
      timestamp,
      timestamp,
    ],
  )

  return (await listAssets(context)).find((asset) => asset.id === id)
}

export async function updateAsset(id, input, context = {}) {
  const { rows } = await query(`SELECT ${ASSET_SELECT_COLUMNS} FROM assets WHERE id = $1`, [id])
  const existing = rows[0]
  if (!existing) return null
  if (!contextMatches(existing, context)) return null

  const cleaned = cleanAssetInput(input, context, existing)

  await query(
    `UPDATE assets SET owner_user_id = $2, company_id = $3, asset = $4, category = $5, quantity = $6, total_cost = $7,
       purchase_date = $8, notes = $9, linked_order_item_ids = $10, invoice_number = $11, invoice_total = $12, updated_at = $13
     WHERE id = $1`,
    [
      id,
      cleaned.ownerUserId,
      cleaned.companyId,
      cleaned.asset,
      cleaned.category,
      cleaned.quantity,
      cleaned.totalCost,
      cleaned.purchaseDate,
      cleaned.notes,
      JSON.stringify(cleaned.linkedOrderItemIds),
      cleaned.invoiceNumber,
      cleaned.invoiceTotal,
      nowIso(),
    ],
  )

  return (await listAssets(context)).find((asset) => asset.id === id)
}

export async function deleteAsset(id, context = {}) {
  const { rows } = await query(`SELECT ${ASSET_SELECT_COLUMNS} FROM assets WHERE id = $1`, [id])
  const existing = rows[0]
  if (!existing) return false
  if (!contextMatches(existing, context)) return false

  // asset_files cascades automatically (ON DELETE CASCADE).
  await query('DELETE FROM assets WHERE id = $1', [id])
  return true
}

export async function countAssetFiles(assetId) {
  const { rows } = await query('SELECT COUNT(*)::int AS count FROM asset_files WHERE asset_id = $1', [assetId])
  return rows[0].count
}

export async function addAssetFile(assetId, fileInput) {
  const timestamp = nowIso()
  const id = crypto.randomUUID()

  await query(
    `INSERT INTO asset_files (id, asset_id, original_file_name, stored_file_name, mime_type, file_size, file_url, source_type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      assetId,
      fileInput.originalFileName ?? null,
      fileInput.storedFileName ?? null,
      fileInput.mimeType ?? null,
      fileInput.fileSize ?? null,
      fileInput.fileUrl ?? null,
      fileInput.sourceType ?? null,
      timestamp,
    ],
  )
  const { rows } = await query(`SELECT ${ASSET_FILE_SELECT_COLUMNS} FROM asset_files WHERE id = $1`, [id])
  return rows[0]
}

export async function deleteAssetFile(assetId, fileId) {
  const { rows } = await query(`SELECT ${ASSET_FILE_SELECT_COLUMNS} FROM asset_files WHERE id = $1`, [fileId])
  const file = rows[0]
  if (!file) return null
  if (file.assetId !== assetId) return null

  await query('DELETE FROM asset_files WHERE id = $1', [fileId])
  return file
}
