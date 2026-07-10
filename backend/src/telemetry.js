import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

let _client = undefined

function client() {
  if (_client === undefined) {
    try {
      _client = _require('applicationinsights').defaultClient ?? null
    } catch {
      _client = null
    }
  }
  return _client
}

export function trackException(err, properties) {
  const c = client()
  if (!c) return
  c.trackException({
    exception: err instanceof Error ? err : new Error(String(err)),
    properties,
  })
}

export function trackTrace(message, severity = 1, properties) {
  const c = client()
  if (!c) return
  c.trackTrace({ message, severity, properties })
}

export function trackEvent(name, properties) {
  const c = client()
  if (!c) return
  c.trackEvent({ name, properties })
}
