import '../src/env.js'
import { getDb } from '../src/firebase.js'
import { getPool, withTransaction } from '../src/db.js'

const ORDERS_COLLECTION = 'orders'
const ORDER_ITEMS_COLLECTION = 'orderItems'
const ORDER_FILES_COLLECTION = 'orderFiles'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const ORDER_WRITABLE_COLUMNS = ['company_id', 'owner_user_id', 'invoice_number', 'order_date', 'total_cost', 'notes', 'created_at', 'updated_at']
const INSERT_ORDER_SQL = `INSERT INTO orders (id, ${ORDER_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${ORDER_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

const ITEM_WRITABLE_COLUMNS = ['order_id', 'garden_id', 'item_no', 'flower_name', 'cultivar_name', 'item_cost', 'quantity', 'notes', 'created_at', 'updated_at']
const INSERT_ITEM_SQL = `INSERT INTO order_items (id, ${ITEM_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${ITEM_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

const FILE_WRITABLE_COLUMNS = ['order_id', 'original_file_name', 'stored_file_name', 'mime_type', 'file_size', 'file_url', 'source_type', 'created_at']
const INSERT_FILE_SQL = `INSERT INTO order_files (id, ${FILE_WRITABLE_COLUMNS.join(', ')}) VALUES ($1, ${FILE_WRITABLE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')})`

function orderToParams(order) {
  return [
    order.companyId ?? null,
    order.ownerUserId ?? null,
    order.invoiceNumber ?? null,
    order.orderDate ?? null,
    order.totalCost ?? null,
    order.notes ?? null,
    order.createdAt ?? null,
    order.updatedAt ?? null,
  ]
}

function itemToParams(item) {
  return [
    item.orderId ?? null,
    item.gardenId ?? null,
    item.itemNo ?? null,
    item.flowerName ?? null,
    item.cultivarName ?? null,
    item.itemCost ?? null,
    item.quantity ?? null,
    item.notes ?? null,
    item.createdAt ?? null,
    item.updatedAt ?? null,
  ]
}

function fileToParams(file) {
  return [
    file.orderId ?? null,
    file.originalFileName ?? null,
    file.storedFileName ?? null,
    file.mimeType ?? null,
    file.fileSize ?? null,
    file.fileUrl ?? null,
    file.sourceType ?? null,
    file.createdAt ?? null,
  ]
}

const db = getDb()
console.log(`${APPLY ? 'Apply' : 'Dry run'}: migrate-orders-to-postgres`)

const [ordersSnap, itemsSnap, filesSnap] = await Promise.all([
  db.collection(ORDERS_COLLECTION).get(),
  db.collection(ORDER_ITEMS_COLLECTION).get(),
  db.collection(ORDER_FILES_COLLECTION).get(),
])

const orders = ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const items = itemsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const files = filesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

console.log(`Firestore ${ORDERS_COLLECTION}: ${orders.length}`)
console.log(`Firestore ${ORDER_ITEMS_COLLECTION}: ${items.length}`)
console.log(`Firestore ${ORDER_FILES_COLLECTION}: ${files.length}`)

if (!APPLY) {
  console.log('\nDry run only — no Postgres writes made. Re-run with --apply to migrate verbatim.')
  process.exit(0)
}

const pool = getPool()
const [{ rows: existingOrders }, { rows: existingItems }, { rows: existingFiles }] = await Promise.all([
  pool.query('SELECT count(*)::int AS count FROM orders'),
  pool.query('SELECT count(*)::int AS count FROM order_items'),
  pool.query('SELECT count(*)::int AS count FROM order_files'),
])
const alreadyHasRows = existingOrders[0].count > 0 || existingItems[0].count > 0 || existingFiles[0].count > 0
if (alreadyHasRows && !FORCE) {
  console.error(`\nRefusing to --apply: orders has ${existingOrders[0].count}, order_items has ${existingItems[0].count}, order_files has ${existingFiles[0].count} row(s) already. Pass --force to insert anyway.`)
  process.exit(1)
}

await withTransaction(async (client) => {
  for (const order of orders) {
    await client.query(INSERT_ORDER_SQL, [order.id, ...orderToParams(order)])
  }
  for (const item of items) {
    await client.query(INSERT_ITEM_SQL, [item.id, ...itemToParams(item)])
  }
  for (const file of files) {
    await client.query(INSERT_FILE_SQL, [file.id, ...fileToParams(file)])
  }
})

console.log(`\nInserted ${orders.length} rows into orders.`)
console.log(`Inserted ${items.length} rows into order_items.`)
console.log(`Inserted ${files.length} rows into order_files.`)
await pool.end()
