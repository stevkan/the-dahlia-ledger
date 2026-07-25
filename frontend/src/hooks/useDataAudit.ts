import { useQueryClient, useQuery } from '@tanstack/react-query'
import type { RecordDriftResponse } from '../types'
import { api } from '../api/client'

export function dataAuditQueryKey() {
  return ['records', 'audit', 'drift'] as const
}

export function useDataAudit(enabled: boolean) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: dataAuditQueryKey(),
    queryFn: async () => await api<RecordDriftResponse>('/api/records/audit/drift'),
    enabled,
    staleTime: 0,
  })

  async function markReviewed(id: string) {
    // Optimistically drop the entry locally instead of refetching/re-diffing every live record
    // against the snapshot again — with hundreds of drift rows, that full round trip is what was
    // making each click feel slow. Roll back only if the write itself fails.
    const previous = queryClient.getQueryData<RecordDriftResponse>(dataAuditQueryKey())
    queryClient.setQueryData<RecordDriftResponse>(dataAuditQueryKey(), (data) =>
      data ? { ...data, drift: data.drift.filter((entry) => entry.id !== id) } : data,
    )
    try {
      await api<{ ok: true }>(`/api/records/audit/drift/${encodeURIComponent(id)}/reviewed`, { method: 'POST' })
    } catch (error) {
      if (previous) queryClient.setQueryData(dataAuditQueryKey(), previous)
      throw error
    }
  }

  return {
    drift: query.data?.drift ?? [],
    missingLive: query.data?.missingLive ?? [],
    missingSnapshot: query.data?.missingSnapshot ?? [],
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    refresh: () => void query.refetch(),
    markReviewed,
  }
}
