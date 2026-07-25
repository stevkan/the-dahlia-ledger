const GARDEN_ACCESS_REVOKED_EVENT = 'garden-access-revoked'

export function isGardenAccessDeniedError(error: unknown) {
  const details = (error as { details?: { error?: string } } | undefined)?.details
  return details?.error === 'garden_access_denied'
}

export function notifyGardenAccessRevoked() {
  window.dispatchEvent(new Event(GARDEN_ACCESS_REVOKED_EVENT))
}

export function onGardenAccessRevoked(handler: () => void) {
  window.addEventListener(GARDEN_ACCESS_REVOKED_EVENT, handler)
  return () => window.removeEventListener(GARDEN_ACCESS_REVOKED_EVENT, handler)
}
