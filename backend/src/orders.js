import crypto from 'node:crypto'
import { query, withTransaction } from './db.js'
import { getGardenAccess, listGardens, resolveGardenId, requireGardenAccess } from './gardens.js'
import { listRecords, clearRecordSummaryCache } from './records.js'

const COMPANY_SELECT_COLUMNS = `
  id, garden_id AS "gardenId", owner_user_id AS "ownerUserId", name, website, email, phone, notes,
  created_at AS "createdAt", updated_at AS "updatedAt"
`

const ORDER_SELECT_COLUMNS = `
  id, company_id AS "companyId", owner_user_id AS "ownerUserId", invoice_number AS "invoiceNumber",
  order_date AS "orderDate", total_cost AS "totalCost", notes, created_at AS "createdAt", updated_at AS "updatedAt"
`

const ORDER_ITEM_SELECT_COLUMNS = `
  id, order_id AS "orderId", garden_id AS "gardenId", item_no AS "itemNo", flower_name AS "flowerName",
  cultivar_name AS "cultivarName", item_cost AS "itemCost", quantity, notes,
  created_at AS "createdAt", updated_at AS "updatedAt"
`

const ORDER_FILE_SELECT_COLUMNS = `
  id, order_id AS "orderId", original_file_name AS "originalFileName", stored_file_name AS "storedFileName",
  mime_type AS "mimeType", file_size AS "fileSize", file_url AS "fileUrl", source_type AS "sourceType",
  created_at AS "createdAt"
`

// Nests the joined company as a single JSON object per order, null when there's no match,
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

export function normalizeCompanyKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function sortByName(a, b) {
  return String(a.name ?? '').localeCompare(String(b.name ?? ''))
}

function ownerMatches(doc, context = {}) {
  if (context.userId) return doc.ownerUserId === context.userId
  return true
}

function contextMatches(doc, context = {}, gardenIds = null) {
  if (!context.userId) return true
  if (doc.gardenId && gardenIds) return gardenIds.has(doc.gardenId)
  if (context.gardenOwnerUserIds?.has(doc.ownerUserId)) return true
  return doc.ownerUserId === context.userId
}

function orderMatchesContext(doc, context = {}) {
  return ownerMatches(doc, context)
}

async function getContextGardenIds(context = {}) {
  if (!context.user) return null
  const gardens = await listGardens(context.user)
  return new Set(gardens.map((garden) => garden.id))
}

function recordMatchesContext(record, context = {}, gardenIds = null) {
  if (!context.userId) return true
  if (!gardenIds) return false
  return gardenIds.has(record.gardenId)
}

export async function listCompanies(context = {}) {
  const [{ rows }, gardenIds] = await Promise.all([
    query(`SELECT ${COMPANY_SELECT_COLUMNS} FROM companies`),
    getContextGardenIds(context),
  ])
  return rows.filter((company) => contextMatches(company, context, gardenIds)).map((company) => withCompanyPermissions(company, context, gardenIds)).sort(sortByName)
}

function withCompanyPermissions(company, context = {}, gardenIds = null) {
  const isOwner = Boolean(context.userId && company.ownerUserId === context.userId)
  const isGardenVisible = Boolean(company.gardenId && gardenIds?.has(company.gardenId))
  const isGardenOwnerLegacyCompany = Boolean(!company.gardenId && context.gardenOwnerUserIds?.has(company.ownerUserId))
  const isGardenOwner = Boolean(company.gardenId && context.gardenOwnerIds?.has(company.gardenId))
  return {
    ...company,
    canUpdate: isOwner || isGardenVisible || isGardenOwnerLegacyCompany,
    canDelete: isOwner || isGardenOwner,
  }
}

function emptyCompanyUsage() {
  return {
    orderCount: 0,
    flowerRecordCount: 0,
    orders: [],
    flowerRecords: [],
  }
}

function summarizeCompanyUsage({ orders = [], flowerRecords = [] }) {
  return {
    orderCount: orders.length,
    flowerRecordCount: flowerRecords.length,
    orders: orders.map((order) => ({
      id: order.id,
      invoiceNumber: order.invoiceNumber ?? null,
      orderDate: order.orderDate ?? null,
      totalCost: order.totalCost ?? null,
    })),
    flowerRecords: flowerRecords.map((record) => ({
      id: record.id,
      gardenId: record.gardenId ?? null,
      recordNumber: record.recordNumber ?? null,
      flowerName: record.flowerName ?? '',
      seasonYearStart: record.seasonYearStart ?? null,
      meta: {
        gardenArea: record.meta?.gardenArea ?? null,
        gardenZone: record.meta?.gardenZone ?? null,
      },
    })),
  }
}

function cleanCompanyInput(input) {
  return {
    name: String(input.name ?? '').trim(),
    website: input.website || undefined,
    email: input.email || undefined,
    phone: input.phone || undefined,
    notes: input.notes || undefined,
  }
}

export async function listCompaniesWithUsage(context = {}) {
  const [companies, { rows: orders }, records, gardenIds] = await Promise.all([
    listCompanies(context),
    query(`SELECT ${ORDER_SELECT_COLUMNS} FROM orders`),
    listRecords(),
    getContextGardenIds(context),
  ])
  const usageByCompanyId = new Map(companies.map((company) => [company.id, emptyCompanyUsage()]))
  const companyIdByKey = new Map(companies.map((company) => [normalizeCompanyKey(company.name), company.id]))

  for (const order of orders) {
    if (!ownerMatches(order, context)) continue
    const usage = usageByCompanyId.get(order.companyId)
    if (usage) usage.orders.push(order)
  }

  for (const record of records) {
    if (!recordMatchesContext(record, context, gardenIds)) continue
    const companyId = companyIdByKey.get(normalizeCompanyKey(record.tuber?.source))
    const usage = companyId ? usageByCompanyId.get(companyId) : null
    if (usage) usage.flowerRecords.push(record)
  }

  return companies.map((company) => ({
    ...company,
    usage: summarizeCompanyUsage(usageByCompanyId.get(company.id) ?? emptyCompanyUsage()),
  }))
}

export async function getCompanyWithUsage(id, context = {}) {
  const companies = await listCompaniesWithUsage(context)
  return companies.find((company) => company.id === id) ?? null
}

export async function createCompany(input, context = {}) {
  const timestamp = nowIso()
  const gardenId = input.gardenId || context.gardenId || (context.user ? await resolveGardenId(context.user, null) : undefined)
  if (gardenId && context.user) await requireGardenAccess(context.user, gardenId)

  const id = crypto.randomUUID()
  await query(
    `INSERT INTO companies (id, garden_id, owner_user_id, name, website, email, phone, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      gardenId || null,
      input.ownerUserId || context.userId || null,
      String(input.name ?? '').trim(),
      input.website || null,
      input.email || null,
      input.phone || null,
      input.notes || null,
      timestamp,
      timestamp,
    ],
  )
  const { rows } = await query(`SELECT ${COMPANY_SELECT_COLUMNS} FROM companies WHERE id = $1`, [id])
  return rows[0]
}

export async function ensureCompany(name, context = {}) {
  const companyName = String(name ?? '').trim()
  if (!companyName) return { company: null, created: false }

  const companies = await listCompanies(context)
  const companyKey = normalizeCompanyKey(companyName)
  const existing = companies.find((company) => normalizeCompanyKey(company.name) === companyKey)
  if (existing) return { company: existing, created: false }

  return { company: await createCompany({ name: companyName }, context), created: true }
}

export async function updateCompany(id, input, context = {}) {
  const { rows: existingRows } = await query(`SELECT ${COMPANY_SELECT_COLUMNS} FROM companies WHERE id = $1`, [id])
  const existingCompany = existingRows[0]
  if (!existingCompany) return null
  const gardenIds = await getContextGardenIds(context)
  if (!contextMatches(existingCompany, context, gardenIds)) return null
  const cleanedInput = cleanCompanyInput(input)

  await query(
    `UPDATE companies SET name = $2, website = $3, email = $4, phone = $5, notes = $6, updated_at = $7 WHERE id = $1`,
    [id, cleanedInput.name, cleanedInput.website || null, cleanedInput.email || null, cleanedInput.phone || null, cleanedInput.notes || null, nowIso()],
  )

  if (normalizeCompanyKey(existingCompany.name) !== normalizeCompanyKey(cleanedInput.name)) {
    const allRecords = await listRecords()
    const matchingRecords = allRecords
      .filter((record) => recordMatchesContext(record, context, gardenIds))
      .filter((record) => normalizeCompanyKey(record.tuber?.source) === normalizeCompanyKey(existingCompany.name))

    if (matchingRecords.length > 0) {
      await query(
        `UPDATE dahlia_records
         SET tuber = jsonb_set(tuber, '{source}', to_jsonb($1::text)),
             meta = jsonb_set(meta, '{updatedAt}', to_jsonb($2::text))
         WHERE id = ANY($3::text[])`,
        [cleanedInput.name, nowIso(), matchingRecords.map((record) => record.id)],
      )
      clearRecordSummaryCache()
    }
  }

  return await getCompanyWithUsage(id, context)
}

export async function deleteCompany(id, context = {}) {
  const { rows: companyRows } = await query(`SELECT ${COMPANY_SELECT_COLUMNS} FROM companies WHERE id = $1`, [id])
  const company = companyRows[0]
  if (!company) return true

  const gardenIds = await getContextGardenIds(context)
  if (!contextMatches(company, context, gardenIds)) return true
  const isOwner = context.userId && company.ownerUserId === context.userId
  const gardenAccess = company.gardenId && context.user ? await getGardenAccess(context.user, company.gardenId) : null
  if (!isOwner && gardenAccess?.role !== 'owner') {
    const error = new Error('Only the company owner or a joint garden owner can delete this company.')
    error.code = 'company_delete_denied'
    throw error
  }
  const [{ rows: ordersForCompany }, allRecords] = await Promise.all([
    query(`SELECT ${ORDER_SELECT_COLUMNS} FROM orders WHERE company_id = $1`, [id]),
    listRecords(),
  ])
  const linkedOrders = ordersForCompany.filter((order) => ownerMatches(order, context))
  const linkedFlowerRecords = allRecords
    .filter((record) => recordMatchesContext(record, context, gardenIds))
    .filter((record) => normalizeCompanyKey(record.tuber?.source) === normalizeCompanyKey(company.name))

  if (linkedOrders.length > 0 || linkedFlowerRecords.length > 0) {
    const error = new Error(`Cannot delete ${company.name} because it is used by ${linkedOrders.length} invoice record${linkedOrders.length === 1 ? '' : 's'} and ${linkedFlowerRecords.length} flower record${linkedFlowerRecords.length === 1 ? '' : 's'}.`)
    error.code = 'company_in_use'
    error.usage = summarizeCompanyUsage({ orders: linkedOrders, flowerRecords: linkedFlowerRecords })
    throw error
  }

  await query('DELETE FROM companies WHERE id = $1', [id])
  return true
}

export async function reassignCompanies(companyIds, ownerUserId) {
  const ids = [...new Set((companyIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))]
  const nextOwnerUserId = String(ownerUserId ?? '').trim()
  if (!ids.length || !nextOwnerUserId) return []

  const timestamp = nowIso()
  const { rows } = await query(
    `UPDATE companies SET owner_user_id = $1, updated_at = $2 WHERE id = ANY($3::text[]) RETURNING ${COMPANY_SELECT_COLUMNS}`,
    [nextOwnerUserId, timestamp, ids],
  )

  return rows.sort(sortByName)
}

export async function listOrders(context = {}) {
  const [{ rows: orders }, { rows: items }, { rows: files }] = await Promise.all([
    query(`
      SELECT
        o.id, o.company_id AS "companyId", o.owner_user_id AS "ownerUserId", o.invoice_number AS "invoiceNumber",
        o.order_date AS "orderDate", o.total_cost AS "totalCost", o.notes, o.created_at AS "createdAt", o.updated_at AS "updatedAt",
        ${COMPANY_JSON_BUILD}
      FROM orders o
      LEFT JOIN companies c ON o.company_id = c.id
    `),
    query(`SELECT ${ORDER_ITEM_SELECT_COLUMNS} FROM order_items`),
    query(`SELECT ${ORDER_FILE_SELECT_COLUMNS} FROM order_files`),
  ])
  const itemsByOrder = new Map()
  const filesByOrder = new Map()

  for (const item of items) {
    const list = itemsByOrder.get(item.orderId) ?? []
    list.push(item)
    itemsByOrder.set(item.orderId, list)
  }

  for (const file of files) {
    const list = filesByOrder.get(file.orderId) ?? []
    list.push(file)
    filesByOrder.set(file.orderId, list)
  }

  return orders
    .map((order) => {
      if (!orderMatchesContext(order, context)) return null
      return {
        ...order,
        items: itemsByOrder.get(order.id) ?? [],
        files: filesByOrder.get(order.id) ?? [],
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
}

export async function createOrder(input, context = {}) {
  const timestamp = nowIso()
  const id = crypto.randomUUID()

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO orders (id, company_id, owner_user_id, invoice_number, order_date, total_cost, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        input.companyId,
        input.ownerUserId || context.userId || null,
        input.invoiceNumber || null,
        input.orderDate || null,
        input.totalCost ?? null,
        input.notes || null,
        timestamp,
        timestamp,
      ],
    )

    for (const item of input.items ?? []) {
      await client.query(
        `INSERT INTO order_items (id, order_id, garden_id, item_no, flower_name, cultivar_name, item_cost, quantity, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          crypto.randomUUID(),
          id,
          item.gardenId || null,
          item.itemNo || null,
          String(item.flowerName ?? '').trim(),
          item.cultivarName ? String(item.cultivarName).trim() : null,
          item.itemCost ?? null,
          item.quantity ?? null,
          item.notes || null,
          timestamp,
          timestamp,
        ],
      )
    }
  })

  return (await listOrders(context)).find((order) => order.id === id)
}

export async function updateOrder(id, input, context = {}) {
  const { rows: existingRows } = await query(`SELECT ${ORDER_SELECT_COLUMNS} FROM orders WHERE id = $1`, [id])
  const existing = existingRows[0]
  if (!existing) return null
  if (!orderMatchesContext(existing, context)) return null

  const timestamp = nowIso()

  await withTransaction(async (client) => {
    await client.query('DELETE FROM order_items WHERE order_id = $1', [id])

    await client.query(
      `UPDATE orders SET company_id = $2, owner_user_id = $3, invoice_number = $4, order_date = $5, total_cost = $6, notes = $7, updated_at = $8
       WHERE id = $1`,
      [
        id,
        input.companyId,
        input.ownerUserId || existing.ownerUserId || context.userId || null,
        input.invoiceNumber || null,
        input.orderDate || null,
        input.totalCost ?? null,
        input.notes || null,
        timestamp,
      ],
    )

    for (const item of input.items ?? []) {
      const itemId = item.id || crypto.randomUUID()
      await client.query(
        `INSERT INTO order_items (id, order_id, garden_id, item_no, flower_name, cultivar_name, item_cost, quantity, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          itemId,
          id,
          item.gardenId || null,
          item.itemNo || null,
          String(item.flowerName ?? '').trim(),
          item.cultivarName ? String(item.cultivarName).trim() : null,
          item.itemCost ?? null,
          item.quantity ?? null,
          item.notes || null,
          item.createdAt ?? timestamp,
          timestamp,
        ],
      )
    }
  })

  return (await listOrders(context)).find((order) => order.id === id)
}

export async function deleteOrder(id, context = {}) {
  const { rows } = await query(`SELECT ${ORDER_SELECT_COLUMNS} FROM orders WHERE id = $1`, [id])
  const existing = rows[0]
  if (!existing) return false
  if (!orderMatchesContext(existing, context)) return false

  // order_items and order_files cascade automatically (ON DELETE CASCADE).
  await query('DELETE FROM orders WHERE id = $1', [id])
  return true
}

export async function deleteOrderItemsForGarden(gardenId) {
  const { rows: items } = await query('SELECT order_id AS "orderId" FROM order_items WHERE garden_id = $1', [gardenId])
  const orderIds = [...new Set(items.map((item) => item.orderId).filter(Boolean))]

  await query('DELETE FROM order_items WHERE garden_id = $1', [gardenId])

  await Promise.all(orderIds.map(async (orderId) => {
    const { rows: remaining } = await query('SELECT 1 FROM order_items WHERE order_id = $1 LIMIT 1', [orderId])
    if (remaining.length === 0) await deleteOrder(orderId, {})
  }))
}

export async function countOrderFiles(orderId) {
  const { rows } = await query('SELECT COUNT(*)::int AS count FROM order_files WHERE order_id = $1', [orderId])
  return rows[0].count
}

export async function addOrderFile(orderId, fileInput) {
  const timestamp = nowIso()
  const id = crypto.randomUUID()

  await query(
    `INSERT INTO order_files (id, order_id, original_file_name, stored_file_name, mime_type, file_size, file_url, source_type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      orderId,
      fileInput.originalFileName ?? null,
      fileInput.storedFileName ?? null,
      fileInput.mimeType ?? null,
      fileInput.fileSize ?? null,
      fileInput.fileUrl ?? null,
      fileInput.sourceType ?? null,
      timestamp,
    ],
  )
  const { rows } = await query(`SELECT ${ORDER_FILE_SELECT_COLUMNS} FROM order_files WHERE id = $1`, [id])
  return rows[0]
}

export async function deleteOrderFile(orderId, fileId) {
  const { rows } = await query(`SELECT ${ORDER_FILE_SELECT_COLUMNS} FROM order_files WHERE id = $1`, [fileId])
  const file = rows[0]
  if (!file) return null
  if (file.orderId !== orderId) return null

  await query('DELETE FROM order_files WHERE id = $1', [fileId])
  return file
}
