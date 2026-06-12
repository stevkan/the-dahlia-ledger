import { getDb } from './firebase.js'
import { listCompanies } from './orders.js'
import { toTitleCase } from './textFormat.js'

const ASSETS = 'assets'
const ASSET_FILES = 'assetFiles'

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

function contextMatches(doc, context = {}) {
  if (context.userId) return doc.ownerUserId === context.userId
  return true
}

function cleanAssetInput(input, context = {}, existing = {}) {
  return withoutUndefined({
    ...existing,
    ownerUserId: input.ownerUserId || existing.ownerUserId || context.userId || undefined,
    companyId: input.companyId || undefined,
    asset: toTitleCase(input.asset),
    category: input.category || undefined,
    quantity: input.quantity ?? undefined,
    totalCost: input.totalCost ?? undefined,
    purchaseDate: input.purchaseDate || undefined,
    notes: input.notes || undefined,
    linkedOrderItemIds: input.linkedOrderItemIds ?? undefined,
    invoiceNumber: input.invoiceNumber || undefined,
    invoiceTotal: input.invoiceTotal ?? undefined,
  })
}

export async function listAssets(context = {}) {
  const [companies, assetsSnap, filesSnap] = await Promise.all([
    listCompanies(context),
    getDb().collection(ASSETS).get(),
    getDb().collection(ASSET_FILES).get(),
  ])
  const companyById = new Map(companies.map((company) => [company.id, company]))
  const filesByAsset = new Map()

  for (const doc of filesSnap.docs) {
    const file = { id: doc.id, ...doc.data() }
    const list = filesByAsset.get(file.assetId) ?? []
    list.push(file)
    filesByAsset.set(file.assetId, list)
  }

  return assetsSnap.docs
    .map((doc) => {
      const asset = { id: doc.id, ...doc.data() }
      if (!contextMatches(asset, context)) return null
      return {
        ...asset,
        company: asset.companyId ? companyById.get(asset.companyId) ?? null : null,
        files: filesByAsset.get(asset.id) ?? [],
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.purchaseDate ?? b.createdAt ?? '').localeCompare(String(a.purchaseDate ?? a.createdAt ?? '')))
}

export async function createAsset(input, context = {}) {
  const timestamp = nowIso()
  const ref = await getDb()
    .collection(ASSETS)
    .add({
      ...cleanAssetInput(input, context),
      createdAt: timestamp,
      updatedAt: timestamp,
    })

  return (await listAssets(context)).find((asset) => asset.id === ref.id)
}

export async function updateAsset(id, input, context = {}) {
  const ref = getDb().collection(ASSETS).doc(id)
  const existing = await ref.get()
  if (!existing.exists) return null
  if (!contextMatches(existing.data(), context)) return null

  await ref.set(
    {
      ...cleanAssetInput(input, context, existing.data()),
      updatedAt: nowIso(),
    },
    { merge: false },
  )

  return (await listAssets(context)).find((asset) => asset.id === id)
}

export async function deleteAsset(id, context = {}) {
  const assetRef = getDb().collection(ASSETS).doc(id)
  const existing = await assetRef.get()
  if (!existing.exists) return false
  if (!contextMatches(existing.data(), context)) return false

  const filesSnap = await getDb().collection(ASSET_FILES).where('assetId', '==', id).get()
  await Promise.all([
    ...filesSnap.docs.map((doc) => doc.ref.delete()),
    assetRef.delete(),
  ])
  return true
}

export async function addAssetFile(assetId, fileInput) {
  const timestamp = nowIso()
  const ref = await getDb()
    .collection(ASSET_FILES)
    .add(
      withoutUndefined({
        ...fileInput,
        assetId,
        createdAt: timestamp,
      }),
    )
  const doc = await ref.get()
  return { id: doc.id, ...doc.data() }
}

export async function deleteAssetFile(assetId, fileId) {
  const ref = getDb().collection(ASSET_FILES).doc(fileId)
  const doc = await ref.get()
  if (!doc.exists) return null

  const file = { id: doc.id, ...doc.data() }
  if (file.assetId !== assetId) return null

  await ref.delete()
  return file
}
