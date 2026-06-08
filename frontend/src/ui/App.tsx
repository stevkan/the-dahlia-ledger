import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { initializeApp, type FirebaseOptions } from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  OAuthProvider,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import type { AgentCorrectionResult, AgentReviewResult, Company, CompanyInput, DahliaPhoto, DahliaRecord, DahliaRecordInput, ExcelImportResult, ExcelImportRevertResult, MaintenanceReminder, MaintenanceReminderInput, Order, OrderInput } from '../types'
import type { GardenOptionKey, GardenOptions } from '../types'
import { DEFAULT_GARDEN_OPTIONS, GARDEN_OPTIONS_STORAGE_KEY, normalizeGardenOptions } from '../gardenOptions'
import { RecordsTable } from './RecordsTable'
import { RecordModal } from './RecordModal'
import { AgentPanel, AnalyticsPanel } from './AgentPanel'
import { OrderModal } from './OrderModal'
import { CompaniesModal } from './CompaniesModal'
import { GardenOptionsModal } from './GardenOptionsModal'
import { MaintenanceRemindersModal } from './MaintenanceRemindersModal'

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? 'http://localhost:8787'
const THEME_STORAGE_KEY = 'dahlia-tracker-theme'
const recordsQueryKey = ['records'] as const
const companiesQueryKey = ['companies'] as const
const ordersQueryKey = ['orders'] as const
const settingsQueryKey = ['settings'] as const
const maintenanceRemindersQueryKey = ['maintenance-reminders'] as const

const firebaseConfig: FirebaseOptions = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY,
  authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID,
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID,
}

const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean)
const auth = hasFirebaseConfig ? getAuth(initializeApp(firebaseConfig)) : null
const microsoftProvider = new OAuthProvider('microsoft.com')

function authErrorMessage(error: unknown) {
  if (typeof error !== 'object' || error === null) return String(error)

  const firebaseError = error as { code?: string; message?: string; customData?: { email?: string } }
  const parts = [firebaseError.code, firebaseError.message].filter(Boolean)
  if (firebaseError.customData?.email) parts.push(`Email: ${firebaseError.customData.email}`)
  return parts.join(' - ') || 'Microsoft sign-in failed.'
}

function loadGardenOptions(): GardenOptions {
  if (typeof window === 'undefined') return DEFAULT_GARDEN_OPTIONS
  const stored = window.localStorage.getItem(GARDEN_OPTIONS_STORAGE_KEY)
  if (!stored) return DEFAULT_GARDEN_OPTIONS

  try {
    return normalizeGardenOptions(JSON.parse(stored))
  } catch {
    return DEFAULT_GARDEN_OPTIONS
  }
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

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
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
  const [initialOrderId, setInitialOrderId] = useState<string | null>(null)
  const [companiesOpen, setCompaniesOpen] = useState(false)
  const [companiesUsageRefreshing, setCompaniesUsageRefreshing] = useState(false)
  const [gardenOptionsOpen, setGardenOptionsOpen] = useState(false)
  const [gardenOptionsInitialGroup, setGardenOptionsInitialGroup] = useState<GardenOptionKey>('gardenAreas')
  const [gardenOptions, setGardenOptions] = useState<GardenOptions>(loadGardenOptions)
  const [recordsManagementOpen, setRecordsManagementOpen] = useState(false)
  const [agentHelperOpen, setAgentHelperOpen] = useState(false)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [insightsMenuOpen, setInsightsMenuOpen] = useState(false)
  const [maintenanceRemindersOpen, setMaintenanceRemindersOpen] = useState(false)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const recordsManagementRef = useRef<HTMLDivElement>(null)
  const insightsMenuRef = useRef<HTMLDivElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const recordsQuery = useQuery({
    queryKey: recordsQueryKey,
    queryFn: async () => (await api<{ records: DahliaRecord[] }>('/api/records')).records,
    enabled: Boolean(user),
    staleTime: 30_000,
  })
  const companiesQuery = useQuery({
    queryKey: companiesQueryKey,
    queryFn: async () => (await api<{ companies: Company[] }>('/api/companies')).companies,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
  const ordersQuery = useQuery({
    queryKey: ordersQueryKey,
    queryFn: async () => (await api<{ orders: Order[] }>('/api/orders')).orders,
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
    queryKey: maintenanceRemindersQueryKey,
    queryFn: async () => (await api<{ reminders: MaintenanceReminder[] }>('/api/maintenance-reminders')).reminders,
    enabled: Boolean(user),
    staleTime: 30_000,
  })

  const records = recordsQuery.data ?? []
  const companies = companiesQuery.data ?? []
  const orders = ordersQuery.data ?? []
  const settings = settingsQuery.data ?? { agentDebugReviewEnabled: false }
  const maintenanceReminders = maintenanceRemindersQuery.data ?? []
  const dueReminderCount = maintenanceReminders.filter((reminder) => !reminder.completedAt && reminder.dueDate && reminder.dueDate <= todayDate()).length
  const loading = recordsQuery.isLoading

  const tableRows = useMemo(() => records, [records])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem(GARDEN_OPTIONS_STORAGE_KEY, JSON.stringify(gardenOptions))
  }, [gardenOptions])

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
      queryKey: recordsQueryKey,
      queryFn: async () => (await api<{ records: DahliaRecord[] }>('/api/records')).records,
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
        await setPersistence(auth!, browserLocalPersistence)
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
      await setPersistence(auth, browserLocalPersistence)
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

  async function refreshMaintenanceReminders() {
    return await queryClient.fetchQuery({
      queryKey: maintenanceRemindersQueryKey,
      queryFn: async () => (await api<{ reminders: MaintenanceReminder[] }>('/api/maintenance-reminders')).reminders,
      staleTime: 0,
    })
  }

  async function onCreateMaintenanceReminder(input: MaintenanceReminderInput) {
    await api<{ reminder: MaintenanceReminder }>('/api/maintenance-reminders', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    await refreshMaintenanceReminders()
  }

  async function onUpdateMaintenanceReminder(id: string, input: MaintenanceReminderInput) {
    await api<{ reminder: MaintenanceReminder }>(`/api/maintenance-reminders/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
    await refreshMaintenanceReminders()
  }

  async function onCompleteMaintenanceReminder(id: string) {
    await api<{ reminder: MaintenanceReminder }>(`/api/maintenance-reminders/${encodeURIComponent(id)}/complete`, { method: 'POST' })
    await refreshMaintenanceReminders()
  }

  async function onDeleteMaintenanceReminder(id: string) {
    await api<{ ok: true }>(`/api/maintenance-reminders/${encodeURIComponent(id)}`, { method: 'DELETE' })
    await refreshMaintenanceReminders()
  }

  async function onCreate(input: DahliaRecordInput) {
    await api<{ record: DahliaRecord }>('/api/records', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    setCreateDraft(null)
    setCreateOpen(false)
    await Promise.all([refreshRecords(), refreshCompanies()])
  }

  async function onUpdate(id: string, input: DahliaRecordInput, options?: { keepOpen?: boolean; skipRefresh?: boolean }) {
    const data = await api<{ record: DahliaRecord }>(`/api/records/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
    if (options?.keepOpen) setActive(data.record)
    else setActive(null)
    if (!options?.skipRefresh) {
      const [refreshedRecords] = await Promise.all([refreshRecords(), refreshCompanies()])
      if (options?.keepOpen) setActive(refreshedRecords.find((record) => record.id === id) ?? data.record)
    }
  }

  async function onUpdateCultivarPhoto(id: string, photo: { cultivarImageUrl: string; cultivarThumbnailUrl?: string; photo?: DahliaPhoto }) {
    const data = await api<{ updatedCount: number; records: DahliaRecord[] }>(`/api/records/${encodeURIComponent(id)}/cultivar-photo`, {
      method: 'PUT',
      body: JSON.stringify(photo),
    })
    queryClient.setQueryData(recordsQueryKey, data.records)
    setActive(data.records.find((record) => record.id === id) ?? null)
  }

  async function onSetRecordPhotoDefault(id: string, photo: DahliaPhoto) {
    const data = await api<{ record: DahliaRecord; records: DahliaRecord[] }>(`/api/records/${encodeURIComponent(id)}/record-photo-default`, {
      method: 'PUT',
      body: JSON.stringify({ photo }),
    })
    queryClient.setQueryData(recordsQueryKey, data.records)
    setActive(data.record)
  }

  async function onSetCultivarPhotoDefault(id: string, photo: DahliaPhoto) {
    const data = await api<{ updatedCount: number; records: DahliaRecord[] }>(`/api/records/${encodeURIComponent(id)}/cultivar-photo-default`, {
      method: 'PUT',
      body: JSON.stringify({ photo }),
    })
    queryClient.setQueryData(recordsQueryKey, data.records)
    setActive(data.records.find((record) => record.id === id) ?? null)
  }

  async function onDeleteCultivarPhoto(id: string, imageUrl: string) {
    const data = await api<{ updatedCount: number; records: DahliaRecord[] }>(`/api/records/${encodeURIComponent(id)}/cultivar-photo`, {
      method: 'DELETE',
      body: JSON.stringify({ imageUrl }),
    })
    queryClient.setQueryData(recordsQueryKey, data.records)
    setActive(data.records.find((record) => record.id === id) ?? null)
  }

  async function onDelete(id: string) {
    await api<{ ok: true }>(`/api/records/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    setActive(null)
    await Promise.all([refreshRecords(), refreshCompanies()])
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
        plantingState: record.meta?.plantingState ?? 'purchased_container',
      },
    }

    setActive(null)
    setCreateDraft(draft)
    setCreateOpen(true)
  }

  async function onCreateCompany(input: CompanyInput) {
    const data = await api<{ company: Company }>('/api/companies', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    await refreshOrders()
    return data.company
  }

  async function onUpdateCompany(id: string, input: CompanyInput) {
    const data = await api<{ company: Company }>(`/api/companies/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
    queryClient.setQueryData<Company[]>(companiesQueryKey, (current) => current?.map((company) => company.id === id ? data.company : company) ?? [data.company])
    const [refreshedCompanies] = await Promise.all([refreshCompanies(), refreshRecords(), queryClient.fetchQuery({
      queryKey: ordersQueryKey,
      queryFn: async () => (await api<{ orders: Order[] }>('/api/orders')).orders,
      staleTime: 0,
    })])
    return refreshedCompanies.find((company) => company.id === id) ?? data.company
  }

  async function onDeleteCompany(id: string) {
    await api<{ ok: true }>(`/api/companies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    await refreshOrders()
  }

  function openGardenOptions(group: GardenOptionKey) {
    setGardenOptionsInitialGroup(group)
    setGardenOptionsOpen(true)
  }

  function updateGardenOptions(nextOptions: GardenOptions) {
    setGardenOptions(normalizeGardenOptions(nextOptions))
  }

  async function onCreateOrder(input: OrderInput) {
    const data = await api<{ order: Order }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    await refreshOrders()
    return data.order
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
      body,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Upload failed: ${res.status}`)
    }
    await refreshOrders()
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
      const data = await new Promise<{ importedCount: number; skippedCount?: number; createdCompanyCount?: number }>((resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open('POST', `${API_BASE}/api/import/onenote`)
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
      const data = await new Promise<ExcelImportResult>((resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open('POST', `${API_BASE}/api/import/excel`)
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

  if (authLoading) {
    return (
      <div className="landingShell">
        <div className="landingCard">
          <div className="landingEyebrow">The Dahlia Ledger</div>
          <h1>Checking your session</h1>
          <p>Preparing your records workspace.</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
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
    )
  }

  return (
    <div className="appShell">
      <header className="topBar">
        <div className="brand">
          <div className="brandTitle">The Dahlia Ledger</div>
          <div className="brandSub">Records, images, seasons, and notes</div>
        </div>
        <div className="topActions">
          <div className="actionAccordion" ref={recordsManagementRef}>
            <button
              className="btn ghost accordionToggle"
              aria-expanded={recordsManagementOpen}
              aria-controls="records-management-actions"
              onClick={() => setRecordsManagementOpen((open) => !open)}
            >
              <span>Records Management</span>
              <span className="accordionIcon" aria-hidden="true">
                {recordsManagementOpen ? '−' : '+'}
              </span>
            </button>
            {recordsManagementOpen ? (
              <div className="accordionPanel" id="records-management-actions">
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
                    openGardenOptions('gardenAreas')
                    setRecordsManagementOpen(false)
                  }}
                >
                  Garden Options
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
            Reminders{dueReminderCount ? ` (${dueReminderCount})` : ''}
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
                <div className="oneNoteImportSetting">
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
                </div>
                <div className="oneNoteImportSetting">
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
                </div>
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
          <RecordsTable rows={tableRows} orders={orders} loading={loading} onOpen={(r) => {
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
          onClose={() => setMaintenanceRemindersOpen(false)}
          onCreate={onCreateMaintenanceReminder}
          onUpdate={onUpdateMaintenanceReminder}
          onComplete={onCompleteMaintenanceReminder}
          onDelete={onDeleteMaintenanceReminder}
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
          usageRefreshing={companiesUsageRefreshing}
          onClose={() => setCompaniesOpen(false)}
          onCreateCompany={onCreateCompany}
          onUpdateCompany={onUpdateCompany}
          onDeleteCompany={onDeleteCompany}
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

      {gardenOptionsOpen ? (
        <GardenOptionsModal
          options={gardenOptions}
          initialGroup={gardenOptionsInitialGroup}
          onClose={() => setGardenOptionsOpen(false)}
          onChange={updateGardenOptions}
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
  )
}
