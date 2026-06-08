import crypto from 'node:crypto'
import path from 'node:path'

import sharp from 'sharp'

import { getBucket } from './firebase.js'

const PHOTO_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const THUMBNAIL_WIDTH = 320

function safeExtension(extension = '') {
  const ext = extension.toLowerCase()
  return ext && ext.length <= 8 ? ext : ''
}

function publicStorageObjectName(publicUrl) {
  if (!publicUrl) return undefined

  try {
    const url = new URL(publicUrl)
    const bucketName = getBucket().name
    let objectPath = ''

    if (url.pathname.includes('/o/')) {
      objectPath = url.pathname.split('/o/')[1] ?? ''
    } else {
      objectPath = url.pathname.replace(/^\/+/, '')
      if (objectPath.startsWith(`${bucketName}/`)) objectPath = objectPath.slice(bucketName.length + 1)
    }

    objectPath = decodeURIComponent(objectPath.split('?')[0] ?? '')
    return objectPath || undefined
  } catch {
    return undefined
  }
}

async function uploadPublicFile(objectName, buffer, contentType) {
  const file = getBucket().file(objectName)
  await file.save(buffer, {
    metadata: {
      contentType,
      cacheControl: PHOTO_CACHE_CONTROL,
    },
  })
  await file.makePublic()
  return file.publicUrl()
}

export async function createThumbnail(buffer) {
  return await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()
}

export async function uploadPhotoBuffer(buffer, contentType, extension = '') {
  const id = `${Date.now()}-${crypto.randomUUID()}`
  const safeExt = safeExtension(extension)
  const originalObjectName = `dahlia-photos/originals/${id}${safeExt}`
  const thumbnailObjectName = `dahlia-photos/thumbnails/${id}.webp`

  const [imageUrl, thumbnailBuffer] = await Promise.all([
    uploadPublicFile(originalObjectName, buffer, contentType),
    createThumbnail(buffer),
  ])
  const thumbnailUrl = await uploadPublicFile(thumbnailObjectName, thumbnailBuffer, 'image/webp')

  return { imageUrl, thumbnailUrl }
}

export async function createThumbnailForPhotoUrl(imageUrl) {
  const objectName = publicStorageObjectName(imageUrl)
  if (!objectName) return undefined

  const [buffer] = await getBucket().file(objectName).download()
  const thumbnailBuffer = await createThumbnail(buffer)
  const parsed = path.parse(objectName)
  const thumbnailName = `dahlia-photos/thumbnails/${parsed.name || `${Date.now()}-${crypto.randomUUID()}`}.webp`
  return await uploadPublicFile(thumbnailName, thumbnailBuffer, 'image/webp')
}
