import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  onAuthStateChanged,
  OAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import type { AgentCorrectionResult, AgentReviewResult, Asset, AssetInput, Company, CompanyInput, CurrentUserProfile, DahliaPhoto, DahliaRecord, DahliaRecordInput, ExcelImportResult, ExcelImportRevertResult, Garden, GardenMember, GardenRole, Invite, KnownUser, MaintenanceReminder, MaintenanceReminderInput, Order, OrderInput } from '../types'
import type { GardenOptionKey, GardenOptions } from '../types'
import { DEFAULT_GARDEN_OPTIONS, GARDEN_OPTIONS_STORAGE_KEY, normalizeGardenOptions, normalizeStoredGardenOptions } from '../gardenOptions'
import { apiHeaders, auth, authHeaders, hasFirebaseConfig, initializeAuthPersistence } from '../firebase'
import { RecordsTable } from './RecordsTable'
import { RecordModal } from './RecordModal'
import { AgentPanel, AnalyticsPanel } from './AgentPanel'
import { OrderModal } from './OrderModal'
import { AssetsModal } from './AssetsModal'
import { CompaniesModal } from './CompaniesModal'
import { GardenOptionsModal } from './GardenOptionsModal'
import { MaintenanceRemindersModal } from './MaintenanceRemindersModal'
import { GardenManagementModal } from './GardenManagementModal'

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? ''
const THEME_STORAGE_KEY = 'dahlia-tracker-theme'
const RECORDS_REFRESH_INTERVAL_STORAGE_KEY = 'dahlia-records-refresh-interval-ms'
const gardensQueryKey = ['gardens'] as const
const usersQueryKey = ['users'] as const
const KNOWN_USERS_REFRESH_INTERVAL_MS = 30_000
const DEFAULT_RECORDS_REFRESH_INTERVAL_MS = 15 * 60_000
const RECORDS_REFRESH_INTERVAL_OPTIONS = [0, 30_000, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000]
const companiesQueryKey = ['companies'] as const
const ordersQueryKey = ['orders'] as const
const assetsQueryKey = ['assets'] as const
const settingsQueryKey = ['settings'] as const

function LandscapeOnlyOverlay() {
  return (
    <div className="orientationOverlay" role="status" aria-live="polite">
      <div className="orientationCard">
        <div className="orientationIcon" aria-hidden="true">↻</div>
        <h1>Rotate your device</h1>
        <p>The Dahlia Ledger is designed for landscape viewing on mobile devices.</p>
      </div>
    </div>
  )
}

function recordsQueryKey(gardenId?: string) {
  return ['records', gardenId ?? 'default'] as const
}

function maintenanceRemindersQueryKey(gardenId?: string) {
  return ['maintenance-reminders', gardenId ?? 'default'] as const
}

function gardenMembersQueryKey(gardenId?: string) {
  return ['garden-members', gardenId ?? 'default'] as const
}

function gardenOptionLabel(garden: Garden, gardens: Garden[]) {
  const duplicateName = gardens.some((candidate) => candidate.id !== garden.id && candidate.name === garden.name)
  return `${garden.name}${duplicateName ? ` [${garden.id.slice(0, 6)}]` : ''}`
}

const microsoftProvider = new OAuthProvider('microsoft.com')

function authErrorMessage(error: unknown) {
  if (typeof error !== 'object' || error === null) return String(error)

  const firebaseError = error as { code?: string; message?: string; customData?: { email?: string } }
  const parts = [firebaseError.code, firebaseError.message].filter(Boolean)
  if (firebaseError.customData?.email) parts.push(`Email: ${firebaseError.customData.email}`)
  return parts.join(' - ') || 'Microsoft sign-in failed.'
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

function recordWithRenamedGardenOption(record: DahliaRecord, key: GardenOptionKey, previousValue: string, nextValue: string): DahliaRecordInput | null {
  const next: DahliaRecordInput = {
    ...record,
    core: { ...(record.core ?? {}) },
    growth: { ...(record.growth ?? {}) },
    care: { ...(record.care ?? {}) },
    tuber: { ...(record.tuber ?? {}) },
    health: { ...(record.health ?? {}) },
    meta: { ...(record.meta ?? {}) },
  }
  let changed = false

  if (key === 'gardenAreas') {
    if (next.meta.gardenArea === previousValue) {
      next.meta.gardenArea = nextValue
      changed = true
    }
    if (next.meta.gardenZone === previousValue) {
      next.meta.gardenZone = nextValue
      changed = true
    }
  }

  if (key === 'gardenRows') {
    if (next.meta.gardenRow === previousValue) {
      next.meta.gardenRow = nextValue
      changed = true
    }
    if (next.meta.rowOrBed === previousValue) {
      next.meta.rowOrBed = nextValue
      changed = true
    }
  }

  if (key === 'gardenPositions') {
    const previousPosition = Number(previousValue)
    const nextPosition = Number(nextValue)
    if (!Number.isFinite(previousPosition) || !Number.isFinite(nextPosition)) return null
    if (next.meta.gardenPosition === previousPosition) {
      next.meta.gardenPosition = nextPosition
      changed = true
    }
    if (next.meta.position === previousPosition) {
      next.meta.position = nextPosition
      changed = true
    }
  }

  return changed ? next : null
}

function loadRecordsRefreshInterval() {
  if (typeof window === 'undefined') return DEFAULT_RECORDS_REFRESH_INTERVAL_MS
  const stored = Number(window.localStorage.getItem(RECORDS_REFRESH_INTERVAL_STORAGE_KEY))
  return RECORDS_REFRESH_INTERVAL_OPTIONS.includes(stored) ? stored : DEFAULT_RECORDS_REFRESH_INTERVAL_MS
}

type Theme = 'dark' | 'light'

type AppSettings = {
  agentDebugReviewEnabled: boolean
}

function excelImportSummary(result: ExcelImportResult) {
  const counts = result.counts
  const followUpCount = counts.unmatchedCount + counts.ambiguousCount + counts.priorSeasonMissingCount + counts.skippedCount
  return `Updated ${counts.updatedCount} of ${counts.extractedCount} Excel location${counts.extractedCount === 1 ? '' : 's'}. ${followUpCount} need review.`
}

function canUserViewReminder(reminder: MaintenanceReminder, currentUserId?: string) {
  const visibility = reminder.visibility ?? 'garden'
  if (visibility === 'garden') return true

  return Boolean(currentUserId && reminder.assignedToUserId === currentUserId)
}

function highPriorityReminderMessage(count: number) {
  return `You have ${count} high priority reminder${count === 1 ? '' : 's'} needing attention.`
}

function fallbackGarden(gardens: Garden[]) {
  return [...gardens].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.id.localeCompare(b.id))[0] ?? null
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
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

async function uploadPhoto(file: File): Promise<{ imageUrl: string; thumbnailUrl?: string }> {
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

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light'
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  })
  const [error, setError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [selectedGardenId, setSelectedGardenId] = useState<string>('')

  const [active, setActive] = useState<DahliaRecord | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<DahliaRecordInput | null>(null)
  const [lastAgentInput] = useState('')
  const [reviewResult, setReviewResult] = useState<AgentReviewResult | null>(null)
  const [correctionResult, setCorrectionResult] = useState<AgentCorrectionResult | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [correctionBusy, setCorrectionBusy] = useState(false)
  const [oneNoteImporting, setOneNoteImporting] = useState(false)
  const [oneNoteImportProgress, setOneNoteImportProgress] = useState(0)
  const [oneNoteImportMessage, setOneNoteImportMessage] = useState<string | null>(null)
  const [excelImporting, setExcelImporting] = useState(false)
  const [excelImportProgress, setExcelImportProgress] = useState(0)
  const [excelImportResult, setExcelImportResult] = useState<ExcelImportResult | null>(null)
  const [excelReverting, setExcelReverting] = useState(false)
  const [excelRevertMessage, setExcelRevertMessage] = useState<string | null>(null)
  const [ordersOpen, setOrdersOpen] = useState(false)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [initialOrderId, setInitialOrderId] = useState<string | null>(null)
  const [companiesOpen, setCompaniesOpen] = useState(false)
  const [companiesUsageRefreshing, setCompaniesUsageRefreshing] = useState(false)
  const [gardenOptionsOpen, setGardenOptionsOpen] = useState(false)
  const [gardenManagementOpen, setGardenManagementOpen] = useState(false)
  const [gardenOptionsInitialGroup, setGardenOptionsInitialGroup] = useState<GardenOptionKey>('gardenAreas')
  const [gardenOptionsDraft, setGardenOptionsDraft] = useState<GardenOptions | null>(null)
  const [storedGardenOptionsForMigration] = useState(loadStoredGardenOptions)
  const [migratedGardenOptionIds, setMigratedGardenOptionIds] = useState<string[]>([])
  const [recordsRefreshIntervalMs, setRecordsRefreshIntervalMs] = useState(loadRecordsRefreshInterval)
  const [gardenMenuOpen, setGardenMenuOpen] = useState(false)
  const [recordsManagementOpen, setRecordsManagementOpen] = useState(false)
  const [agentHelperOpen, setAgentHelperOpen] = useState(false)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [insightsMenuOpen, setInsightsMenuOpen] = useState(false)
  const [maintenanceRemindersOpen, setMaintenanceRemindersOpen] = useState(false)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const recordsManagementRef = useRef<HTMLDivElement>(null)
  const gardenMenuRef = useRef<HTMLDivElement>(null)
  const insightsMenuRef = useRef<HTMLDivElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
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
  const selectedGarden = gardens.find((garden) => garden.id === selectedGardenId) ?? fallbackGarden(gardens)
  const activeGardenId = selectedGarden?.id ?? ''
  const gardenQuery = activeGardenId ? `?gardenId=${encodeURIComponent(activeGardenId)}` : ''
  const gardenOptions = gardenOptionsDraft ?? normalizeStoredGardenOptions(selectedGarden?.gardenOptions)

  const recordsQuery = useQuery({
    queryKey: recordsQueryKey(activeGardenId),
    queryFn: async () => {
      try {
        return (await api<{ records: DahliaRecord[] }>(`/api/records${gardenQuery}`)).records
      } catch (e: any) {
        if (e?.details?.error === 'garden_access_denied' && selectedGardenId) setSelectedGardenId('')
        throw e
      }
    },
    enabled: Boolean(user),
    refetchInterval: recordsRefreshIntervalMs || false,
    staleTime: 30_000,
  })
  const activeCompaniesQueryKey = [...companiesQueryKey, activeGardenId] as const
  const companiesQuery = useQuery({
    queryKey: activeCompaniesQueryKey,
    queryFn: async () => (await api<{ companies: Company[] }>(`/api/companies${gardenQuery}`)).companies,
    enabled: Boolean(user),
    refetchInterval: companiesOpen ? KNOWN_USERS_REFRESH_INTERVAL_MS : false,
    staleTime: 5 * 60_000,
  })
  const ordersQuery = useQuery({
    queryKey: ordersQueryKey,
    queryFn: async () => (await api<{ orders: Order[] }>('/api/orders')).orders,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
  const assetsQuery = useQuery({
    queryKey: assetsQueryKey,
    queryFn: async () => (await api<{ assets: Asset[] }>('/api/assets')).assets,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
  const settingsQuery = useQuery({
    queryKey: settingsQueryKey,
    queryFn: async () => (await api<{ settings: AppSettings }>('/api/settings')).settings,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
  const maintenanceRemindersQuery = useQuery({
    queryKey: maintenanceRemindersQueryKey(activeGardenId),
    queryFn: async () => (await api<{ reminders: MaintenanceReminder[] }>(`/api/maintenance-reminders${gardenQuery}`)).reminders,
    enabled: Boolean(user),
    refetchInterval: KNOWN_USERS_REFRESH_INTERVAL_MS,
    staleTime: 30_000,
  })
  const gardenMembersQuery = useQuery({
    queryKey: gardenMembersQueryKey(activeGardenId),
    queryFn: async () => activeGardenId ? (await api<{ members: GardenMember[] }>(`/api/gardens/${encodeURIComponent(activeGardenId)}/members`)).members : [],
    enabled: Boolean(user && activeGardenId),
    staleTime: 30_000,
  })

  const records = (recordsQuery.data ?? []).filter((record) => !activeGardenId || record.gardenId === activeGardenId)
  const companies = companiesQuery.data ?? []
  const orders = ordersQuery.data ?? []
  const assets = assetsQuery.data ?? []
  const settings = settingsQuery.data ?? { agentDebugReviewEnabled: false }
  const maintenanceReminders = maintenanceRemindersQuery.data ?? []
  const gardenMembers = gardenMembersQuery.data ?? []
  const visibleIncompleteReminders = maintenanceReminders.filter((reminder) => !reminder.completedAt && canUserViewReminder(reminder, user?.uid))
  const visibleReminderCount = visibleIncompleteReminders.length
  const highPriorityIncompleteReminderCount = visibleIncompleteReminders.filter((reminder) => reminder.priority === 'high').length
  const loading = recordsQuery.isLoading

  const tableRows = useMemo(() => records, [records])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    setGardenOptionsDraft(null)
  }, [activeGardenId])

  useEffect(() => {
    if (!activeGardenId || !selectedGarden || selectedGarden.gardenOptions || migratedGardenOptionIds.includes(activeGardenId)) return
    const stored = storedGardenOptionsForMigration
    if (!stored || gardenOptionsEqual(stored, DEFAULT_GARDEN_OPTIONS)) return

    setMigratedGardenOptionIds((ids) => [...ids, activeGardenId])
    void updateGarden(activeGardenId, { gardenOptions: stored })
  }, [activeGardenId, migratedGardenOptionIds, selectedGarden, storedGardenOptionsForMigration])

  useEffect(() => {
    window.localStorage.setItem(GARDEN_OPTIONS_STORAGE_KEY, JSON.stringify(gardenOptions))
  }, [gardenOptions])

  useEffect(() => {
    window.localStorage.setItem(RECORDS_REFRESH_INTERVAL_STORAGE_KEY, String(recordsRefreshIntervalMs))
  }, [recordsRefreshIntervalMs])

  useEffect(() => {
    if (!gardens.length) return
    if (!selectedGardenId || !gardens.some((garden) => garden.id === selectedGardenId)) {
      setSelectedGardenId(fallbackGarden(gardens)?.id ?? '')
    }
  }, [gardens, selectedGardenId])

  useEffect(() => {
    if (!user || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const token = params.get('invite')
    if (!token) return
    const inviteToken = token
    let cancelled = false
    async function acceptInvite() {
      try {
        await api<{ invite: Invite }>(`/api/invites/${encodeURIComponent(inviteToken)}/accept`, { method: 'POST' })
        if (cancelled) return
        params.delete('invite')
        const nextSearch = params.toString()
        window.history.replaceState(null, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`)
        await queryClient.invalidateQueries({ queryKey: gardensQueryKey })
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e))
      }
    }
    void acceptInvite()
    return () => { cancelled = true }
  }, [queryClient, user])

  useEffect(() => {
    if (!gardenMenuOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!gardenMenuRef.current?.contains(event.target as Node)) {
        setGardenMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [gardenMenuOpen])

  useEffect(() => {
    if (!recordsManagementOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!recordsManagementRef.current?.contains(event.target as Node)) {
        setRecordsManagementOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [recordsManagementOpen])

  useEffect(() => {
    if (!settingsMenuOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!settingsMenuRef.current?.contains(event.target as Node)) {
        setSettingsMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [settingsMenuOpen])

  useEffect(() => {
    if (!insightsMenuOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!insightsMenuRef.current?.contains(event.target as Node)) {
        setInsightsMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [insightsMenuOpen])

  async function refreshRecords() {
    setError(null)
    return await queryClient.fetchQuery({
      queryKey: recordsQueryKey(activeGardenId),
      queryFn: async () => (await api<{ records: DahliaRecord[] }>(`/api/records${gardenQuery}`)).records,
      staleTime: 0,
    })
  }

  async function refreshCompanies() {
    setCompaniesUsageRefreshing(true)
    try {
      return await queryClient.fetchQuery({
        queryKey: companiesQueryKey,
        queryFn: async () => (await api<{ companies: Company[] }>('/api/companies')).companies,
        staleTime: 0,
      })
    } finally {
      setCompaniesUsageRefreshing(false)
    }
  }

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false)
      return
    }

    let cancelled = false

    async function initializeAuth() {
      try {
        await initializeAuthPersistence()
      } catch (e: unknown) {
        if (!cancelled) setAuthError(authErrorMessage(e))
      }
    }

    void initializeAuth()
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setAuthLoading(false)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  async function setAgentDebugReviewEnabled(agentDebugReviewEnabled: boolean) {
    const previous = settings
    queryClient.setQueryData(settingsQueryKey, { ...settings, agentDebugReviewEnabled })
    setError(null)
    try {
      const data = await api<{ settings: AppSettings }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ agentDebugReviewEnabled }),
      })
      queryClient.setQueryData(settingsQueryKey, data.settings)
    } catch (e: any) {
      queryClient.setQueryData(settingsQueryKey, previous)
      setError(e?.message ?? String(e))
    }
  }

  async function loginWithMicrosoft() {
    if (!auth) {
      setAuthError('Firebase auth is not configured. Add the VITE_FIREBASE_* settings to your environment.')
      return
    }

    setAuthError(null)
    setAuthLoading(true)
    try {
      await initializeAuthPersistence()
      microsoftProvider.setCustomParameters({ prompt: 'select_account' })
      const result = await signInWithPopup(auth, microsoftProvider)
      setUser(result.user)
    } catch (e: unknown) {
      setAuthError(authErrorMessage(e))
    } finally {
      setAuthLoading(false)
    }
  }

  async function refreshOrders() {
    setCompaniesUsageRefreshing(true)
    try {
      const [companyData, orderData] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: companiesQueryKey,
          queryFn: async () => (await api<{ companies: Company[] }>('/api/companies')).companies,
          staleTime: 0,
        }),
        queryClient.fetchQuery({
          queryKey: ordersQueryKey,
          queryFn: async () => (await api<{ orders: Order[] }>('/api/orders')).orders,
          staleTime: 0,
        }),
      ])
      return { companies: companyData, orders: orderData }
    } finally {
      setCompaniesUsageRefreshing(false)
    }
  }

  async function refreshAssets() {
    setCompaniesUsageRefreshing(true)
    try {
      const [companyData, assetData] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: companiesQueryKey,
          queryFn: async () => (await api<{ companies: Company[] }>('/api/companies')).companies,
          staleTime: 0,
        }),
        queryClient.fetchQuery({
          queryKey: assetsQueryKey,
          queryFn: async () => (await api<{ assets: Asset[] }>('/api/assets')).assets,
          staleTime: 0,
        }),
      ])
      return { companies: companyData, assets: assetData }
    } finally {
      setCompaniesUsageRefreshing(false)
    }
  }

  async function refreshMaintenanceReminders() {
    return await queryClient.fetchQuery({
      queryKey: maintenanceRemindersQueryKey(activeGardenId),
      queryFn: async () => (await api<{ reminders: MaintenanceReminder[] }>(`/api/maintenance-reminders${gardenQuery}`)).reminders,
      staleTime: 0,
    })
  }

  async function onCreateMaintenanceReminder(input: MaintenanceReminderInput) {
    await api<{ reminder: MaintenanceReminder }>(`/api/maintenance-reminders${gardenQuery}`, {
      method: 'POST',
      body: JSON.stringify({ ...input, gardenId: activeGardenId || input.gardenId }),
    })
    await refreshMaintenanceReminders()
  }

  async function onUpdateMaintenanceReminder(id: string, input: MaintenanceReminderInput) {
    await api<{ reminder: MaintenanceReminder }>(`/api/maintenance-reminders/${encodeURIComponent(id)}${gardenQuery}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, gardenId: activeGardenId || input.gardenId }),
    })
    await refreshMaintenanceReminders()
  }

  async function onCompleteMaintenanceReminder(id: string) {
    await api<{ reminder: MaintenanceReminder }>(`/api/maintenance-reminders/${encodeURIComponent(id)}/complete${gardenQuery}`, { method: 'POST' })
    await refreshMaintenanceReminders()
  }

  async function onReopenMaintenanceReminder(id: string) {
    await api<{ reminder: MaintenanceReminder }>(`/api/maintenance-reminders/${encodeURIComponent(id)}/reopen${gardenQuery}`, { method: 'POST' })
    await refreshMaintenanceReminders()
  }

  async function onDeleteMaintenanceReminder(id: string) {
    await api<{ ok: true }>(`/api/maintenance-reminders/${encodeURIComponent(id)}${gardenQuery}`, { method: 'DELETE' })
    await refreshMaintenanceReminders()
  }

  async function onCreate(input: DahliaRecordInput) {
    await api<{ record: DahliaRecord }>(`/api/records${gardenQuery}`, {
      method: 'POST',
      body: JSON.stringify({ ...input, gardenId: activeGardenId || input.gardenId }),
    })
    setCreateDraft(null)
    setCreateOpen(false)
    await Promise.all([refreshRecords(), refreshCompanies()])
  }

  async function onUpdate(id: string, input: DahliaRecordInput, options?: { keepOpen?: boolean; skipRefresh?: boolean }) {
    const data = await api<{ record: DahliaRecord }>(`/api/records/${encodeURIComponent(id)}${gardenQuery}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, gardenId: activeGardenId || input.gardenId }),
    })
    if (options?.keepOpen) setActive(data.record)
    else setActive(null)
    if (!options?.skipRefresh) {
      const [refreshedRecords] = await Promise.all([refreshRecords(), refreshCompanies()])
      if (options?.keepOpen) setActive(refreshedRecords.find((record) => record.id === id) ?? data.record)
    }
  }

  async function onUpdateCultivarPhoto(id: string, photo: { cultivarImageUrl: string; cultivarThumbnailUrl?: string; photo?: DahliaPhoto }) {
    const data = await api<{ updatedCount: number; records: DahliaRecord[] }>(`/api/records/${encodeURIComponent(id)}/cultivar-photo${gardenQuery}`, {
      method: 'PUT',
      body: JSON.stringify(photo),
    })
    queryClient.setQueryData(recordsQueryKey(activeGardenId), data.records)
    setActive(data.records.find((record) => record.id === id) ?? null)
  }

  async function onSetRecordPhotoDefault(id: string, photo: DahliaPhoto) {
    const data = await api<{ record: DahliaRecord; records: DahliaRecord[] }>(`/api/records/${encodeURIComponent(id)}/record-photo-default${gardenQuery}`, {
      method: 'PUT',
      body: JSON.stringify({ photo }),
    })
    queryClient.setQueryData(recordsQueryKey(activeGardenId), data.records)
    setActive(data.record)
  }

  async function onSetCultivarPhotoDefault(id: string, photo: DahliaPhoto) {
    const data = await api<{ updatedCount: number; records: DahliaRecord[] }>(`/api/records/${encodeURIComponent(id)}/cultivar-photo-default${gardenQuery}`, {
      method: 'PUT',
      body: JSON.stringify({ photo }),
    })
    queryClient.setQueryData(recordsQueryKey(activeGardenId), data.records)
    setActive(data.records.find((record) => record.id === id) ?? null)
  }

  async function onDeleteCultivarPhoto(id: string, imageUrl: string) {
    const data = await api<{ updatedCount: number; records: DahliaRecord[] }>(`/api/records/${encodeURIComponent(id)}/cultivar-photo${gardenQuery}`, {
      method: 'DELETE',
      body: JSON.stringify({ imageUrl }),
    })
    queryClient.setQueryData(recordsQueryKey(activeGardenId), data.records)
    setActive(data.records.find((record) => record.id === id) ?? null)
  }

  async function onDelete(id: string) {
    await api<{ ok: true }>(`/api/records/${encodeURIComponent(id)}${gardenQuery}`, {
      method: 'DELETE',
    })
    setActive(null)
    await Promise.all([refreshRecords(), refreshCompanies()])
  }

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

  async function updateGarden(gardenId: string, input: { name?: string; organizationName?: string; locationName?: string; address?: string; notes?: string; gardenOptions?: GardenOptions }) {
    setError(null)
    try {
      const data = await api<{ garden: Garden }>(`/api/gardens/${encodeURIComponent(gardenId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      })
      await queryClient.invalidateQueries({ queryKey: gardensQueryKey })
      return data.garden
    } catch (e: any) {
      setError(e?.message ?? String(e))
      throw e
    }
  }

  async function deleteGarden(gardenId: string) {
    setError(null)
    try {
      await api<{ ok: true }>(`/api/gardens/${encodeURIComponent(gardenId)}`, { method: 'DELETE' })
      if (selectedGardenId === gardenId) setSelectedGardenId('')
      await queryClient.invalidateQueries({ queryKey: gardensQueryKey })
    } catch (e: any) {
      setError(e?.message ?? String(e))
      throw e
    }
  }

  async function listGardenMembers(gardenId: string) {
    return (await api<{ members: GardenMember[] }>(`/api/gardens/${encodeURIComponent(gardenId)}/members`)).members
  }

  async function saveGardenMember(gardenId: string, input: { userId: string; email?: string; displayName?: string; role: GardenRole }) {
    await api<{ member: GardenMember }>(`/api/gardens/${encodeURIComponent(gardenId)}/members`, { method: 'POST', body: JSON.stringify(input) })
  }

  async function deleteGardenMember(gardenId: string, memberId: string) {
    await api<{ ok: true }>(`/api/gardens/${encodeURIComponent(gardenId)}/members/${encodeURIComponent(memberId)}`, { method: 'DELETE' })
  }

  async function deleteKnownUser(userId: string) {
    await api<{ ok: true }>(`/api/users/${encodeURIComponent(userId)}`, { method: 'DELETE' })
    await queryClient.invalidateQueries({ queryKey: usersQueryKey })
  }

  async function listInvites(input: { gardenId?: string }) {
    const params = new URLSearchParams()
    if (input.gardenId) params.set('gardenId', input.gardenId)
    return (await api<{ invites: Invite[] }>(`/api/invites${params.size ? `?${params.toString()}` : ''}`)).invites
  }

  async function createInvite(input: { gardenId?: string; email?: string; role: string }) {
    return (await api<{ invite: Invite }>('/api/invites', { method: 'POST', body: JSON.stringify(input) })).invite
  }

  async function resendInvite(inviteId: string) {
    return (await api<{ invite: Invite }>(`/api/invites/${encodeURIComponent(inviteId)}/resend`, { method: 'POST' })).invite
  }

  async function deleteInvite(inviteId: string) {
    await api<{ ok: true }>(`/api/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' })
  }

  async function reviewWithDebugAgent(record: DahliaRecordInput, recordId?: string) {
    const originalText = lastAgentInput.trim() || record.meta?.agentOriginalInput?.trim()
    if (!originalText && !recordId) {
      setReviewResult({
        status: 'issues_found',
        summary: 'Debug review needs the original Agent Input text. Send a record through Agent Input first, then review it.',
        findings: [],
        promptSuggestion: '',
      })
      return
    }

    setReviewBusy(true)
    setReviewResult(null)
    setCorrectionResult(null)
    try {
      const data = await api<{ review: AgentReviewResult }>('/api/agent/review', {
        method: 'POST',
        body: JSON.stringify(recordId ? { originalText, recordId } : { originalText, record }),
      })
      setReviewResult(data.review)
    } catch (e: any) {
      setReviewResult({
        status: 'issues_found',
        summary: e?.message ?? String(e),
        findings: [],
        promptSuggestion: '',
      })
    } finally {
      setReviewBusy(false)
    }
  }

  async function proposeMissedIssueCorrection(record: DahliaRecordInput, userCorrection: string, recordId?: string) {
    const originalText = lastAgentInput.trim() || record.meta?.agentOriginalInput?.trim()
    if (!originalText && !recordId) {
      setCorrectionResult({
        recordPatch: {},
        summary: 'Correction needs the original Agent Input text. Send a record through Agent Input first, then propose a fix.',
        promptSuggestion: '',
      })
      return
    }

    setCorrectionBusy(true)
    setCorrectionResult(null)
    try {
      const data = await api<{ correction: AgentCorrectionResult }>('/api/agent/correction', {
        method: 'POST',
        body: JSON.stringify(recordId ? { originalText, recordId, review: reviewResult, userCorrection } : { originalText, record, review: reviewResult, userCorrection }),
      })
      setCorrectionResult(data.correction)
    } catch (e: any) {
      setCorrectionResult({
        recordPatch: {},
        summary: e?.message ?? String(e),
        promptSuggestion: '',
      })
    } finally {
      setCorrectionBusy(false)
    }
  }

  async function applyCorrectionToStoredRecord(record: DahliaRecordInput, id: string) {
    await onUpdate(id, record)
    setCorrectionResult(null)
  }

  async function applyCorrectionToDraft(record: DahliaRecordInput) {
    setCreateDraft(record)
    setCorrectionResult(null)
  }

  function duplicateRecord(record: DahliaRecord) {
    const plantingState = record.meta?.plantingState ?? 'purchased_container'
    const draft: DahliaRecordInput = {
      flowerName: record.flowerName,
      gardenLocation: '',
      seasonYearStart: record.seasonYearStart,
      thumbnailUrl: record.thumbnailUrl ?? '',
      imageUrl: record.imageUrl ?? '',
      cultivarThumbnailUrl: record.cultivarThumbnailUrl ?? '',
      cultivarImageUrl: record.cultivarImageUrl ?? '',
      core: { ...(record.core ?? {}) },
      growth: { ...(record.growth ?? {}) },
      care: { ...(record.care ?? {}) },
      tuber: { ...(record.tuber ?? {}) },
      health: {},
      meta: {
        plantingState,
        gardenArea: plantingState === 'in_garden' ? 'Main Garden' : undefined,
        gardenZone: plantingState === 'in_garden' ? 'Main Garden' : undefined,
      },
    }

    setActive(null)
    setCreateDraft(draft)
    setCreateOpen(true)
  }

  async function onCreateCompany(input: CompanyInput) {
    const data = await api<{ company: Company }>(`/api/companies${gardenQuery}`, {
      method: 'POST',
      body: JSON.stringify({ ...input, gardenId: activeGardenId || input.gardenId }),
    })
    await refreshOrders()
    return data.company
  }

  async function onUpdateCompany(id: string, input: CompanyInput) {
    const data = await api<{ company: Company }>(`/api/companies/${encodeURIComponent(id)}${gardenQuery}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, gardenId: activeGardenId || input.gardenId }),
    })
    queryClient.setQueryData<Company[]>(activeCompaniesQueryKey, (current) => current?.map((company) => company.id === id ? data.company : company) ?? [data.company])
    const [refreshedCompanies] = await Promise.all([refreshCompanies(), refreshRecords(), queryClient.fetchQuery({
      queryKey: ordersQueryKey,
      queryFn: async () => (await api<{ orders: Order[] }>('/api/orders')).orders,
      staleTime: 0,
    })])
    return refreshedCompanies.find((company) => company.id === id) ?? data.company
  }

  async function onDeleteCompany(id: string) {
    await api<{ ok: true }>(`/api/companies/${encodeURIComponent(id)}${gardenQuery}`, {
      method: 'DELETE',
    })
    await refreshOrders()
  }

  async function onReassignCompanies(companyIds: string[], ownerUserId: string) {
    await api<{ companies: Company[]; updatedCount: number }>('/api/admin/companies/reassign', {
      method: 'POST',
      body: JSON.stringify({ companyIds, ownerUserId }),
    })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: companiesQueryKey }),
      queryClient.invalidateQueries({ queryKey: ordersQueryKey }),
      queryClient.invalidateQueries({ queryKey: usersQueryKey }),
    ])
  }

  function openGardenOptions(group: GardenOptionKey) {
    setGardenOptionsInitialGroup(group)
    setGardenOptionsOpen(true)
  }

  function updateGardenOptions(nextOptions: GardenOptions) {
    const normalized = normalizeGardenOptions(nextOptions)
    setGardenOptionsDraft(normalized)
    if (activeGardenId) void updateGarden(activeGardenId, { gardenOptions: normalized })
  }

  async function renameGardenOptionReferences(key: GardenOptionKey, previousValue: string, nextValue: string) {
    const updates = records
      .map((record) => ({ record, input: recordWithRenamedGardenOption(record, key, previousValue, nextValue) }))
      .filter((update): update is { record: DahliaRecord; input: DahliaRecordInput } => update.input !== null)

    if (!updates.length) return

    await Promise.all(updates.map(({ record, input }) => onUpdate(record.id, input, { keepOpen: active?.id === record.id, skipRefresh: true })))
    await refreshRecords()
  }

  async function onCreateOrder(input: OrderInput) {
    const data = await api<{ order: Order }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    await refreshOrders()
    return data.order
  }

  async function onCreateAsset(input: AssetInput) {
    const data = await api<{ asset: Asset }>('/api/assets', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    await refreshAssets()
    return data.asset
  }

  async function onUpdateAsset(id: string, input: AssetInput) {
    const data = await api<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
    await refreshAssets()
    return data.asset
  }

  async function onDeleteAsset(id: string) {
    await api<{ ok: true }>(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    await refreshAssets()
  }

  async function onUpdateOrder(id: string, input: OrderInput) {
    const data = await api<{ order: Order }>(`/api/orders/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
    await refreshOrders()
    return data.order
  }

  async function onDeleteOrder(id: string) {
    await api<{ ok: true }>(`/api/orders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    await refreshOrders()
  }

  async function uploadInvoice(orderId: string, file: File, sourceType: 'uploaded_pdf' | 'image_converted_to_pdf') {
    const body = new FormData()
    body.append('file', file)
    body.append('sourceType', sourceType)

    const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(orderId)}/files`, {
      method: 'POST',
      headers: await authHeaders(),
      body,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Upload failed: ${res.status}`)
    }
    await refreshOrders()
  }

  async function uploadAssetInvoice(assetId: string, file: File, sourceType: 'uploaded_pdf' | 'image_converted_to_pdf') {
    const body = new FormData()
    body.append('file', file)
    body.append('sourceType', sourceType)

    const res = await fetch(`${API_BASE}/api/assets/${encodeURIComponent(assetId)}/files`, {
      method: 'POST',
      headers: await authHeaders(),
      body,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Upload failed: ${res.status}`)
    }
    await refreshAssets()
  }

  async function importOneNoteFile(file: File | undefined) {
    if (!file) return

    const body = new FormData()
    body.append('file', file)

    setOneNoteImporting(true)
    setOneNoteImportProgress(0)
    setOneNoteImportMessage(null)
    setError(null)
    try {
      const data = await new Promise<{ importedCount: number; skippedCount?: number; createdCompanyCount?: number }>(async (resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open('POST', `${API_BASE}/api/import/onenote`)
        for (const [key, value] of Object.entries(await authHeaders())) request.setRequestHeader(key, value)
        request.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          setOneNoteImportProgress(Math.min(95, Math.round((event.loaded / event.total) * 95)))
        }
        request.onload = () => {
          if (request.status < 200 || request.status >= 300) {
            reject(new Error(request.responseText || `Import failed: ${request.status}`))
            return
          }

          try {
            setOneNoteImportProgress(100)
            resolve(JSON.parse(request.responseText))
          } catch {
            reject(new Error('Import response could not be parsed.'))
          }
        }
        request.onerror = () => reject(new Error('Import failed due to a network error.'))
        request.send(body)
      })
      const skipped = data.skippedCount ? ` Skipped ${data.skippedCount} existing record${data.skippedCount === 1 ? '' : 's'}.` : ''
      const companies = data.createdCompanyCount ? ` Added ${data.createdCompanyCount} compan${data.createdCompanyCount === 1 ? 'y' : 'ies'}.` : ''
      setOneNoteImportMessage(`Imported ${data.importedCount} OneNote record${data.importedCount === 1 ? '' : 's'}.${skipped}${companies}`)
      await refreshRecords()
      await refreshOrders()
    } catch (e: any) {
      setOneNoteImportMessage(null)
      setError(e?.message ?? String(e))
    } finally {
      setOneNoteImporting(false)
      window.setTimeout(() => setOneNoteImportProgress(0), 350)
    }
  }

  async function importExcelFile(file: File | undefined) {
    if (!file) return

    const body = new FormData()
    body.append('file', file)

    setExcelImporting(true)
    setExcelImportProgress(0)
    setExcelImportResult(null)
    setExcelRevertMessage(null)
    setError(null)
    try {
      const data = await new Promise<ExcelImportResult>(async (resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open('POST', `${API_BASE}/api/import/excel`)
        for (const [key, value] of Object.entries(await authHeaders())) request.setRequestHeader(key, value)
        request.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          setExcelImportProgress(Math.min(95, Math.round((event.loaded / event.total) * 95)))
        }
        request.onload = () => {
          if (request.status < 200 || request.status >= 300) {
            reject(new Error(request.responseText || `Import failed: ${request.status}`))
            return
          }

          try {
            setExcelImportProgress(100)
            resolve(JSON.parse(request.responseText))
          } catch {
            reject(new Error('Import response could not be parsed.'))
          }
        }
        request.onerror = () => reject(new Error('Import failed due to a network error.'))
        request.send(body)
      })
      setExcelImportResult(data)
      await refreshRecords()
    } catch (e: any) {
      setExcelImportResult(null)
      setError(e?.message ?? String(e))
    } finally {
      setExcelImporting(false)
      window.setTimeout(() => setExcelImportProgress(0), 350)
    }
  }

  async function revertLatestExcelImport() {
    setExcelReverting(true)
    setExcelRevertMessage(null)
    setError(null)
    try {
      const data = await api<ExcelImportRevertResult>('/api/import/excel/revert-latest', { method: 'POST' })
      const skipped = data.skipped.length ? ` ${data.skipped.length} record${data.skipped.length === 1 ? '' : 's'} could not be reverted.` : ''
      setExcelRevertMessage(`Reverted ${data.revertedCount} Excel import update${data.revertedCount === 1 ? '' : 's'}.${skipped}`)
      setExcelImportResult((current) => (current ? { ...current, canRevert: false } : current))
      await refreshRecords()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setExcelReverting(false)
    }
  }

  async function deleteInvoiceFile(orderId: string, fileId: string) {
    await api<{ ok: true }>(`/api/orders/${encodeURIComponent(orderId)}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    })
    await refreshOrders()
  }

  async function deleteAssetInvoiceFile(assetId: string, fileId: string) {
    await api<{ ok: true }>(`/api/assets/${encodeURIComponent(assetId)}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    })
    await refreshAssets()
  }

  if (authLoading) {
    return (
      <>
        <LandscapeOnlyOverlay />
        <div className="landingShell">
          <div className="landingCard">
            <div className="landingEyebrow">The Dahlia Ledger</div>
            <h1>Checking your session</h1>
            <p>Preparing your records workspace.</p>
          </div>
        </div>
      </>
    )
  }

  if (!user) {
    return (
      <>
        <LandscapeOnlyOverlay />
        <div className="landingShell">
          <div className="landingCard">
            <div className="landingEyebrow">The Dahlia Ledger</div>
            <h1>Track your dahlias from one secure workspace.</h1>
            <p>Sign in with your Outlook or Hotmail Microsoft account to continue to records, images, seasons, and notes.</p>
            {authError ? <div className="landingError">{authError}</div> : null}
            <button className="microsoftButton" type="button" onClick={loginWithMicrosoft}>
              <span className="microsoftMark" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
              Continue with Microsoft
            </button>
            {!hasFirebaseConfig ? (
              <div className="landingHint">Firebase auth environment variables are required before sign-in will work.</div>
            ) : null}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <LandscapeOnlyOverlay />
      <div className="appShell">
      <header className="topBar">
        <div className="brand">
          <div className="brandTitle">The Dahlia Ledger</div>
          <div className="brandSub">Records, images, seasons, and notes</div>
        </div>
        {highPriorityIncompleteReminderCount ? <div className="topPriorityMessage" role="status">{highPriorityReminderMessage(highPriorityIncompleteReminderCount)}</div> : null}
        <div className="topActions">
          <div className="actionAccordion" ref={gardenMenuRef}>
            <button
              className="btn ghost accordionToggle gardenToggle"
              type="button"
              aria-expanded={gardenMenuOpen}
              aria-controls="garden-actions"
              disabled={!gardens.length}
              onClick={() => {
                setGardenMenuOpen((open) => !open)
                setRecordsManagementOpen(false)
                setInsightsMenuOpen(false)
                setSettingsMenuOpen(false)
              }}
            >
              <span>Garden:</span>
              <span className="gardenToggleName">{selectedGarden ? gardenOptionLabel(selectedGarden, gardens) : 'None'}</span>
              <span className="accordionIcon" aria-hidden="true">
                {gardenMenuOpen ? '−' : '+'}
              </span>
            </button>
            {gardenMenuOpen ? (
              <div className="accordionPanel" id="garden-actions">
                {gardens.map((garden) => (
                  <button
                    className="btn ghost"
                    type="button"
                    key={garden.id}
                    onClick={() => {
                      setSelectedGardenId(garden.id)
                      setGardenMenuOpen(false)
                    }}
                  >
                    {gardenOptionLabel(garden, gardens)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="actionAccordion" ref={recordsManagementRef}>
            <button
              className="btn ghost accordionToggle"
              aria-expanded={recordsManagementOpen}
              aria-controls="records-management-actions"
              onClick={() => setRecordsManagementOpen((open) => !open)}
            >
              <span>Manage</span>
              <span className="accordionIcon" aria-hidden="true">
                {recordsManagementOpen ? '−' : '+'}
              </span>
            </button>
            {recordsManagementOpen ? (
              <div className="accordionPanel" id="records-management-actions">
                <button
                  className="btn ghost"
                  onClick={() => {
                    setGardenManagementOpen(true)
                    setRecordsManagementOpen(false)
                  }}
                >
                  Gardens & Access
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setAssetsOpen(true)
                    setRecordsManagementOpen(false)
                  }}
                >
                  Assets
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setCompaniesOpen(true)
                    setRecordsManagementOpen(false)
                  }}
                >
                  Companies
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setInitialOrderId(null)
                    setOrdersOpen(true)
                    setRecordsManagementOpen(false)
                  }}
                >
                  Invoices
                </button>
              </div>
            ) : null}
          </div>
          <div className="actionAccordion" ref={insightsMenuRef}>
            <button
              className="btn ghost accordionToggle"
              type="button"
              aria-expanded={insightsMenuOpen}
              aria-controls="insights-actions"
              onClick={() => {
                setInsightsMenuOpen((open) => !open)
                setRecordsManagementOpen(false)
                setSettingsMenuOpen(false)
              }}
            >
              <span>Insights</span>
              <span className="accordionIcon" aria-hidden="true">
                {insightsMenuOpen ? '−' : '+'}
              </span>
            </button>
            {insightsMenuOpen ? (
              <div className="accordionPanel" id="insights-actions">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    setAgentHelperOpen(true)
                    setInsightsMenuOpen(false)
                  }}
                >
                  Agent Helper
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    setAnalyticsOpen(true)
                    setInsightsMenuOpen(false)
                  }}
                >
                  Analytics
                </button>
              </div>
            ) : null}
          </div>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setMaintenanceRemindersOpen(true)
              setRecordsManagementOpen(false)
              setInsightsMenuOpen(false)
              setSettingsMenuOpen(false)
            }}
          >
            Reminders{visibleReminderCount ? ` (${visibleReminderCount})` : ''}
          </button>
          <div className="actionAccordion" ref={settingsMenuRef}>
            <button
              className="btn ghost gearButton"
              type="button"
              aria-expanded={settingsMenuOpen}
              aria-controls="settings-actions"
              aria-label="Open settings menu"
              onClick={() => setSettingsMenuOpen((open) => !open)}
            >
              ⚙
            </button>
            {settingsMenuOpen ? (
              <div className="accordionPanel settingsPanel" id="settings-actions">
                <div className="appearanceSetting" role="group" aria-label="Appearance setting">
                  <span>Appearance</span>
                  <button
                    className={`switchToggle ${theme === 'light' ? 'on' : ''}`}
                    type="button"
                    role="switch"
                    aria-checked={theme === 'light'}
                    aria-label="Use light theme"
                    onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
                  >
                    <span className="switchTrack">
                      <span className="switchLabel">{theme === 'light' ? 'Light' : 'Dark'}</span>
                      <span className="switchThumb" />
                    </span>
                  </button>
                </div>
                <div className="appearanceSetting" role="group" aria-label="Agent debug review setting">
                  <span>Agent Debug</span>
                  <button
                    className={`switchToggle ${settings.agentDebugReviewEnabled ? 'on' : ''}`}
                    type="button"
                    role="switch"
                    aria-checked={settings.agentDebugReviewEnabled}
                    aria-label="Enable agent debug review"
                    onClick={() => void setAgentDebugReviewEnabled(!settings.agentDebugReviewEnabled)}
                  >
                    <span className="switchTrack">
                      <span className="switchLabel">{settings.agentDebugReviewEnabled ? 'On' : 'Off'}</span>
                      <span className="switchThumb" />
                    </span>
                  </button>
                </div>
                {globalAdmin ? <div className="oneNoteImportSetting">
                  <div>
                    <div className="settingTitle">OneNote Import</div>
                    <div className="settingHint">Upload a Single File Web Page (.mht) export.</div>
                  </div>
                  <label
                    className={`btn ghost compact importFileButton ${oneNoteImporting ? 'disabled importing' : ''}`}
                    style={{ '--import-progress': `${oneNoteImportProgress}%` } as CSSProperties}
                    aria-disabled={oneNoteImporting}
                  >
                    <span>{oneNoteImporting ? `Importing ${oneNoteImportProgress}%` : 'Import data from OneNote'}</span>
                    <input
                      type="file"
                      accept=".mht,.mhtml"
                      disabled={oneNoteImporting}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0]
                        event.currentTarget.value = ''
                        void importOneNoteFile(file)
                      }}
                    />
                  </label>
                  {oneNoteImportMessage ? <div className="settingHint success">{oneNoteImportMessage}</div> : null}
                </div> : null}
                {globalAdmin ? <div className="oneNoteImportSetting">
                  <div>
                    <div className="settingTitle">Excel Import</div>
                    <div className="settingHint">Upload the 2026 garden location spreadsheet.</div>
                  </div>
                  <label
                    className={`btn ghost compact importFileButton ${excelImporting ? 'disabled importing' : ''}`}
                    style={{ '--import-progress': `${excelImportProgress}%` } as CSSProperties}
                    aria-disabled={excelImporting}
                  >
                    <span>{excelImporting ? `Importing ${excelImportProgress}%` : 'Import data from Excel'}</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      disabled={excelImporting}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0]
                        event.currentTarget.value = ''
                        void importExcelFile(file)
                      }}
                    />
                  </label>
                  {excelImportResult ? (
                    <div className="excelImportSummary">
                      <div className="settingHint success">{excelImportSummary(excelImportResult)}</div>
                      {excelImportResult.canRevert ? (
                        <button className="btn ghost compact" type="button" disabled={excelReverting} onClick={() => void revertLatestExcelImport()}>
                          {excelReverting ? 'Reverting Excel import...' : 'Revert latest Excel import'}
                        </button>
                      ) : null}
                      {excelImportResult.priorSeasonMissing.length ? (
                        <div className="settingHint">Prior seasons only: {excelImportResult.priorSeasonMissing.slice(0, 5).map((entry) => `${entry.excelName} (${entry.gardenLocation})`).join(', ')}</div>
                      ) : null}
                      {excelImportResult.ambiguous.length ? (
                        <div className="settingHint">Ambiguous: {excelImportResult.ambiguous.slice(0, 5).map((entry) => `${entry.excelName} (${entry.gardenLocation})`).join(', ')}</div>
                      ) : null}
                      {excelImportResult.unmatched.length ? (
                        <div className="settingHint">Unmatched: {excelImportResult.unmatched.slice(0, 5).map((entry) => `${entry.excelName} (${entry.gardenLocation})`).join(', ')}</div>
                      ) : null}
                      {excelImportResult.skipped.length ? (
                        <div className="settingHint">Skipped: {excelImportResult.skipped.slice(0, 5).map((entry) => `${entry.excelName} (${entry.gardenLocation})`).join(', ')}</div>
                      ) : null}
                    </div>
                  ) : null}
                  {excelRevertMessage ? <div className="settingHint success">{excelRevertMessage}</div> : null}
                </div> : null}
                <div className="settingsSignOut">
                  <div className="signedInAs">Signed in as {user.email ?? user.displayName}</div>
                  <button
                    className="btn ghost compact"
                    type="button"
                    onClick={() => {
                      setSettingsMenuOpen(false)
                      if (auth) void signOut(auth)
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mainGrid">
        <section className="panel recordsPanel">
          <div className="panelTitle panelTitleRow">
            <span>Records</span>
            <button className="btn compact" onClick={() => {
              setReviewResult(null)
              setCorrectionResult(null)
              setCreateOpen(true)
            }}>
              New Record
            </button>
          </div>
          {error ? <div className="error">{error}</div> : null}
          {recordsQuery.error ? <div className="error">{recordsQuery.error instanceof Error ? recordsQuery.error.message : String(recordsQuery.error)}</div> : null}
          <RecordsTable rows={tableRows} orders={orders} loading={loading} refreshIntervalMs={recordsRefreshIntervalMs} refreshIntervalOptions={RECORDS_REFRESH_INTERVAL_OPTIONS} onRefreshIntervalChange={setRecordsRefreshIntervalMs} onOpen={(r) => {
            setReviewResult(null)
            setCorrectionResult(null)
            setActive(records.find((record) => record.id === r.id) ?? r)
          }} />
        </section>

      </main>

      {agentHelperOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="agent-helper-title" onMouseDown={() => setAgentHelperOpen(false)}>
          <div className="modal metricsQueryModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <div className="modalTitle" id="agent-helper-title">Agent Helper</div>
                <div className="modalSub">Ask for record review, dahlia coaching, maintenance prompts, and summaries.</div>
              </div>
              <button className="btn ghost compact" type="button" onClick={() => setAgentHelperOpen(false)}>
                Close
              </button>
            </div>
            <div className="modalBody">
              <AgentPanel onReview={setReviewResult} onCreateReminder={onCreateMaintenanceReminder} />
            </div>
          </div>
        </div>
      ) : null}

      {analyticsOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="analytics-title" onMouseDown={() => setAnalyticsOpen(false)}>
          <div className="modal metricsQueryModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <div className="modalTitle" id="analytics-title">Analytics</div>
                <div className="modalSub">Generate supported charts and graphs from saved records.</div>
              </div>
              <button className="btn ghost compact" type="button" onClick={() => setAnalyticsOpen(false)}>
                Close
              </button>
            </div>
            <div className="modalBody">
              <AnalyticsPanel
                records={records}
                companies={companies}
                onOpenRecord={(record) => setActive(records.find((candidate) => candidate.id === record.id) ?? record)}
                onOpenOrder={(orderId) => {
                  setInitialOrderId(orderId)
                  setOrdersOpen(true)
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {maintenanceRemindersOpen ? (
        <MaintenanceRemindersModal
          reminders={maintenanceReminders}
          records={records}
          members={gardenMembers}
          currentUserId={user?.uid}
          onClose={() => setMaintenanceRemindersOpen(false)}
          onCreate={onCreateMaintenanceReminder}
          onUpdate={onUpdateMaintenanceReminder}
          onComplete={onCompleteMaintenanceReminder}
          onReopen={onReopenMaintenanceReminder}
          onDelete={onDeleteMaintenanceReminder}
        />
      ) : null}

      {gardenManagementOpen ? (
        <GardenManagementModal
          gardens={gardens}
          knownUsers={knownUsers}
          isGlobalAdmin={globalAdmin}
          globalAdminUserId={user?.uid}
          currentGardenId={activeGardenId}
          onClose={() => {
            setGardenManagementOpen(false)
            void queryClient.invalidateQueries({ queryKey: gardenMembersQueryKey(activeGardenId) })
          }}
          onCreateGarden={createGarden}
          onUpdateGarden={updateGarden}
          onDeleteGarden={deleteGarden}
          onListGardenMembers={listGardenMembers}
          onSaveGardenMember={saveGardenMember}
          onDeleteGardenMember={deleteGardenMember}
          onDeleteKnownUser={deleteKnownUser}
          onListInvites={listInvites}
          onCreateInvite={createInvite}
          onResendInvite={resendInvite}
          onDeleteInvite={deleteInvite}
          onOpenPlacementOptions={() => openGardenOptions('gardenAreas')}
        />
      ) : null}

      {createOpen ? (
        <RecordModal
          mode="create"
          initial={null}
          draft={createDraft}
          records={records}
          onClose={() => {
            setCreateDraft(null)
            setReviewResult(null)
            setCorrectionResult(null)
            setCreateOpen(false)
          }}
          onSave={(input) => onCreate(input)}
          onReview={(record) => reviewWithDebugAgent(record)}
          onProposeCorrection={(record, userCorrection) => proposeMissedIssueCorrection(record, userCorrection)}
          onApplyCorrection={applyCorrectionToDraft}
          reviewResult={reviewResult}
          correctionResult={correctionResult}
          reviewBusy={reviewBusy}
          correctionBusy={correctionBusy}
          onUploadPhoto={uploadPhoto}
          onCreateCompany={onCreateCompany}
          onOpenCompanies={() => setCompaniesOpen(true)}
          onOpenGardenOptions={openGardenOptions}
          gardenOptions={gardenOptions}
          companies={companies}
          orders={orders}
        />
      ) : null}

      {companiesOpen ? (
        <CompaniesModal
          companies={companies}
          knownUsers={knownUsers}
          isGlobalAdmin={globalAdmin}
          usageRefreshing={companiesUsageRefreshing}
          onClose={() => setCompaniesOpen(false)}
          onCreateCompany={onCreateCompany}
          onUpdateCompany={onUpdateCompany}
          onDeleteCompany={onDeleteCompany}
          onReassignCompanies={onReassignCompanies}
          onOpenRecord={(record) => {
            setReviewResult(null)
            setCorrectionResult(null)
            const nextRecord = records.find((candidate) => candidate.id === record.id)
            if (nextRecord) setActive(nextRecord)
          }}
          onOpenOrder={(orderId) => {
            setInitialOrderId(orderId)
            setOrdersOpen(true)
          }}
        />
      ) : null}

      {ordersOpen ? (
        <OrderModal
          companies={companies}
          gardens={gardens}
          orders={orders}
          initialOrderId={initialOrderId}
          onClose={() => {
            setInitialOrderId(null)
            setOrdersOpen(false)
          }}
          onCreateCompany={onCreateCompany}
          onCreateOrder={onCreateOrder}
          onUpdateOrder={onUpdateOrder}
          onDeleteOrder={onDeleteOrder}
          onUploadInvoice={uploadInvoice}
          onDeleteInvoiceFile={deleteInvoiceFile}
        />
      ) : null}

      {assetsOpen ? (
        <AssetsModal
          assets={assets}
          companies={companies}
          orders={orders}
          onClose={() => setAssetsOpen(false)}
          onCreateCompany={onCreateCompany}
          onCreateAsset={onCreateAsset}
          onUpdateAsset={onUpdateAsset}
          onDeleteAsset={onDeleteAsset}
          onUploadInvoice={uploadAssetInvoice}
          onDeleteInvoiceFile={deleteAssetInvoiceFile}
        />
      ) : null}

      {gardenOptionsOpen ? (
        <GardenOptionsModal
          options={gardenOptions}
          records={records}
          initialGroup={gardenOptionsInitialGroup}
          onClose={() => setGardenOptionsOpen(false)}
          onChange={updateGardenOptions}
          onRename={(key, previousValue, nextValue) => void renameGardenOptionReferences(key, previousValue, nextValue)}
          onOpenRecord={(record) => {
            const nextActive = records.find((candidate) => candidate.id === record.id)
            if (nextActive) setActive(nextActive)
          }}
        />
      ) : null}

      {active ? (
        <RecordModal
          mode="view"
          initial={active}
          records={records}
          onClose={() => {
            setReviewResult(null)
            setCorrectionResult(null)
            setActive(null)
          }}
          onSave={(input, options) => onUpdate(active.id, input, options)}
          onSetRecordPhotoDefault={(photo) => onSetRecordPhotoDefault(active.id, photo)}
          onSaveCultivarPhoto={(photo) => onUpdateCultivarPhoto(active.id, photo)}
          onSetCultivarPhotoDefault={(photo) => onSetCultivarPhotoDefault(active.id, photo)}
          onDeleteCultivarPhoto={(imageUrl) => onDeleteCultivarPhoto(active.id, imageUrl)}
          onDelete={() => onDelete(active.id)}
          onDuplicate={duplicateRecord}
          onOpenRecord={(record) => {
            setReviewResult(null)
            setCorrectionResult(null)
            setActive(records.find((candidate) => candidate.id === record.id) ?? record)
          }}
          onReview={(record) => reviewWithDebugAgent(record, active.id)}
          onProposeCorrection={(record, userCorrection) => proposeMissedIssueCorrection(record, userCorrection, active.id)}
          onApplyCorrection={(record) => applyCorrectionToStoredRecord(record, active.id)}
          reviewResult={reviewResult}
          correctionResult={correctionResult}
          reviewBusy={reviewBusy}
          correctionBusy={correctionBusy}
          onUploadPhoto={uploadPhoto}
          onCreateCompany={onCreateCompany}
          onOpenCompanies={() => setCompaniesOpen(true)}
          onOpenGardenOptions={openGardenOptions}
          gardenOptions={gardenOptions}
          companies={companies}
          orders={orders}
        />
      ) : null}
      </div>
    </>
  )
}
