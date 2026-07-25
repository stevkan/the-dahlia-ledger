import crypto from 'node:crypto'
import { getDb } from './firebase.js'
import { query } from './db.js'
import { getGardenAccess, listGardens, resolveGardenId, requireGardenAccess } from './gardens.js'
import { listRecords, clearRecordSummaryCache } from './records.js'

const ORDERS = 'orders'
const ORDER_ITEMS = 'orderItems'
const ORDER_FILES = 'orderFiles'

const COMPANY_SELECT_COLUMNS = `
  id, garden_id AS "gardenId", owner_user_id AS "ownerUserId", name, website, email, phone, notes,
  created_at AS "createdAt", updated_at AS "updatedAt"
`

function nowIso() {
  return new Date().toISOString()
}

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v)]),
  )
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
  const [companies, ordersSnap, records, gardenIds] = await Promise.all([
    listCompanies(context),
    getDb().collection(ORDERS).get(),
    listRecords(),
    getContextGardenIds(context),
  ])
  const usageByCompanyId = new Map(companies.map((company) => [company.id, emptyCompanyUsage()]))
  const companyIdByKey = new Map(companies.map((company) => [normalizeCompanyKey(company.name), company.id]))

  for (const doc of ordersSnap.docs) {
    const order = { id: doc.id, ...doc.data() }
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
  const [ordersSnap, allRecords] = await Promise.all([
    getDb().collection(ORDERS).where('companyId', '==', id).get(),
    listRecords(),
  ])
  const linkedOrders = ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((order) => ownerMatches(order, context))
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
  const [{ rows: companies }, ordersSnap, itemsSnap, filesSnap] = await Promise.all([
    query(`SELECT ${COMPANY_SELECT_COLUMNS} FROM companies`),
    getDb().collection(ORDERS).get(),
    getDb().collection(ORDER_ITEMS).get(),
    getDb().collection(ORDER_FILES).get(),
  ])
  const companyById = new Map(companies.map((company) => [company.id, company]))
  const itemsByOrder = new Map()
  const filesByOrder = new Map()

  for (const doc of itemsSnap.docs) {
    const item = { id: doc.id, ...doc.data() }
    const list = itemsByOrder.get(item.orderId) ?? []
    list.push(item)
    itemsByOrder.set(item.orderId, list)
  }

  for (const doc of filesSnap.docs) {
    const file = { id: doc.id, ...doc.data() }
    const list = filesByOrder.get(file.orderId) ?? []
    list.push(file)
    filesByOrder.set(file.orderId, list)
  }

  return ordersSnap.docs
    .map((doc) => {
      const order = { id: doc.id, ...doc.data() }
      if (!orderMatchesContext(order, context)) return null
      return {
        ...order,
        company: companyById.get(order.companyId) ?? null,
        items: itemsByOrder.get(order.id) ?? [],
        files: filesByOrder.get(order.id) ?? [],
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
}

export async function createOrder(input, context = {}) {
  const timestamp = nowIso()
  const ref = await getDb()
    .collection(ORDERS)
    .add(
      withoutUndefined({
        companyId: input.companyId,
        ownerUserId: input.ownerUserId || context.userId || undefined,
        invoiceNumber: input.invoiceNumber || undefined,
        orderDate: input.orderDate || undefined,
        totalCost: input.totalCost ?? undefined,
        notes: input.notes || undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    )

  for (const item of input.items ?? []) {
    await getDb()
      .collection(ORDER_ITEMS)
      .add(
        withoutUndefined({
          ...item,
          flowerName: String(item.flowerName ?? '').trim(),
          cultivarName: item.cultivarName ? String(item.cultivarName).trim() : undefined,
          gardenId: item.gardenId || undefined,
          itemCost: item.itemCost ?? undefined,
          quantity: item.quantity ?? undefined,
          notes: item.notes || undefined,
          orderId: ref.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      )
  }

  return (await listOrders(context)).find((order) => order.id === ref.id)
}

export async function updateOrder(id, input, context = {}) {
  const existing = await getDb().collection(ORDERS).doc(id).get()
  if (!existing.exists) return null
  if (!orderMatchesContext(existing.data(), context)) return null

  const timestamp = nowIso()
  const existingItems = await getDb().collection(ORDER_ITEMS).where('orderId', '==', id).get()
  await Promise.all(existingItems.docs.map((doc) => doc.ref.delete()))

  await getDb()
    .collection(ORDERS)
    .doc(id)
    .set(
      withoutUndefined({
        ...existing.data(),
        companyId: input.companyId,
        ownerUserId: input.ownerUserId || existing.data().ownerUserId || context.userId || undefined,
        invoiceNumber: input.invoiceNumber || undefined,
        orderDate: input.orderDate || undefined,
        totalCost: input.totalCost ?? undefined,
        notes: input.notes || undefined,
        updatedAt: timestamp,
      }),
      { merge: false },
    )

  for (const item of input.items ?? []) {
    const itemId = item.id || undefined
    const ref = itemId ? getDb().collection(ORDER_ITEMS).doc(itemId) : getDb().collection(ORDER_ITEMS).doc()
    await ref.set(
      withoutUndefined({
        ...item,
        id: undefined,
        flowerName: String(item.flowerName ?? '').trim(),
        cultivarName: item.cultivarName ? String(item.cultivarName).trim() : undefined,
        gardenId: item.gardenId || undefined,
        itemCost: item.itemCost ?? undefined,
        quantity: item.quantity ?? undefined,
        notes: item.notes || undefined,
        orderId: id,
        createdAt: item.createdAt ?? timestamp,
        updatedAt: timestamp,
      }),
      { merge: false },
    )
  }

  return (await listOrders(context)).find((order) => order.id === id)
}

export async function deleteOrder(id, context = {}) {
  const orderRef = getDb().collection(ORDERS).doc(id)
  const existing = await orderRef.get()
  if (!existing.exists) return false
  if (!orderMatchesContext(existing.data(), context)) return false

  const [itemsSnap, filesSnap] = await Promise.all([
    getDb().collection(ORDER_ITEMS).where('orderId', '==', id).get(),
    getDb().collection(ORDER_FILES).where('orderId', '==', id).get(),
  ])

  await Promise.all([
    ...itemsSnap.docs.map((doc) => doc.ref.delete()),
    ...filesSnap.docs.map((doc) => doc.ref.delete()),
    orderRef.delete(),
  ])
  return true
}

export async function deleteOrderItemsForGarden(gardenId) {
  const itemsSnap = await getDb().collection(ORDER_ITEMS).where('gardenId', '==', gardenId).get()
  const orderIds = [...new Set(itemsSnap.docs.map((doc) => doc.data().orderId).filter(Boolean))]
  await Promise.all(itemsSnap.docs.map((doc) => doc.ref.delete()))

  await Promise.all(orderIds.map(async (orderId) => {
    const remainingItemsSnap = await getDb().collection(ORDER_ITEMS).where('orderId', '==', orderId).get()
    if (remainingItemsSnap.empty) await deleteOrder(orderId, {})
  }))
}

export async function countOrderFiles(orderId) {
  const snap = await getDb().collection(ORDER_FILES).where('orderId', '==', orderId).count().get()
  return snap.data().count
}

export async function addOrderFile(orderId, fileInput) {
  const timestamp = nowIso()
  const ref = await getDb()
    .collection(ORDER_FILES)
    .add(
      withoutUndefined({
        ...fileInput,
        orderId,
        createdAt: timestamp,
      }),
    )
  const doc = await ref.get()
  return { id: doc.id, ...doc.data() }
}

export async function deleteOrderFile(orderId, fileId) {
  const ref = getDb().collection(ORDER_FILES).doc(fileId)
  const doc = await ref.get()
  if (!doc.exists) return null

  const file = { id: doc.id, ...doc.data() }
  if (file.orderId !== orderId) return null

  await ref.delete()
  return file
}
