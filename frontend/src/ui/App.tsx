import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  OAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import type { AgentCorrectionResult, AgentReviewResult, Asset, AssetInput, Company, CompanyInput, DahliaRecord, DahliaRecordInput, DahliaRecordSummary, ExcelImportResult, ExcelImportRevertResult, Invite, MaintenanceReminder, MaintenanceReminderInput, Order, OrderInput } from '../types'
import type { GardenOptionKey } from '../types'
import { auth, authHeaders, hasFirebaseConfig, initializeAuthPersistence } from '../firebase'
import { api, API_BASE, uploadPhoto } from '../api/client'
import { type InfiniteRecordsData } from '../recordUtils'
import { useGardens, gardenOptionLabel, gardensQueryKey } from '../hooks/useGardens'
import { useRecords, recordsQueryKey, recordSummariesQueryKey, flowerNamesQueryKey, colorsQueryKey } from '../hooks/useRecords'
import { useIsWeakConnection } from '../hooks/useIsWeakConnection'
import { RecordsTable } from './RecordsTable'
import { RecordModal } from './RecordModal'
import { AgentPanel } from './AgentPanel'
import { AnalyticsModal } from './AnalyticsModal'
import { PhotoIdentifyModal } from './PhotoIdentifyModal'
import { OrderModal } from './OrderModal'
import { AssetsModal } from './AssetsModal'
import { CompaniesModal } from './CompaniesModal'
import { SettingsModal } from './SettingsModal'
import { GardenOptionsModal } from './GardenOptionsModal'
import { MaintenanceRemindersModal } from './MaintenanceRemindersModal'
import { GardenManagementModal } from './GardenManagementModal'
import { FlowerNamesModal } from './FlowerNamesModal'
import { ColorsModal } from './ColorsModal'

const THEME_STORAGE_KEY = 'dahlia-tracker-theme'
const RECORDS_REFRESH_INTERVAL_STORAGE_KEY = 'dahlia-records-refresh-interval-ms'
const DEFAULT_RECORDS_REFRESH_INTERVAL_MS = 15 * 60_000
const RECORDS_REFRESH_INTERVAL_OPTIONS = [0, 30_000, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000]
const companiesQueryKey = ['companies'] as const
const ordersQueryKey = ['orders'] as const
const assetsQueryKey = ['assets'] as const
const KNOWN_USERS_REFRESH_INTERVAL_MS = 30_000

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

function maintenanceRemindersQueryKey(gardenId?: string) {
  return ['maintenance-reminders', gardenId ?? 'default'] as const
}

const microsoftProvider = new OAuthProvider('microsoft.com')

const AUTH_BYPASS_ENABLED = import.meta.env.DEV && import.meta.env.VITE_USE_AUTH_EMULATOR === 'true'
const AUTH_BYPASS_EMAIL = 'dev-bypass@dahlialedger.local'
const AUTH_BYPASS_PASSWORD = 'dev-bypass-password-not-real'

async function signInBypassUser() {
  if (!auth) return
  try {
    await signInWithEmailAndPassword(auth, AUTH_BYPASS_EMAIL, AUTH_BYPASS_PASSWORD)
  } catch {
    await createUserWithEmailAndPassword(auth, AUTH_BYPASS_EMAIL, AUTH_BYPASS_PASSWORD)
  }
}

function authErrorMessage(error: unknown) {
  if (typeof error !== 'object' || error === null) return String(error)

  const firebaseError = error as { code?: string; message?: string; customData?: { email?: string } }
  const parts = [firebaseError.code, firebaseError.message].filter(Boolean)
  if (firebaseError.customData?.email) parts.push(`Email: ${firebaseError.customData.email}`)
  return parts.join(' - ') || 'Microsoft sign-in failed.'
}

function recordWithRenamedGardenOption(record: DahliaRecord, key: GardenOptionKey, previousValue: string, nextValue: string, zoneName?: string): DahliaRecordInput | null {
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
    if (zoneName && (next.meta.gardenZone ?? next.meta.gardenArea) !== zoneName) return null
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

function recordWithMovedGardenRow(record: DahliaRecord, rowValue: string, previousZoneName: string, nextZoneName: string): DahliaRecordInput | null {
  const currentZone = record.meta?.gardenZone ?? record.meta?.gardenArea
  const currentRow = record.meta?.rowOrBed ?? record.meta?.gardenRow
  if (record.meta?.plantingState !== 'in_garden' || currentZone !== previousZoneName || currentRow !== rowValue) return null

  return {
    ...record,
    core: { ...(record.core ?? {}) },
    growth: { ...(record.growth ?? {}) },
    care: { ...(record.care ?? {}) },
    tuber: { ...(record.tuber ?? {}) },
    health: { ...(record.health ?? {}) },
    meta: {
      ...(record.meta ?? {}),
      gardenArea: nextZoneName,
      gardenZone: nextZoneName,
    },
  }
}

function loadRecordsRefreshInterval() {
  if (typeof window === 'undefined') return DEFAULT_RECORDS_REFRESH_INTERVAL_MS
  const stored = Number(window.localStorage.getItem(RECORDS_REFRESH_INTERVAL_STORAGE_KEY))
  return RECORDS_REFRESH_INTERVAL_OPTIONS.includes(stored) ? stored : DEFAULT_RECORDS_REFRESH_INTERVAL_MS
}

type Theme = 'dark' | 'light'

export function excelImportSummary(result: ExcelImportResult) {
  const counts = result.counts
  const followUpCount = counts.unmatchedCount + counts.ambiguousCount + counts.priorSeasonMissingCount + counts.skippedCount
  return `Updated ${counts.updatedCount} of ${counts.extractedCount} Excel location${counts.extractedCount === 1 ? '' : 's'}. ${followUpCount} need review.`
}

function refreshIntervalLabel(intervalMs: number) {
  if (intervalMs === 0) return 'Off'
  if (intervalMs < 60_000) return `${intervalMs / 1000} sec`
  return `${intervalMs / 60_000} min`
}

function canUserViewReminder(reminder: MaintenanceReminder, currentUserId?: string) {
  const visibility = reminder.visibility ?? 'garden'
  if (visibility === 'garden') return true

  return Boolean(currentUserId && reminder.assignedToUserId === currentUserId)
}

function highPriorityReminderMessage(count: number) {
  return `You have ${count} high priority reminder${count === 1 ? '' : 's'} needing attention.`
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
  const [flowerNamesOpen, setFlowerNamesOpen] = useState(false)
  const [lastFlowerNameRename, setLastFlowerNameRename] = useState<{ oldName: string; newName: string } | null>(null)
  const [colorsOpen, setColorsOpen] = useState(false)
  const [gardenManagementOpen, setGardenManagementOpen] = useState(false)
  const [gardenOptionsInitialGroup, setGardenOptionsInitialGroup] = useState<GardenOptionKey>('gardenAreas')
  const [recordsRefreshIntervalMs, setRecordsRefreshIntervalMs] = useState(loadRecordsRefreshInterval)
  const isWeakConnection = useIsWeakConnection()
  const effectiveRecordsRefreshIntervalMs = isWeakConnection ? 0 : recordsRefreshIntervalMs
  const [gardenMenuOpen, setGardenMenuOpen] = useState(false)
  const [recordsManagementOpen, setRecordsManagementOpen] = useState(false)
  const [agentHelperOpen, setAgentHelperOpen] = useState(false)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [photoIdentifyOpen, setPhotoIdentifyOpen] = useState(false)
  const [insightsMenuOpen, setInsightsMenuOpen] = useState(false)
  const [maintenanceRemindersOpen, setMaintenanceRemindersOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [hamburgerMenuOpen, setHamburgerMenuOpen] = useState(false)
  const recordsManagementRef = useRef<HTMLDivElement>(null)
  const gardenMenuRef = useRef<HTMLDivElement>(null)
  const insightsMenuRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const {
    gardens, selectedGarden, activeGardenId, gardenQuery, gardenOptions,
    gardenMembers, knownUsers, globalAdmin, setSelectedGardenId,
    createGarden, updateGarden, deleteGarden,
    listGardenMembers, saveGardenMember, deleteGardenMember, deleteKnownUser,
    listInvites, createInvite, resendInvite, deleteInvite, updateGardenOptions,
    invalidateGardenMembers,
  } = useGardens({ user, gardenManagementOpen, setError })

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
  const maintenanceRemindersQuery = useQuery({
    queryKey: maintenanceRemindersQueryKey(activeGardenId),
    queryFn: async () => (await api<{ reminders: MaintenanceReminder[] }>(`/api/maintenance-reminders${gardenQuery}`)).reminders,
    enabled: Boolean(user),
    refetchInterval: KNOWN_USERS_REFRESH_INTERVAL_MS,
    staleTime: 30_000,
  })

  const companies = companiesQuery.data ?? []
  const orders = ordersQuery.data ?? []
  const assets = assetsQuery.data ?? []
  const maintenanceReminders = maintenanceRemindersQuery.data ?? []
  const visibleIncompleteReminders = maintenanceReminders.filter((reminder) => !reminder.completedAt && canUserViewReminder(reminder, user?.uid))
  const visibleReminderCount = visibleIncompleteReminders.length
  const highPriorityIncompleteReminderCount = visibleIncompleteReminders.filter((reminder) => reminder.priority === 'high').length

  const {
    records, recordSummaries, flowerNames, colors, loading, recordSummariesQuery,
    refreshRecords, refreshRecordSummaries, openRecordFromSummary,
    onCreate, onUpdate, onDelete,
    onUpdateCultivarPhoto, onSetRecordPhotoDefault, onSetCultivarPhotoDefault, onDeleteCultivarPhoto,
  } = useRecords({
    user, activeGardenId, gardenQuery,
    analyticsOpen, maintenanceRemindersOpen, gardenOptionsOpen, createOpen,
    recordsRefreshIntervalMs: effectiveRecordsRefreshIntervalMs,
    setActive: (r) => setActive(r),
    setCreateDraft: (d) => setCreateDraft(d),
    setCreateOpen: (o) => setCreateOpen(o),
    onRefreshCompanies: refreshCompanies,
    setError,
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem(RECORDS_REFRESH_INTERVAL_STORAGE_KEY, String(recordsRefreshIntervalMs))
  }, [recordsRefreshIntervalMs])

  const anyModalOpen = Boolean(
    active || createOpen || agentHelperOpen || analyticsOpen || photoIdentifyOpen ||
    maintenanceRemindersOpen || gardenManagementOpen || companiesOpen ||
    ordersOpen || assetsOpen || gardenOptionsOpen
  )

  useEffect(() => {
    document.body.style.overflow = anyModalOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [anyModalOpen])

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
    if (!insightsMenuOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!insightsMenuRef.current?.contains(event.target as Node)) {
        setInsightsMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [insightsMenuOpen])

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
    const resolvedRef = { current: false }

    async function initializeAuth() {
      try {
        await initializeAuthPersistence()
      } catch (e: unknown) {
        if (!cancelled) setAuthError(authErrorMessage(e))
      }
      if (AUTH_BYPASS_ENABLED) {
        try {
          await signInBypassUser()
        } catch (e: unknown) {
          if (!cancelled) setAuthError(authErrorMessage(e))
        }
      }
      if (!cancelled && !resolvedRef.current) {
        resolvedRef.current = true
        setAuthLoading(false)
      }
    }

    void initializeAuth()
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (AUTH_BYPASS_ENABLED && !resolvedRef.current && currentUser === null) return
      resolvedRef.current = true
      setUser(currentUser)
      setAuthLoading(false)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

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

  async function duplicateRecord(record: DahliaRecord) {
    const plantingState = record.meta?.plantingState ?? 'purchased_container'
    const gardenArea = record.meta?.gardenZone ?? record.meta?.gardenArea
    const gardenRow = record.meta?.rowOrBed ?? record.meta?.gardenRow
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
        gardenArea: plantingState === 'in_garden' ? gardenArea : undefined,
        gardenZone: plantingState === 'in_garden' ? gardenArea : undefined,
        gardenRow: plantingState === 'in_garden' ? gardenRow : undefined,
        rowOrBed: plantingState === 'in_garden' ? gardenRow : undefined,
        gardenPosition: undefined,
        position: undefined,
        notPlantedReason: plantingState === 'not_planted' ? record.meta?.notPlantedReason : undefined,
        notViableReason: plantingState === 'not_viable' ? record.meta?.notViableReason : undefined,
      },
    }

    setActive(null)
    setCreateDraft(draft)
    setCreateOpen(true)
    void refreshRecords().catch(() => {})
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
    ])
  }

  function openGardenOptions(group: GardenOptionKey) {
    setGardenOptionsInitialGroup(group)
    setGardenOptionsOpen(true)
  }

  async function renameFlowerName(oldName: string, newName: string) {
    await api(`/api/flower-names/${encodeURIComponent(oldName)}${gardenQuery}`, {
      method: 'PUT',
      body: JSON.stringify({ newName }),
    })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: flowerNamesQueryKey(activeGardenId) }),
      queryClient.invalidateQueries({ queryKey: ordersQueryKey }),
      queryClient.invalidateQueries({ queryKey: recordsQueryKey(activeGardenId) }),
    ])
    queryClient.setQueryData<DahliaRecord[]>(recordsQueryKey(activeGardenId), (prev) => prev?.map((record) => {
      if (record.flowerName !== oldName) return record
      return {
        ...record,
        flowerName: newName,
        core: { ...record.core, cultivar: record.core?.cultivar === oldName ? newName : record.core?.cultivar },
      }
    }))
    queryClient.setQueryData<InfiniteRecordsData<DahliaRecordSummary>>(
      recordSummariesQueryKey(activeGardenId),
      (data) => {
        if (!data) return data
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            records: page.records.map((summary) =>
              summary.flowerName !== oldName ? summary : { ...summary, flowerName: newName }
            ),
          })),
        }
      },
    )
    await refreshRecordSummaries()
    setActive((prev) => {
      if (!prev || prev.flowerName !== oldName) return prev
      return {
        ...prev,
        flowerName: newName,
        core: { ...prev.core, cultivar: prev.core?.cultivar === oldName ? newName : prev.core?.cultivar },
      }
    })
    setLastFlowerNameRename({ oldName, newName })
  }

  async function renameColor(oldColor: string, newColor: string) {
    await api(`/api/colors/${encodeURIComponent(oldColor)}${gardenQuery}`, {
      method: 'PUT',
      body: JSON.stringify({ newName: newColor }),
    })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: colorsQueryKey(activeGardenId) }),
      queryClient.invalidateQueries({ queryKey: recordsQueryKey(activeGardenId) }),
    ])
    queryClient.setQueryData<DahliaRecord[]>(recordsQueryKey(activeGardenId), (prev) => prev?.map((record) => {
      if (record.core?.color !== oldColor) return record
      return { ...record, core: { ...record.core, color: newColor } }
    }))
    queryClient.setQueryData<InfiniteRecordsData<DahliaRecordSummary>>(
      recordSummariesQueryKey(activeGardenId),
      (data) => {
        if (!data) return data
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            records: page.records.map((summary) =>
              summary.core?.color !== oldColor ? summary : { ...summary, core: { ...summary.core, color: newColor } }
            ),
          })),
        }
      },
    )
    await refreshRecordSummaries()
    setActive((prev) => {
      if (!prev || prev.core?.color !== oldColor) return prev
      return { ...prev, core: { ...prev.core, color: newColor } }
    })
  }


  async function renameGardenOptionReferences(key: GardenOptionKey, previousValue: string, nextValue: string, zoneName?: string) {
    const updates = records
      .map((record) => ({ record, input: recordWithRenamedGardenOption(record, key, previousValue, nextValue, zoneName) }))
      .filter((update): update is { record: DahliaRecord; input: DahliaRecordInput } => update.input !== null)

    if (!updates.length) return

    await Promise.all(updates.map(({ record, input }) => onUpdate(record.id, input, { keepOpen: active?.id === record.id, skipRefresh: true })))
    await refreshRecords()
  }

  async function moveGardenRowReferences(rowValue: string, previousZoneName: string, nextZoneName: string) {
    const updates = records
      .map((record) => ({ record, input: recordWithMovedGardenRow(record, rowValue, previousZoneName, nextZoneName) }))
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
          <div className="brandTitle">The Dahlia Ledger <span className="brandVersion">v{__APP_VERSION__}</span></div>
          <div className="brandSub">Records, images, seasons, and notes</div>
        </div>
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
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setMaintenanceRemindersOpen(true)
              setRecordsManagementOpen(false)
              setInsightsMenuOpen(false)
              setHamburgerMenuOpen(false)
            }}
          >
            Reminders{visibleReminderCount ? ` (${visibleReminderCount})` : ''}
          </button>
          <div className="hamburgerGroup">
            <button
              className="btn ghost accordionToggle hamburgerToggle"
              type="button"
              aria-expanded={hamburgerMenuOpen}
              aria-label="Open more menu"
              onClick={() => {
                setHamburgerMenuOpen((open) => !open)
                setRecordsManagementOpen(false)
                setInsightsMenuOpen(false)
              }}
            >
              <span>More</span>
              <span className="accordionIcon" aria-hidden="true">☰</span>
            </button>
            <div className={`hamburgerPanel${hamburgerMenuOpen ? ' open' : ''}`}>
              <button
                className="navDrawerClose btn ghost compact"
                type="button"
                aria-label="Close menu"
                onClick={() => setHamburgerMenuOpen(false)}
              >
                ✕
              </button>
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
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => {
                        setPhotoIdentifyOpen(true)
                        setInsightsMenuOpen(false)
                      }}
                    >
                      Identify A Flower
                    </button>
                  </div>
                ) : null}
              </div>
          <button
            className="btn ghost accordionToggle"
            type="button"
            onClick={() => {
              setSettingsModalOpen(true)
              setHamburgerMenuOpen(false)
            }}
          >
            <span>Settings</span>
          </button>
            </div>
          </div>
        </div>
        {highPriorityIncompleteReminderCount ? <div className="topPriorityMessage" role="status">{highPriorityReminderMessage(highPriorityIncompleteReminderCount)}</div> : null}
        {hamburgerMenuOpen && (
          <div className="navDrawerBackdrop" aria-hidden="true" onClick={() => setHamburgerMenuOpen(false)} />
        )}
      </header>

      <main className="mainGrid">
        <section className="panel recordsPanel">
          <div className="panelTitle panelTitleRow">
            <span>Records</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button className="btn compact" onClick={async () => {
                setReviewResult(null)
                setCorrectionResult(null)
                setCreateOpen(true)
                void refreshRecords().catch(() => {})
              }}>
                New Record
              </button>
              {recordSummariesQuery.dataUpdatedAt > 0 && !loading && (
                <span className="recordsRefreshStatus">
                  {recordSummariesQuery.isRefetching
                    ? 'Updating…'
                    : `Updated ${new Date(recordSummariesQuery.dataUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                </span>
              )}
              <label className="pageSizeControl">
                <span className="pageSizeLabel">Refresh</span>
                <select className="select" value={recordsRefreshIntervalMs} onChange={(event) => setRecordsRefreshIntervalMs(Number(event.target.value))}>
                  {RECORDS_REFRESH_INTERVAL_OPTIONS.map((intervalMs) => (
                    <option key={intervalMs} value={intervalMs}>{refreshIntervalLabel(intervalMs)}</option>
                  ))}
                </select>
                {isWeakConnection && recordsRefreshIntervalMs !== 0 ? (
                  <span className="recordsRefreshStatus">Paused (weak connection)</span>
                ) : null}
              </label>
            </div>
          </div>
          {error ? <div className="error">{error}</div> : null}
          {recordSummariesQuery.error ? <div className="error">{recordSummariesQuery.error instanceof Error ? recordSummariesQuery.error.message : String(recordSummariesQuery.error)}</div> : null}
          <RecordsTable rows={recordSummaries}orders={orders} loading={loading} loadingMore={recordSummariesQuery.isFetchingNextPage} hasMore={Boolean(recordSummariesQuery.hasNextPage)} onLoadMore={() => void recordSummariesQuery.fetchNextPage()} onOpen={(r) => {
            setReviewResult(null)
            setCorrectionResult(null)
            void openRecordFromSummary(r)
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
        <AnalyticsModal
          records={records}
          companies={companies}
          onClose={() => setAnalyticsOpen(false)}
          onOpenRecord={(record) => setActive(records.find((candidate) => candidate.id === record.id) ?? record)}
          onOpenOrder={(orderId) => {
            setInitialOrderId(orderId)
            setOrdersOpen(true)
          }}
        />
      ) : null}

      {photoIdentifyOpen ? <PhotoIdentifyModal onClose={() => setPhotoIdentifyOpen(false)} /> : null}

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
            void invalidateGardenMembers()
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
          recordSummaries={recordSummaries}
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
          onOpenFlowerNames={() => setFlowerNamesOpen(true)}
          onOpenColors={() => setColorsOpen(true)}
          gardenOptions={gardenOptions}
          companies={companies}
          orders={orders}
          flowerNames={flowerNames}
          colors={colors}
          gardenId={activeGardenId || undefined}
        />
      ) : null}

      {companiesOpen ? (
        <CompaniesModal
          companies={companies}
          gardens={gardens}
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

      {settingsModalOpen ? (
        <SettingsModal
          initialBlade="appearance"
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          showFileImports={globalAdmin}
          signedInAs={user.email ?? user.displayName ?? ''}
          onSignOut={() => {
            setSettingsModalOpen(false)
            if (auth) void signOut(auth)
          }}
          oneNoteImporting={oneNoteImporting}
          oneNoteImportProgress={oneNoteImportProgress}
          oneNoteImportMessage={oneNoteImportMessage}
          onImportOneNote={(file) => void importOneNoteFile(file)}
          excelImporting={excelImporting}
          excelImportProgress={excelImportProgress}
          excelImportResult={excelImportResult}
          excelImportSummary={excelImportSummary}
          onImportExcel={(file) => void importExcelFile(file)}
          excelReverting={excelReverting}
          excelRevertMessage={excelRevertMessage}
          onRevertExcel={() => void revertLatestExcelImport()}
          onClose={() => setSettingsModalOpen(false)}
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
          onOpenFlowerNames={() => setFlowerNamesOpen(true)}
          flowerNames={flowerNames}
          flowerNameRename={lastFlowerNameRename}
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
          gardens={gardens}
          records={records}
          initialGroup={gardenOptionsInitialGroup}
          onClose={() => setGardenOptionsOpen(false)}
          onChange={updateGardenOptions}
          onRename={(key, previousValue, nextValue, zoneName) => void renameGardenOptionReferences(key, previousValue, nextValue, zoneName)}
          onMoveRow={(rowValue, previousZoneName, nextZoneName) => void moveGardenRowReferences(rowValue, previousZoneName, nextZoneName)}
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
          recordSummaries={recordSummaries}
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
          onOpenFlowerNames={() => setFlowerNamesOpen(true)}
          onOpenColors={() => setColorsOpen(true)}
          gardenOptions={gardenOptions}
          companies={companies}
          orders={orders}
          flowerNames={flowerNames}
          colors={colors}
          gardenId={activeGardenId || undefined}
        />
      ) : null}

      {flowerNamesOpen ? (
        <FlowerNamesModal
          flowerNames={flowerNames}
          onClose={() => setFlowerNamesOpen(false)}
          onRenameFlowerName={renameFlowerName}
        />
      ) : null}

      {colorsOpen ? (
        <ColorsModal
          colors={colors}
          onClose={() => setColorsOpen(false)}
          onRenameColor={renameColor}
        />
      ) : null}
      </div>
    </>
  )
}
