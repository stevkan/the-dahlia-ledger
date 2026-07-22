import { BlobServiceClient } from '@azure/storage-blob'

let containerClient

export function getContainerClient() {
  if (containerClient) return containerClient

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
  const containerName = process.env.AZURE_STORAGE_PHOTOS_CONTAINER
  if (!connectionString) throw new Error('Missing AZURE_STORAGE_CONNECTION_STRING')
  if (!containerName) throw new Error('Missing AZURE_STORAGE_PHOTOS_CONTAINER')

  const serviceClient = BlobServiceClient.fromConnectionString(connectionString)
  containerClient = serviceClient.getContainerClient(containerName)
  return containerClient
}

export function blobPublicUrl(blobPath) {
  return getContainerClient().getBlockBlobClient(blobPath).url
}

export async function uploadPublicBlob(blobPath, buffer, contentType, cacheControl) {
  const blockBlobClient = getContainerClient().getBlockBlobClient(blobPath)
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType,
      blobCacheControl: cacheControl,
    },
  })
  return blockBlobClient.url
}

async function streamToBuffer(readableStream) {
  const chunks = []
  for await (const chunk of readableStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function downloadBlobBuffer(blobPath) {
  const blockBlobClient = getContainerClient().getBlockBlobClient(blobPath)
  const downloadResponse = await blockBlobClient.download()
  return streamToBuffer(downloadResponse.readableStreamBody)
}

export async function deleteBlob(blobPath) {
  await getContainerClient().getBlockBlobClient(blobPath).deleteIfExists()
}
