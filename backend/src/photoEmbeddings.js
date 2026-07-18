import crypto from 'node:crypto'
import { getDb } from './firebase.js'
import { embedImage, embedTexts, EMBEDDING_MODEL_ID } from './embeddings.js'

const COLLECTION = 'photoEmbeddings'

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v)]),
  )
}

export function photoEmbeddingId(imageUrl) {
  return crypto.createHash('sha1').update(imageUrl).digest('hex')
}

export async function embedColorText(color) {
  if (!color) return null
  const [embedding] = await embedTexts([`a photo of a ${color} dahlia flower`])
  return embedding
}

export async function upsertPhotoEmbedding({ gardenId, cultivarName, imageUrl, thumbnailUrl, embedding, model, color, form, colorEmbedding }) {
  const id = photoEmbeddingId(imageUrl)
  await getDb().collection(COLLECTION).doc(id).set(
    withoutUndefined({
      gardenId,
      cultivarName,
      imageUrl,
      thumbnailUrl,
      embedding,
      model,
      color: color ?? null,
      form: form ?? null,
      colorEmbedding: colorEmbedding ?? null,
      createdAt: new Date().toISOString(),
    }),
    { merge: false },
  )
}

export async function deletePhotoEmbeddings(imageUrls) {
  const urls = [...new Set((imageUrls ?? []).filter(Boolean))]
  if (urls.length === 0) return

  const db = getDb()
  await Promise.all(urls.map((url) => db.collection(COLLECTION).doc(photoEmbeddingId(url)).delete()))
}

export async function listPhotoEmbeddings(gardenId) {
  const snap = await getDb().collection(COLLECTION).where('gardenId', '==', gardenId).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

export async function listAllPhotoEmbeddings() {
  const snap = await getDb().collection(COLLECTION).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

function recordPhotoUrls(record) {
  const photos = [...(record.recordPhotos ?? []), ...(record.cultivarPhotos ?? [])]
  const seen = new Map()
  for (const photo of photos) {
    if (!photo?.imageUrl || seen.has(photo.imageUrl)) continue
    seen.set(photo.imageUrl, photo.thumbnailUrl || photo.imageUrl)
  }
  return seen
}

export async function ensureEmbeddingsForRecord(record) {
  if (!record) return

  const urls = recordPhotoUrls(record)
  if (urls.size === 0) return

  const cultivarName = String(record.core?.cultivar || record.flowerName || '').trim()
  if (!cultivarName) return

  const color = record.core?.color || null
  const form = record.core?.form || null

  const db = getDb()
  for (const [imageUrl, thumbnailUrl] of urls) {
    const id = photoEmbeddingId(imageUrl)
    const existingDoc = await db.collection(COLLECTION).doc(id).get()

    if (existingDoc.exists) {
      const existing = existingDoc.data()
      const colorChanged = (existing.color ?? null) !== color
      if (colorChanged || (existing.form ?? null) !== form) {
        const colorEmbedding = colorChanged ? await embedColorText(color) : (existing.colorEmbedding ?? null)
        await db.collection(COLLECTION).doc(id).set({ color, form, colorEmbedding }, { merge: true })
      }
      continue
    }

    const [embedding, colorEmbedding] = await Promise.all([
      embedImage({ url: thumbnailUrl }),
      embedColorText(color),
    ])
    await upsertPhotoEmbedding({
      gardenId: record.gardenId,
      cultivarName,
      imageUrl,
      thumbnailUrl,
      embedding,
      model: EMBEDDING_MODEL_ID,
      color,
      form,
      colorEmbedding,
    })
  }
}
