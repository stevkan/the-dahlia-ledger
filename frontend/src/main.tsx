import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import App from './ui/App'
import { gardensQueryKey } from './hooks/useGardens'
import { isGardenAccessDeniedError, notifyGardenAccessRevoked } from './api/gardenAccessEvents'
import './style.css'

// A background query can fail with garden_access_denied when an admin removes the current
// user from the garden they're actively viewing. Several queries scoped to that garden
// (records, reminders, colors, ...) tend to fail around the same time, so debounce the
// resulting refetch/notification to a single pass instead of one per failing query.
let gardenAccessRevokedAt = 0
function handleQueryError(error: unknown) {
  if (!isGardenAccessDeniedError(error)) return
  const now = Date.now()
  if (now - gardenAccessRevokedAt < 2000) return
  gardenAccessRevokedAt = now
  void queryClient.invalidateQueries({ queryKey: gardensQueryKey })
  notifyGardenAccessRevoked()
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleQueryError }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateSW(true)
  },
})

ReactDOM.createRoot(document.querySelector<HTMLDivElement>('#app')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
