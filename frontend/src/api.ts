import { apiHeaders } from './firebase'

export const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? ''

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
