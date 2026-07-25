import { useEffect, useState } from 'react'

type NetworkInformation = {
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g'
  saveData?: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

function getConnection(): NetworkInformation | undefined {
  const nav = navigator as Navigator & {
    connection?: NetworkInformation
    mozConnection?: NetworkInformation
    webkitConnection?: NetworkInformation
  }
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection
}

function isWeak(connection: NetworkInformation | undefined) {
  if (!connection) return false
  return connection.saveData === true || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
}

// Browser support for the Network Information API is partial (no Firefox/Safari), so this
// only ever downgrades behavior where the signal is available and stays a no-op elsewhere.
export function useIsWeakConnection() {
  const [weak, setWeak] = useState(() => isWeak(getConnection()))

  useEffect(() => {
    const connection = getConnection()
    if (!connection?.addEventListener) return

    const update = () => setWeak(isWeak(connection))
    connection.addEventListener('change', update)
    return () => connection.removeEventListener?.('change', update)
  }, [])

  return weak
}
