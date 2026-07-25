import crypto from 'node:crypto'
import path from 'node:path'

import sharp from 'sharp'

import { downloadBlobBuffer, uploadPublicBlob } from './blobStorage.js'

const PHOTO_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const THUMBNAIL_WIDTH = 320
const LIST_THUMBNAIL_WIDTH = 96

function safeExtension(extension = '') {
  const ext = extension.toLowerCase()
  return ext && ext.length <= 8 ? ext : ''
}

async function uploadPublicFile(blobPath, buffer, contentType) {
  const url = await uploadPublicBlob(blobPath, buffer, contentType, PHOTO_CACHE_CONTROL)
  return { url, blobPath }
}

async function resizeToWebp(buffer, width) {
  return await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()
}

export async function createThumbnail(buffer) {
  return await resizeToWebp(buffer, THUMBNAIL_WIDTH)
}

export async function createListThumbnail(buffer) {
  return await resizeToWebp(buffer, LIST_THUMBNAIL_WIDTH)
}

export async function uploadPhotoBuffer(buffer, contentType, extension = '') {
  const id = `${Date.now()}-${crypto.randomUUID()}`
  const safeExt = safeExtension(extension)
  const originalBlobPath = `originals/${id}${safeExt}`
  const thumbnailBlobPath = `thumbnails/${id}.webp`
  const listThumbnailBlobPath = `thumbnails-list/${id}.webp`

  const [original, thumbnailBuffer, listThumbnailBuffer] = await Promise.all([
    uploadPublicFile(originalBlobPath, buffer, contentType),
    createThumbnail(buffer),
    createListThumbnail(buffer),
  ])
  const [thumbnail, listThumbnail] = await Promise.all([
    uploadPublicFile(thumbnailBlobPath, thumbnailBuffer, 'image/webp'),
    uploadPublicFile(listThumbnailBlobPath, listThumbnailBuffer, 'image/webp'),
  ])

  return {
    imageUrl: original.url,
    thumbnailUrl: thumbnail.url,
    listThumbnailUrl: listThumbnail.url,
    imageBlobPath: original.blobPath,
    thumbnailBlobPath: thumbnail.blobPath,
    listThumbnailBlobPath: listThumbnail.blobPath,
  }
}

async function downloadPhotoBuffer(blobPath) {
  if (!blobPath) return undefined
  const buffer = await downloadBlobBuffer(blobPath)
  return { blobPath, buffer }
}

export async function createThumbnailForPhotoUrl(blobPath) {
  const downloaded = await downloadPhotoBuffer(blobPath)
  if (!downloaded) return undefined

  const thumbnailBuffer = await createThumbnail(downloaded.buffer)
  const parsed = path.parse(downloaded.blobPath)
  const thumbnailBlobPath = `thumbnails/${parsed.name || `${Date.now()}-${crypto.randomUUID()}`}.webp`
  return await uploadPublicFile(thumbnailBlobPath, thumbnailBuffer, 'image/webp')
}

export async function createListThumbnailForPhotoUrl(blobPath) {
  const downloaded = await downloadPhotoBuffer(blobPath)
  if (!downloaded) return undefined

  const listThumbnailBuffer = await createListThumbnail(downloaded.buffer)
  const parsed = path.parse(downloaded.blobPath)
  const listThumbnailBlobPath = `thumbnails-list/${parsed.name || `${Date.now()}-${crypto.randomUUID()}`}.webp`
  return await uploadPublicFile(listThumbnailBlobPath, listThumbnailBuffer, 'image/webp')
}
