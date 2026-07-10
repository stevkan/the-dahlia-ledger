import { useMemo } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { User } from 'firebase/auth'
import type {
  Company,
  DahliaPhoto,
  DahliaRecord,
  DahliaRecordInput,
  DahliaRecordSummary,
} from '../types'
import { api } from '../api/client'
import {
  type InfiniteRecordsData,
  type RecordsPage,
  patchRecords,
  patchRecordSummaries,
  recordToSummary,
} from '../recordUtils'

const RECORD_SUMMARIES_PAGE_SIZE = 100

export function recordsQueryKey(gardenId?: string) {
  return ['records', gardenId ?? 'default'] as const
}

export function recordSummariesQueryKey(gardenId?: string) {
  return ['records', gardenId ?? 'default', 'summary'] as const
}

export function flowerNamesQueryKey(gardenId?: string) {
  return ['flower-names', gardenId ?? 'default'] as const
}

export function colorsQueryKey(gardenId?: string) {
  return ['colors', gardenId ?? 'default'] as const
}

function appendGardenQueryParam(gardenQuery: string, param: string) {
  return gardenQuery ? `${gardenQuery}&${param}` : `?${param}`
}

export function useRecords({
  user,
  activeGardenId,
  gardenQuery,
  analyticsOpen,
  maintenanceRemindersOpen,
  gardenOptionsOpen,
  createOpen,
  recordsRefreshIntervalMs,
  setActive,
  setCreateDraft,
  setCreateOpen,
  onRefreshCompanies,
  setError,
}: {
  user: User | null
  activeGardenId: string
  gardenQuery: string
  analyticsOpen: boolean
  maintenanceRemindersOpen: boolean
  gardenOptionsOpen: boolean
  createOpen: boolean
  recordsRefreshIntervalMs: number
  setActive: (record: DahliaRecord | null) => void
  setCreateDraft: (draft: DahliaRecordInput | null) => void
  setCreateOpen: (open: boolean) => void
  onRefreshCompanies: () => Promise<Company[]>
  setError: (msg: string | null) => void
}) {
  const queryClient = useQueryClient()

  const recordSummariesQuery = useInfiniteQuery({
    queryKey: recordSummariesQueryKey(activeGardenId),
    queryFn: async ({ pageParam }) => {
      try {
        const params = [`view=summary`, `limit=${RECORD_SUMMARIES_PAGE_SIZE}`]
        if (pageParam != null) params.push(`startAfter=${encodeURIComponent(String(pageParam))}`)
        return await api<RecordsPage<DahliaRecordSummary>>(
          `/api/records${appendGardenQueryParam(gardenQuery, params.join('&'))}`,
        )
      } catch (e: any) {
        if (e?.details?.error === 'garden_access_denied' && activeGardenId) {
          // Surface the error; caller should reset selectedGardenId
        }
        throw e
      }
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(user),
    refetchInterval: recordsRefreshIntervalMs || false,
    staleTime: 30_000,
  })

  const recordsQuery = useQuery({
    queryKey: recordsQueryKey(activeGardenId),
    queryFn: async () =>
      (await api<{ records: DahliaRecord[] }>(`/api/records${gardenQuery}`)).records,
    enabled:
      Boolean(user) &&
      (analyticsOpen || maintenanceRemindersOpen || gardenOptionsOpen || createOpen),
    staleTime: 30_000,
  })

  const flowerNamesQuery = useQuery({
    queryKey: flowerNamesQueryKey(activeGardenId),
    queryFn: async () =>
      (await api<{ flowerNames: string[] }>(`/api/flower-names${gardenQuery}`)).flowerNames,
    enabled: Boolean(user) && Boolean(activeGardenId),
    staleTime: 5 * 60_000,
  })

  const colorsQuery = useQuery({
    queryKey: colorsQueryKey(activeGardenId),
    queryFn: async () =>
      (await api<{ colors: string[] }>(`/api/colors${gardenQuery}`)).colors,
    enabled: Boolean(user) && Boolean(activeGardenId),
    staleTime: 5 * 60_000,
  })

  const records = (recordsQuery.data ?? []).filter(
    (record) => !activeGardenId || record.gardenId === activeGardenId,
  )
  const recordsById = useMemo(
    () => new Map(records.map((record) => [record.id, record])),
    [records],
  )
  const recordSummaries = (
    recordSummariesQuery.data?.pages.flatMap((page) => page.records) ?? []
  )
    .filter((record) => !activeGardenId || record.gardenId === activeGardenId)
    .map((summary) => {
      const cachedRecord = recordsById.get(summary.id)
      return cachedRecord ? recordToSummary(cachedRecord) : summary
    })
  const flowerNames = flowerNamesQuery.data ?? []
  const colors = colorsQuery.data ?? []
  const loading = recordSummariesQuery.isLoading

  function patchRecordSummaryCache(changedRecords: DahliaRecord[], deletedRecordIds: string[] = []) {
    queryClient.setQueryData<InfiniteRecordsData<DahliaRecordSummary>>(
      recordSummariesQueryKey(activeGardenId),
      (data) => patchRecordSummaries(data, changedRecords, deletedRecordIds),
    )
  }

  async function refreshRecords() {
    setError(null)
    return await queryClient.fetchQuery({
      queryKey: recordsQueryKey(activeGardenId),
      queryFn: async () =>
        (await api<{ records: DahliaRecord[] }>(`/api/records${gardenQuery}`)).records,
      staleTime: 0,
    })
  }

  async function refreshRecordSummaries() {
    const data = await queryClient.fetchInfiniteQuery({
      queryKey: recordSummariesQueryKey(activeGardenId),
      queryFn: async ({ pageParam }) => {
        const params = [`view=summary`, `limit=${RECORD_SUMMARIES_PAGE_SIZE}`]
        if (pageParam != null) params.push(`startAfter=${encodeURIComponent(String(pageParam))}`)
        return await api<RecordsPage<DahliaRecordSummary>>(
          `/api/records${appendGardenQueryParam(gardenQuery, params.join('&'))}`,
        )
      },
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (lastPage: RecordsPage<DahliaRecordSummary>) => lastPage.nextCursor,
      staleTime: 0,
    })
    return data.pages.flatMap((page) => page.records)
  }

  async function openRecordFromSummary(summary: DahliaRecordSummary) {
    setError(null)
    const cachedRecord = records.find((record) => record.id === summary.id)
    if (cachedRecord) {
      setActive(cachedRecord)
      return
    }

    const data = await api<{ record: DahliaRecord }>(
      `/api/records/${encodeURIComponent(summary.id)}${gardenQuery}`,
    )
    queryClient.setQueryData<DahliaRecord[]>(recordsQueryKey(activeGardenId), (previous) => {
      if (!previous) return previous
      return previous.some((record) => record.id === data.record.id)
        ? previous.map((record) => (record.id === data.record.id ? data.record : record))
        : [...previous, data.record]
    })
    setActive(data.record)
  }

  async function onCreate(input: DahliaRecordInput) {
    const data = await api<{ record: DahliaRecord }>(`/api/records${gardenQuery}`, {
      method: 'POST',
      body: JSON.stringify({ ...input, gardenId: activeGardenId || input.gardenId }),
    })
    queryClient.setQueryData<DahliaRecord[]>(
      recordsQueryKey(activeGardenId),
      (existing) => (existing ? [data.record, ...existing] : [data.record]),
    )
    patchRecordSummaryCache([data.record])
    setCreateDraft(null)
    setCreateOpen(false)
    await Promise.all([refreshRecordSummaries(), onRefreshCompanies()])
  }

  async function onUpdate(
    id: string,
    input: DahliaRecordInput,
    options?: { keepOpen?: boolean; skipRefresh?: boolean },
  ) {
    const data = await api<{ record: DahliaRecord }>(
      `/api/records/${encodeURIComponent(id)}${gardenQuery}`,
      {
        method: 'PUT',
        body: JSON.stringify({ ...input, gardenId: activeGardenId || input.gardenId }),
      },
    )
    queryClient.setQueryData<DahliaRecord[]>(
      recordsQueryKey(activeGardenId),
      (existing) => patchRecords(existing, [data.record]) ?? [data.record],
    )
    patchRecordSummaryCache([data.record])
    if (options?.keepOpen) setActive(data.record)
    else setActive(null)
    if (!options?.skipRefresh) {
      const [refreshedRecords] = await Promise.all([
        refreshRecords(),
        queryClient.invalidateQueries({ queryKey: recordSummariesQueryKey(activeGardenId) }),
        onRefreshCompanies(),
      ])
      if (options?.keepOpen)
        setActive(refreshedRecords.find((record) => record.id === id) ?? data.record)
    }
  }

  async function onUpdateCultivarPhoto(
    id: string,
    photo: { cultivarImageUrl: string; cultivarThumbnailUrl?: string; photo?: DahliaPhoto },
  ) {
    const data = await api<{ updatedCount: number; records: DahliaRecord[] }>(
      `/api/records/${encodeURIComponent(id)}/cultivar-photo${gardenQuery}`,
      { method: 'PUT', body: JSON.stringify(photo) },
    )
    queryClient.setQueryData<DahliaRecord[]>(
      recordsQueryKey(activeGardenId),
      (existing) => patchRecords(existing, data.records),
    )
    patchRecordSummaryCache(data.records)
    await refreshRecordSummaries()
    setActive(data.records.find((record) => record.id === id) ?? null)
  }

  async function onSetRecordPhotoDefault(id: string, photo: DahliaPhoto) {
    const data = await api<{ record: DahliaRecord }>(
      `/api/records/${encodeURIComponent(id)}/record-photo-default${gardenQuery}`,
      { method: 'PUT', body: JSON.stringify({ photo }) },
    )
    queryClient.setQueryData<DahliaRecord[]>(
      recordsQueryKey(activeGardenId),
      (existing) => patchRecords(existing, [data.record]),
    )
    patchRecordSummaryCache([data.record])
    await refreshRecordSummaries()
    setActive(data.record)
  }

  async function onSetCultivarPhotoDefault(id: string, photo: DahliaPhoto) {
    const data = await api<{ updatedCount: number; records: DahliaRecord[] }>(
      `/api/records/${encodeURIComponent(id)}/cultivar-photo-default${gardenQuery}`,
      { method: 'PUT', body: JSON.stringify({ photo }) },
    )
    queryClient.setQueryData<DahliaRecord[]>(
      recordsQueryKey(activeGardenId),
      (existing) => patchRecords(existing, data.records),
    )
    patchRecordSummaryCache(data.records)
    await refreshRecordSummaries()
    setActive(data.records.find((record) => record.id === id) ?? null)
  }

  async function onDeleteCultivarPhoto(id: string, imageUrl: string) {
    const data = await api<{ updatedCount: number; records: DahliaRecord[] }>(
      `/api/records/${encodeURIComponent(id)}/cultivar-photo${gardenQuery}`,
      { method: 'DELETE', body: JSON.stringify({ imageUrl }) },
    )
    queryClient.setQueryData<DahliaRecord[]>(
      recordsQueryKey(activeGardenId),
      (existing) => patchRecords(existing, data.records),
    )
    patchRecordSummaryCache(data.records)
    await refreshRecordSummaries()
    setActive(data.records.find((record) => record.id === id) ?? null)
  }

  async function onDelete(id: string) {
    await api<{ ok: true }>(`/api/records/${encodeURIComponent(id)}${gardenQuery}`, {
      method: 'DELETE',
    })
    queryClient.setQueryData<DahliaRecord[]>(
      recordsQueryKey(activeGardenId),
      (existing) => existing?.filter((record) => record.id !== id),
    )
    patchRecordSummaryCache([], [id])
    setActive(null)
    await Promise.all([refreshRecordSummaries(), onRefreshCompanies()])
  }

  return {
    records,
    recordSummaries,
    recordsById,
    flowerNames,
    colors,
    loading,
    recordSummariesQuery,
    refreshRecords,
    refreshRecordSummaries,
    patchRecordSummaryCache,
    openRecordFromSummary,
    onCreate,
    onUpdate,
    onDelete,
    onUpdateCultivarPhoto,
    onSetRecordPhotoDefault,
    onSetCultivarPhotoDefault,
    onDeleteCultivarPhoto,
  }
}
