import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { User } from 'firebase/auth'
import type {
  CurrentUserProfile,
  Garden,
  GardenMember,
  GardenRole,
  Invite,
  KnownUser,
} from '../types'
import type { GardenOptions } from '../types'
import {
  DEFAULT_GARDEN_OPTIONS,
  GARDEN_OPTIONS_STORAGE_KEY,
  normalizeGardenOptions,
  normalizeStoredGardenOptions,
} from '../gardenOptions'
import { api } from '../api/client'

const KNOWN_USERS_REFRESH_INTERVAL_MS = 30_000

export const gardensQueryKey = ['gardens'] as const
const usersQueryKey = ['users'] as const

function gardenMembersQueryKey(gardenId?: string) {
  return ['garden-members', gardenId ?? 'default'] as const
}

function loadStoredGardenOptions(): GardenOptions | null {
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem(GARDEN_OPTIONS_STORAGE_KEY)
  if (!stored) return null
  try {
    return normalizeStoredGardenOptions(JSON.parse(stored))
  } catch {
    return null
  }
}

function gardenOptionsEqual(a: GardenOptions, b: GardenOptions) {
  return JSON.stringify(normalizeGardenOptions(a)) === JSON.stringify(normalizeGardenOptions(b))
}

export function fallbackGarden(gardens: Garden[]) {
  return (
    [...gardens].sort(
      (a, b) =>
        String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) ||
        a.id.localeCompare(b.id),
    )[0] ?? null
  )
}

export function gardenOptionLabel(garden: Garden, gardens: Garden[]) {
  const duplicateName = gardens.some(
    (candidate) => candidate.id !== garden.id && candidate.name === garden.name,
  )
  return `${garden.name}${duplicateName ? ` [${garden.id.slice(0, 6)}]` : ''}`
}

export function useGardens({
  user,
  gardenManagementOpen,
  setError,
}: {
  user: User | null
  gardenManagementOpen: boolean
  setError: (msg: string | null) => void
}) {
  const [selectedGardenId, setSelectedGardenId] = useState<string>('')
  const [gardenOptionsDraft, setGardenOptionsDraft] = useState<GardenOptions | null>(null)
  const [migratedGardenOptionIds, setMigratedGardenOptionIds] = useState<string[]>([])
  const [storedGardenOptionsForMigration] = useState(loadStoredGardenOptions)
  const queryClient = useQueryClient()

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api<{ user: CurrentUserProfile }>('/api/me')).user,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
  const gardensQuery = useQuery({
    queryKey: gardensQueryKey,
    queryFn: async () => (await api<{ gardens: Garden[] }>('/api/gardens')).gardens,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
  const usersQuery = useQuery({
    queryKey: usersQueryKey,
    queryFn: async () => (await api<{ users: KnownUser[] }>('/api/users')).users,
    enabled: Boolean(user),
    refetchInterval: gardenManagementOpen ? KNOWN_USERS_REFRESH_INTERVAL_MS : false,
    staleTime: 5 * 60_000,
  })

  const gardens = gardensQuery.data ?? []
  const knownUsers = usersQuery.data ?? []
  const globalAdmin = Boolean(user && meQuery.data?.globalAdmin)
  const selectedGarden =
    gardens.find((garden) => garden.id === selectedGardenId) ?? fallbackGarden(gardens)
  const activeGardenId = selectedGarden?.id ?? ''
  const gardenQuery = activeGardenId ? `?gardenId=${encodeURIComponent(activeGardenId)}` : ''
  const gardenOptions = gardenOptionsDraft ?? normalizeGardenOptions(selectedGarden?.gardenOptions)

  const gardenMembersQuery = useQuery({
    queryKey: gardenMembersQueryKey(activeGardenId),
    queryFn: async () =>
      activeGardenId
        ? (
            await api<{ members: GardenMember[] }>(
              `/api/gardens/${encodeURIComponent(activeGardenId)}/members`,
            )
          ).members
        : [],
    enabled: Boolean(user && activeGardenId),
    staleTime: 30_000,
  })
  const gardenMembers = gardenMembersQuery.data ?? []

  useEffect(() => {
    setGardenOptionsDraft(null)
  }, [activeGardenId])

  useEffect(() => {
    if (!gardens.length) return
    if (!selectedGardenId || !gardens.some((garden) => garden.id === selectedGardenId)) {
      setSelectedGardenId(fallbackGarden(gardens)?.id ?? '')
    }
  }, [gardens, selectedGardenId])

  useEffect(() => {
    if (
      !activeGardenId ||
      !selectedGarden ||
      selectedGarden.gardenOptions ||
      migratedGardenOptionIds.includes(activeGardenId)
    )
      return
    const stored = storedGardenOptionsForMigration
    if (!stored || gardenOptionsEqual(stored, DEFAULT_GARDEN_OPTIONS)) return
    setMigratedGardenOptionIds((ids) => [...ids, activeGardenId])
    void updateGarden(activeGardenId, { gardenOptions: stored })
  }, [activeGardenId, migratedGardenOptionIds, selectedGarden, storedGardenOptionsForMigration])

  useEffect(() => {
    window.localStorage.setItem(GARDEN_OPTIONS_STORAGE_KEY, JSON.stringify(gardenOptions))
  }, [gardenOptions])

  async function createGarden(input: { name: string; organizationName?: string }) {
    setError(null)
    try {
      const data = await api<{ garden: Garden }>('/api/gardens', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      await queryClient.invalidateQueries({ queryKey: gardensQueryKey })
      setSelectedGardenId(data.garden.id)
      return data.garden
    } catch (e: any) {
      setError(e?.message ?? String(e))
      throw e
    }
  }

  async function updateGarden(
    gardenId: string,
    input: {
      name?: string
      organizationName?: string
      locationName?: string
      address?: string
      notes?: string
      gardenOptions?: GardenOptions
    },
  ) {
    setError(null)
    try {
      const data = await api<{ garden: Garden }>(`/api/gardens/${encodeURIComponent(gardenId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      })
      queryClient.setQueryData<Garden[]>(
        gardensQueryKey,
        (current) =>
          current?.map((garden) => (garden.id === gardenId ? data.garden : garden)) ?? [
            data.garden,
          ],
      )
      await queryClient.invalidateQueries({ queryKey: gardensQueryKey })
      return data.garden
    } catch (e: any) {
      setError(e?.message ?? String(e))
      throw e
    }
  }

  async function deleteGarden(gardenId: string) {
    await api<{ ok: true }>(`/api/gardens/${encodeURIComponent(gardenId)}`, {
      method: 'DELETE',
    })
    if (selectedGardenId === gardenId) setSelectedGardenId('')
    await queryClient.invalidateQueries({ queryKey: gardensQueryKey })
  }

  async function listGardenMembers(gardenId: string) {
    return (
      await api<{ members: GardenMember[] }>(
        `/api/gardens/${encodeURIComponent(gardenId)}/members`,
      )
    ).members
  }

  async function saveGardenMember(
    gardenId: string,
    input: { userId: string; email?: string; displayName?: string; role: GardenRole },
  ) {
    await api<{ member: GardenMember }>(
      `/api/gardens/${encodeURIComponent(gardenId)}/members`,
      { method: 'POST', body: JSON.stringify(input) },
    )
  }

  async function deleteGardenMember(gardenId: string, memberId: string) {
    await api<{ ok: true }>(
      `/api/gardens/${encodeURIComponent(gardenId)}/members/${encodeURIComponent(memberId)}`,
      { method: 'DELETE' },
    )
    await queryClient.invalidateQueries({ queryKey: gardensQueryKey })
  }

  async function deleteKnownUser(userId: string) {
    await api<{ ok: true }>(`/api/users/${encodeURIComponent(userId)}`, { method: 'DELETE' })
    await queryClient.invalidateQueries({ queryKey: usersQueryKey })
  }

  async function deleteOwnAccount() {
    await api<{ ok: true }>('/api/users/me', { method: 'DELETE' })
  }

  async function listInvites(input: { gardenId?: string }) {
    const params = new URLSearchParams()
    if (input.gardenId) params.set('gardenId', input.gardenId)
    return (
      await api<{ invites: Invite[] }>(
        `/api/invites${params.size ? `?${params.toString()}` : ''}`,
      )
    ).invites
  }

  async function createInvite(input: { gardenId?: string; email?: string; role: string }) {
    return (
      await api<{ invite: Invite }>('/api/invites', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    ).invite
  }

  async function resendInvite(inviteId: string) {
    return (
      await api<{ invite: Invite }>(
        `/api/invites/${encodeURIComponent(inviteId)}/resend`,
        { method: 'POST' },
      )
    ).invite
  }

  async function deleteInvite(inviteId: string) {
    await api<{ ok: true }>(`/api/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' })
  }

  function updateGardenOptions(nextOptions: GardenOptions) {
    const normalized = normalizeGardenOptions(nextOptions)
    setGardenOptionsDraft(normalized)
    if (activeGardenId) void updateGarden(activeGardenId, { gardenOptions: normalized })
  }

  function invalidateGardenMembers() {
    return queryClient.invalidateQueries({ queryKey: gardenMembersQueryKey(activeGardenId) })
  }

  return {
    gardens,
    selectedGarden,
    activeGardenId,
    gardenQuery,
    gardenOptions,
    gardenMembers,
    knownUsers,
    globalAdmin,
    selectedGardenId,
    setSelectedGardenId,
    setGardenOptionsDraft,
    createGarden,
    updateGarden,
    deleteGarden,
    listGardenMembers,
    saveGardenMember,
    deleteGardenMember,
    deleteKnownUser,
    deleteOwnAccount,
    listInvites,
    createInvite,
    resendInvite,
    deleteInvite,
    updateGardenOptions,
    invalidateGardenMembers,
  }
}
