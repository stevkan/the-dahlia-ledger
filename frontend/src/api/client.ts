import { apiHeaders, authHeaders } from '../firebase'
import type { AgentPhotoIdentificationResult } from '../types'

export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

// Mobile connections can stall completely (screen lock, camera app backgrounding the tab, a
// dropped cell connection) without the fetch ever settling, leaving callers awaiting it forever
// with no error surfaced. Abort after a bound so the caller gets a real failure instead of a hang.
function withRequestTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, cancel: () => clearTimeout(timer) }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { signal, cancel } = withRequestTimeout(30000)
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(await apiHeaders(init?.headers)),
      },
      signal,
      ...init,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out. Check your connection and try again.')
    }
    throw err
  } finally {
    cancel()
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = text || `Request failed: ${res.status}`
    let details: unknown
    try {
      const parsed = text ? JSON.parse(text) : null
      if (parsed && typeof parsed === 'object') {
        message = typeof parsed.message === 'string' ? parsed.message : message
        details = parsed
      }
    } catch {
      // Keep the raw response text when the server returns plain text.
    }
    const error = new Error(message) as Error & { details?: unknown }
    error.details = details
    throw error
  }
  return (await res.json()) as T
}

export async function fetchAppCheckDebugToken(): Promise<string | null> {
  return (await api<{ debugToken: string | null }>('/api/app-check/debug-token')).debugToken
}

export async function generateAppCheckDebugToken(): Promise<string> {
  return (await api<{ debugToken: string }>('/api/app-check/debug-token/generate', { method: 'POST' })).debugToken
}

export async function uploadPhoto(file: File): Promise<{ imageUrl: string; thumbnailUrl?: string; listThumbnailUrl?: string }> {
  const body = new FormData()
  body.append('file', file)

  const { signal, cancel } = withRequestTimeout(90000)
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      headers: await authHeaders(),
      body,
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Upload timed out. Check your connection and try again.')
    }
    throw err
  } finally {
    cancel()
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Upload failed: ${res.status}`)
  }
  return (await res.json()) as { imageUrl: string; thumbnailUrl?: string; listThumbnailUrl?: string }
}

const IDENTIFY_PHOTO_MAX_DIMENSION = 768
const IDENTIFY_PHOTO_JPEG_QUALITY = 0.85

async function resizeForIdentification(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, IDENTIFY_PHOTO_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1) {
      bitmap.close()
      return file
    }

    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', IDENTIFY_PHOTO_JPEG_QUALITY))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export async function identifyPhoto(input: { file?: File; imageUrl?: string }): Promise<AgentPhotoIdentificationResult> {
  const body = new FormData()
  if (input.file) body.append('file', await resizeForIdentification(input.file))
  if (input.imageUrl) body.append('imageUrl', input.imageUrl)

  const res = await fetch(`${API_BASE}/api/agent/identify-photo`, {
    method: 'POST',
    headers: await authHeaders(),
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Photo identification failed: ${res.status}`)
  }
  return (await res.json()) as AgentPhotoIdentificationResult
}
