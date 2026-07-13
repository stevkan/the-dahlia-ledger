import { apiHeaders, authHeaders } from '../firebase'
import type { AgentPhotoIdentificationResult } from '../types'

export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(await apiHeaders(init?.headers)),
    },
    ...init,
  })
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

export async function uploadPhoto(file: File): Promise<{ imageUrl: string; thumbnailUrl?: string }> {
  const body = new FormData()
  body.append('file', file)

  const res = await fetch(`${API_BASE}/api/upload`, {
    method: 'POST',
    headers: await authHeaders(),
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Upload failed: ${res.status}`)
  }
  return (await res.json()) as { imageUrl: string; thumbnailUrl?: string }
}

export async function identifyPhoto(input: { file?: File; imageUrl?: string }): Promise<AgentPhotoIdentificationResult> {
  const body = new FormData()
  if (input.file) body.append('file', input.file)
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
