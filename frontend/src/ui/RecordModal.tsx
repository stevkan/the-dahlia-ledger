import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_GARDEN_OPTIONS } from '../gardenOptions'
import type { AgentCorrectionResult, AgentPhotoIdentificationResult, AgentReviewResult, Company, CompanyInput, DahliaPhoto, DahliaRecord, DahliaRecordInput, DahliaRecordSummary, GardenOptionKey, GardenOptions, NotPlantedReason, NotViableReason, Order, PlantingState } from '../types'
import { DropdownField } from './DropdownField'
import { FlowerNameField } from './FlowerNameField'
import { ColorField } from './ColorField'
import { DahliaPickerField } from './DahliaPickerField'
import { PhotoIdentifyResultsModal } from './PhotoIdentifyResultsModal'
import { identifyPhoto } from '../api/client'

type SectionKey = 'core' | 'growth' | 'care' | 'tuber' | 'storage' | 'health' | 'varieties' | 'meta' | 'photos'
type ConfirmAction = 'review' | 'delete' | 'duplicate' | null

const PLANTING_STATES: { value: PlantingState; label: string }[] = [
  { value: 'garden_tray', label: 'Garden Tray' },
  { value: 'in_garden', label: 'In Garden' },
  { value: 'not_planted', label: 'Not Planted' },
  { value: 'not_viable', label: 'Not Viable' },
  { value: 'purchased_container', label: 'Purchased Container' },
]
const NOT_PLANTED_REASONS: { value: NotPlantedReason; label: string }[] = [
  { value: 'not_received', label: 'Not Received' },
  { value: 'refunded', label: 'Refunded' },
]
const NOT_VIABLE_REASONS: { value: NotViableReason; label: string }[] = [
  { value: 'no_longer_present', label: 'No Longer Present' },
  { value: 'removed', label: 'Removed' },
  { value: 'unused', label: 'Unused' },
]
const DAHLIA_FORM_OPTIONS = [
  'Anemone',
  'Ball',
  'Cactus',
  'Collarette',
  'Formal Decorative',
  'Incurved Cactus',
  'Informal Decorative',
  'Mignon Single',
  'Orchid',
  'Peony',
  'Pom Pon',
  'Semi Cactus',
  'Semi-Double',
  'Single',
  'Stellar',
  'Waterlily',
]
const DAHLIA_HABIT_OPTIONS = ['Upright', 'Forward', 'Down']
const BLOOM_WIDTH_OPTIONS = [
  'AA - over 10"',
  'A - 8" to 10"',
  'B - 6" to 8"',
  'BB - 4" to 6"',
  'M - up to 4"',
  'MC - up to 2"',
]
const PHOTO_PREVIEW_SIZE = 160
const PHOTO_GALLERY_THUMB_SIZE = 112

const DEFAULT_INPUT: DahliaRecordInput = {
  flowerName: '',
  gardenLocation: '',
  seasonYearStart: new Date().getFullYear(),
  thumbnailUrl: '',
  imageUrl: '',
  core: { plantedDate: plantedDateForYear(new Date().getFullYear()) },
  growth: {},
  care: {},
  tuber: {},
  health: {},
  meta: {
    plantingState: 'in_garden',
    gardenArea: 'Main Garden',
    gardenZone: 'Main Garden',
  },
}

function recordToInput(record: DahliaRecord): DahliaRecordInput {
  return {
    id: record.id,
    recordNumber: record.recordNumber,
    flowerName: record.flowerName,
    gardenLocation: record.gardenLocation,
    seasonYearStart: record.seasonYearStart,
    thumbnailUrl: record.thumbnailUrl ?? '',
    imageUrl: record.imageUrl ?? '',
    cultivarThumbnailUrl: record.cultivarThumbnailUrl ?? '',
    cultivarImageUrl: record.cultivarImageUrl ?? '',
    recordPhotos: record.recordPhotos ?? [],
    cultivarPhotos: record.cultivarPhotos ?? [],
    defaultRecordPhotoId: record.defaultRecordPhotoId,
    defaultCultivarPhotoId: record.defaultCultivarPhotoId,
    defaultPhotoScope: record.defaultPhotoScope,
    core: { ...(record.core ?? {}), plantedDate: record.core?.plantedDate ?? plantedDateForYear(record.seasonYearStart) },
    growth: { ...(record.growth ?? {}) },
    care: { ...(record.care ?? {}) },
    tuber: { ...(record.tuber ?? {}) },
    health: { ...(record.health ?? {}) },
    meta: { ...(record.meta ?? {}) },
  }
}

function plantedDateForYear(year: number) {
  return `${year}-01-01`
}

function normalizeCompanyKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function normalizeCompanyName(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-zA-Z0-9&. ]+/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function findCompanyNameMatch(companies: Company[], value?: string) {
  const key = normalizeCompanyKey(value ?? '')
  if (!key) return undefined
  return companies.find((company) => normalizeCompanyKey(company.name) === key)?.name
}

function normalizeInputForComparison(input: DahliaRecordInput) {
  const normalized = inputWithGardenLocation(input)
  const tuber = normalized.tuber ?? {}

  return JSON.stringify({
    id: normalized.id,
    recordNumber: normalized.recordNumber,
    flowerName: normalized.flowerName,
    gardenLocation: normalized.gardenLocation,
    seasonYearStart: normalized.seasonYearStart,
    thumbnailUrl: normalized.thumbnailUrl ?? '',
    imageUrl: normalized.imageUrl ?? '',
    cultivarThumbnailUrl: normalized.cultivarThumbnailUrl ?? '',
    cultivarImageUrl: normalized.cultivarImageUrl ?? '',
    recordPhotos: normalized.recordPhotos ?? [],
    cultivarPhotos: normalized.cultivarPhotos ?? [],
    defaultRecordPhotoId: normalized.defaultRecordPhotoId ?? '',
    defaultCultivarPhotoId: normalized.defaultCultivarPhotoId ?? '',
    defaultPhotoScope: normalized.defaultPhotoScope ?? '',
    core: normalized.core ?? {},
    growth: normalized.growth ?? {},
    care: normalized.care ?? {},
    tuber: { ...tuber, linkedOrderItemIds: tuber.linkedOrderItemIds ?? [] },
    health: normalized.health ?? {},
    meta: normalized.meta ?? {},
  })
}

function normalizeBloomWidthValue(value?: string) {
  const normalized = value?.trim()
  if (!normalized) return undefined

  const existingOption = BLOOM_WIDTH_OPTIONS.find((option) => option.toLowerCase() === normalized.toLowerCase())
  if (existingOption) return existingOption

  const compact = normalized.toLowerCase().replace(/inches|inch|in\.?|"/g, '').replace(/\s+/g, '')
  if (/^aa$|^over10$|^>10$|^10\+$/.test(compact)) return 'AA - over 10"'
  if (/^a$|^8-10$|^8to10$/.test(compact)) return 'A - 8" to 10"'
  if (/^b$|^6-8$|^6to8$/.test(compact)) return 'B - 6" to 8"'
  if (/^bb$|^4-6$|^4to6$/.test(compact)) return 'BB - 4" to 6"'
  if (/^m$|^upto4$|^<=4$|^<4$/.test(compact)) return 'M - up to 4"'
  if (/^mc$|^upto2$|^<=2$|^<2$/.test(compact)) return 'MC - up to 2"'

  const numericValue = Number(compact)
  if (Number.isFinite(numericValue)) {
    if (numericValue > 10) return 'AA - over 10"'
    if (numericValue > 8) return 'A - 8" to 10"'
    if (numericValue > 6) return 'B - 6" to 8"'
    if (numericValue > 4) return 'BB - 4" to 6"'
    if (numericValue > 2) return 'M - up to 4"'
    if (numericValue > 0) return 'MC - up to 2"'
  }

  return undefined
}

function inputWithNormalizedBloomWidth(input: DahliaRecordInput) {
  const size = input.core?.size
  const normalizedSize = normalizeBloomWidthValue(size)
  if (!size || normalizedSize === size) return input
  if (normalizedSize) return { ...input, core: { ...input.core, size: normalizedSize } }

  const note = `Bloom Width: ${size}`
  const notes = input.core.notes?.includes(note) ? input.core.notes : [input.core.notes, note].filter(Boolean).join('\n')
  return { ...input, core: { ...input.core, size: undefined, notes } }
}

function inputFromInitialRecord(initial: DahliaRecord | null, draft?: DahliaRecordInput | null) {
  if (!initial) return mergeDraftWithDefaults(draft)
  return recordToInput(initial)
}

function mergeDraftWithDefaults(draft?: DahliaRecordInput | null) {
  const seasonYearStart = draft?.seasonYearStart ?? DEFAULT_INPUT.seasonYearStart
  return {
    ...DEFAULT_INPUT,
    ...(draft ?? {}),
    seasonYearStart,
    core: {
      ...DEFAULT_INPUT.core,
      ...(draft?.core ?? {}),
      plantedDate: draft?.core?.plantedDate ?? plantedDateForYear(seasonYearStart),
    },
  }
}

function mergeRecordPatch(record: DahliaRecordInput, patch: Partial<DahliaRecordInput>) {
  return {
    ...record,
    ...patch,
    core: { ...record.core, ...(patch.core ?? {}) },
    growth: { ...record.growth, ...(patch.growth ?? {}) },
    care: { ...record.care, ...(patch.care ?? {}) },
    tuber: { ...record.tuber, ...(patch.tuber ?? {}) },
    health: { ...record.health, ...(patch.health ?? {}) },
    meta: { ...record.meta, ...(patch.meta ?? {}) },
  }
}

function getGardenLocation(row?: string, position?: number) {
  return row && position ? `${row}${position}` : ''
}

function getGardenKey(row?: string | null, position?: number | null) {
  return row && position ? `${row}${position}` : undefined
}

function inputWithGardenLocation(input: DahliaRecordInput) {
  const plantingState = input.meta.plantingState
  const gardenZone = input.meta.gardenZone ?? input.meta.gardenArea
  const rowOrBed = input.meta.rowOrBed ?? input.meta.gardenRow
  const position = input.meta.position ?? input.meta.gardenPosition
  const gardenLocation = plantingState === 'in_garden' ? getGardenLocation(rowOrBed, position) : ''

  return {
    ...input,
    gardenLocation,
    meta: {
      ...input.meta,
      plantingState,
      gardenArea: plantingState === 'in_garden' ? gardenZone : undefined,
      gardenRow: plantingState === 'in_garden' ? rowOrBed : undefined,
      gardenPosition: plantingState === 'in_garden' ? position : undefined,
      gardenZone: plantingState === 'in_garden' ? gardenZone : undefined,
      rowOrBed: plantingState === 'in_garden' ? rowOrBed : undefined,
      position: plantingState === 'in_garden' ? position : undefined,
      notPlantedReason: plantingState === 'not_planted' ? input.meta.notPlantedReason : undefined,
      notViableReason: plantingState === 'not_viable' ? input.meta.notViableReason : undefined,
    },
  }
}

function sectionTitle(k: SectionKey) {
  switch (k) {
    case 'core':
      return 'Core Details'
    case 'growth':
      return 'Growth'
    case 'care':
      return 'Care'
    case 'tuber':
      return 'Source'
    case 'storage':
      return 'Storage'
    case 'health':
      return 'Health'
    case 'varieties':
      return 'Varieties'
    case 'meta':
      return 'Meta'
  }
}

function varietyKey(record: DahliaRecord | DahliaRecordInput) {
  return (record.core?.cultivar || record.flowerName).trim().toLowerCase()
}

function photoUrl(photo?: DahliaPhoto) {
  return photo?.thumbnailUrl || photo?.imageUrl || ''
}

function fullPhotoUrl(photo?: DahliaPhoto) {
  return photo?.imageUrl || photo?.thumbnailUrl || ''
}

function uniquePhotos(photos: DahliaPhoto[]) {
  const seen = new Set<string>()
  return photos.filter((photo) => {
    const key = photo.imageUrl || photo.id
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function defaultPhoto(photos: DahliaPhoto[], defaultId?: string) {
  return photos.find((photo) => photo.id === defaultId) ?? photos[0]
}

function resolvedDefaultPhotoId(photos: DahliaPhoto[], defaultId: string | undefined, fallbackImageUrl?: string) {
  return defaultId || photos.find((photo) => photo.imageUrl === fallbackImageUrl)?.id || photos[0]?.id
}

function resolvedCurrentPhoto(recordPhotos: DahliaPhoto[], cultivarPhotos: DahliaPhoto[], recordDefaultId?: string, cultivarDefaultId?: string) {
  return defaultPhoto(recordPhotos, recordDefaultId) ?? defaultPhoto(cultivarPhotos, cultivarDefaultId)
}

function resolvedScopedCurrentPhoto(recordPhotos: DahliaPhoto[], cultivarPhotos: DahliaPhoto[], recordDefaultId: string | undefined, cultivarDefaultId: string | undefined, scope?: 'record' | 'cultivar') {
  if (scope === 'cultivar') return defaultPhoto(cultivarPhotos, cultivarDefaultId) ?? defaultPhoto(recordPhotos, recordDefaultId)
  return resolvedCurrentPhoto(recordPhotos, cultivarPhotos, recordDefaultId, cultivarDefaultId)
}

function withResolvedPhotoFields(input: DahliaRecordInput): DahliaRecordInput {
  const recordPhotos = uniquePhotos(input.recordPhotos ?? [])
  const cultivarPhotos = uniquePhotos(input.cultivarPhotos ?? [])
  const recordDefault = defaultPhoto(recordPhotos, input.defaultRecordPhotoId)
  const cultivarDefault = defaultPhoto(cultivarPhotos, input.defaultCultivarPhotoId)

  return {
    ...input,
    recordPhotos,
    cultivarPhotos,
    defaultRecordPhotoId: recordDefault?.id,
    defaultCultivarPhotoId: cultivarDefault?.id,
    defaultPhotoScope: input.defaultPhotoScope || (recordDefault ? 'record' : cultivarDefault ? 'cultivar' : undefined),
    imageUrl: recordDefault ? recordDefault.imageUrl : input.imageUrl,
    thumbnailUrl: recordDefault ? photoUrl(recordDefault) : input.thumbnailUrl,
    cultivarImageUrl: cultivarDefault ? cultivarDefault.imageUrl : input.cultivarImageUrl,
    cultivarThumbnailUrl: cultivarDefault ? photoUrl(cultivarDefault) : input.cultivarThumbnailUrl,
  }
}

function photosWithLegacy(input: DahliaRecordInput, scope: 'record' | 'cultivar') {
  const photos = scope === 'record' ? input.recordPhotos ?? [] : input.cultivarPhotos ?? []
  const imageUrl = scope === 'record' ? input.imageUrl : input.cultivarImageUrl
  const thumbnailUrl = scope === 'record' ? input.thumbnailUrl : input.cultivarThumbnailUrl
  if (!imageUrl || photos.some((photo) => photo.imageUrl === imageUrl)) return photos

  return uniquePhotos([
    {
      id: `legacy-${scope}`,
      imageUrl,
      thumbnailUrl: thumbnailUrl || imageUrl,
      scope,
    },
    ...photos,
  ])
}

function copiedPhoto(photo: DahliaPhoto, scope: 'record' | 'cultivar'): DahliaPhoto {
  return {
    ...photo,
    id: `${scope}-copy-${Date.now()}`,
    scope,
    createdAt: new Date().toISOString(),
  }
}

function formatLocation(record: DahliaRecord) {
  const state = record.meta?.plantingState ?? 'purchased_container'
  if (state === 'purchased_container') return 'Purchased Container'
  if (state === 'garden_tray') return 'Garden Tray'
  if (state === 'not_planted') return 'Not Planted'
  if (state === 'not_viable') return 'Not Viable'

  const zone = record.meta?.gardenZone ?? record.meta?.gardenArea
  const rowOrBed = record.meta?.rowOrBed ?? record.meta?.gardenRow
  const position = record.meta?.position ?? record.meta?.gardenPosition
  const rowAndPosition = rowOrBed && position ? `${rowOrBed}${position}` : record.gardenLocation
  return [zone, rowAndPosition].filter(Boolean).join(' - ') || 'In Garden'
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="modalOverlay">
      <div className="modal">
        {children}
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  required,
  value,
  onChange,
  placeholder,
  type,
  readOnly,
  disabled,
  step,
  inputClassName,
  tabIndex,
  labelAction,
}: {
  label: string
  hint?: string
  required?: boolean
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  type?: 'text' | 'number' | 'date'
  readOnly?: boolean
  disabled?: boolean
  step?: string
  inputClassName?: string
  tabIndex?: number
  labelAction?: React.ReactNode
}) {
  const input = (
    <input
      className={`input${inputClassName ? ` ${inputClassName}` : ''}`}
      value={value}
      placeholder={placeholder}
      type={type ?? 'text'}
      step={step}
      readOnly={readOnly}
      disabled={disabled}
      tabIndex={tabIndex}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )

  if (labelAction) {
    return (
      <div className="field">
        <FieldLabel label={label} hint={hint} required={required} action={labelAction} />
        {input}
      </div>
    )
  }

  return (
    <label className="field">
      <FieldLabel label={label} hint={hint} required={required} />
      {input}
    </label>
  )
}

function FieldLabel({ label, hint, required, action }: { label: string; hint?: string; required?: boolean; action?: React.ReactNode }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!visible) return
    const timeout = window.setTimeout(() => setVisible(false), 3000)
    return () => window.clearTimeout(timeout)
  }, [visible])

  function showHint() {
    setVisible(false)
    window.requestAnimationFrame(() => setVisible(true))
  }

  function hideHint() {
    setVisible(false)
  }

  return (
    <div className="label fieldLabel">
      {action ?? <span>{label}</span>}
      {required ? <span className="requiredMark" aria-label="required">*</span> : null}
      {hint ? (
        <button
          className={`helpIcon${visible ? ' show' : ''}`}
          type="button"
          aria-label={`${label} hint`}
          onMouseEnter={showHint}
          onMouseLeave={hideHint}
          onFocus={showHint}
          onBlur={hideHint}
          onClick={showHint}
        >
          ?
          {visible ? <span className="helpTooltip recordFieldTooltip" role="tooltip">{hint}</span> : null}
        </button>
      ) : null}
    </div>
  )
}

function TextArea({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="field">
      <FieldLabel label={label} hint={hint} />
      <textarea className="textarea" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="field">
      <FieldLabel label={label} hint={hint} />
      <button
        className={`switchToggle${value ? ' on' : ''}`}
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
      >
        <span className="switchTrack" aria-hidden="true">
          <span className="switchLabel">{value ? 'Yes' : 'No'}</span>
          <span className="switchThumb" />
        </span>
      </button>
    </div>
  )
}

export function RecordModal({
  mode,
  initial,
  draft,
  records,
  recordSummaries,
  onClose,
  onSave,
  onSetRecordPhotoDefault,
  onSaveCultivarPhoto,
  onSetCultivarPhotoDefault,
  onDeleteCultivarPhoto,
  onDelete,
  onDuplicate,
  onOpenRecord,
  onReview,
  onProposeCorrection,
  onApplyCorrection,
  reviewResult,
  correctionResult,
  reviewBusy = false,
  correctionBusy = false,
  onUploadPhoto,
  onCreateCompany,
  onOpenCompanies,
  onOpenGardenOptions,
  onOpenFlowerNames,
  onOpenColors,
  gardenOptions = DEFAULT_GARDEN_OPTIONS,
  companies = [],
  orders = [],
  flowerNames = [],
  colors = [],
  gardenId,
}: {
  mode: 'view' | 'create'
  initial: DahliaRecord | null
  draft?: DahliaRecordInput | null
  records?: DahliaRecord[]
  recordSummaries?: DahliaRecordSummary[]
  onClose: () => void
  onSave: (input: DahliaRecordInput, options?: { keepOpen?: boolean; skipRefresh?: boolean }) => void | Promise<void>
  onSetRecordPhotoDefault?: (photo: DahliaPhoto) => void | Promise<void>
  onSaveCultivarPhoto?: (photo: { cultivarImageUrl: string; cultivarThumbnailUrl?: string; photo?: DahliaPhoto }) => void | Promise<void>
  onSetCultivarPhotoDefault?: (photo: DahliaPhoto) => void | Promise<void>
  onDeleteCultivarPhoto?: (imageUrl: string) => void | Promise<void>
  onDelete?: () => void | Promise<void>
  onDuplicate?: (record: DahliaRecord) => void | Promise<void>
  onOpenRecord?: (record: DahliaRecord) => void
  onReview?: (record: DahliaRecordInput) => void | Promise<void>
  onProposeCorrection?: (record: DahliaRecordInput, userCorrection: string) => void | Promise<void>
  onApplyCorrection?: (record: DahliaRecordInput) => void | Promise<void>
  reviewResult?: AgentReviewResult | null
  correctionResult?: AgentCorrectionResult | null
  reviewBusy?: boolean
  correctionBusy?: boolean
  onUploadPhoto?: (file: File) => Promise<{ imageUrl: string; thumbnailUrl?: string }>
  onCreateCompany?: (input: CompanyInput) => Promise<Company>
  onOpenCompanies?: () => void
  onOpenGardenOptions?: (group: GardenOptionKey) => void
  onOpenFlowerNames?: () => void
  onOpenColors?: () => void
  gardenOptions?: GardenOptions
  companies?: Company[]
  orders?: Order[]
  flowerNames?: string[]
  colors?: string[]
  gardenId?: string
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const galleriesFileInputRef = useRef<HTMLInputElement | null>(null)
  const confirmAreaRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    core: true,
    growth: false,
    care: false,
    tuber: false,
    storage: false,
    health: false,
    varieties: false,
    meta: false,
    photos: false,
  })

  const [form, setForm] = useState<DahliaRecordInput>(() => {
    return inputWithNormalizedBloomWidth(inputFromInitialRecord(initial, draft))
  })
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoConverting, setPhotoConverting] = useState(false)
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false)
  const [viewerPhotoUrl, setViewerPhotoUrl] = useState<string | null>(null)
  const [galleriesOpen, setGalleriesOpen] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [photoLoadError, setPhotoLoadError] = useState(false)
  const [photoScope, setPhotoScope] = useState<'cultivar' | 'record'>('cultivar')
  const [identifyBusy, setIdentifyBusy] = useState(false)
  const [identifyError, setIdentifyError] = useState<string | null>(null)
  const [identifyResult, setIdentifyResult] = useState<AgentPhotoIdentificationResult | null>(null)
  const [dirtyPhotoSection, setDirtyPhotoSection] = useState<'record' | 'cultivar' | null>(null)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [missedIssueText, setMissedIssueText] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletedInheritedCultivarUrls, setDeletedInheritedCultivarUrls] = useState<string[]>([])
  const [initialSnapshot, setInitialSnapshot] = useState(() => normalizeInputForComparison(inputFromInitialRecord(initial, draft)))

  const title = mode === 'create' ? 'New Record' : `${form.flowerName || initial?.flowerName || 'Record'} [#${initial?.recordNumber ?? ''}]`
  const gardenArea = form.meta.gardenZone ?? form.meta.gardenArea ?? ''
  const gardenRow = form.meta.rowOrBed ?? form.meta.gardenRow ?? ''
  const positionValue = form.meta.position ?? form.meta.gardenPosition
  const gardenPosition = positionValue ? String(positionValue) : ''
  const selectedGardenZoneOption = gardenOptions.gardenZones.find((zone) => zone.name === gardenArea)
  const availableGardenRows = selectedGardenZoneOption?.rows.map((row) => row.name) ?? []
  const plantingState = form.meta.plantingState
  const notPlantedReason = form.meta.notPlantedReason ?? 'not_received'
  const notViableReason = form.meta.notViableReason ?? 'no_longer_present'
  const customSourceCompany = form.tuber.source ?? ''
  const customSourceCompanyMatch = findCompanyNameMatch(companies, customSourceCompany)
  const selectedSourceCompany = customSourceCompanyMatch ?? customSourceCompany
  const selectedGardenKey = getGardenKey(gardenRow, positionValue)
  const usedGardenKeys = useMemo(() => {
    const keys = new Set<string>()
    ;[...(records ?? []), ...(recordSummaries ?? [])].forEach((record) => {
      if (record.id === initial?.id) return
      if (record.meta?.plantingState !== 'in_garden') return
      if (record.seasonYearStart !== form.seasonYearStart) return

      const key = getGardenKey(record.meta?.rowOrBed ?? record.meta?.gardenRow, record.meta?.position ?? record.meta?.gardenPosition)
      if (key) keys.add(key)
    })
    return keys
  }, [form.seasonYearStart, initial?.id, recordSummaries, records])
  const gardenLocationInUse = Boolean(selectedGardenKey && usedGardenKeys.has(selectedGardenKey))

  const knownFlowerNames = useMemo(() => {
    const fromRecords = (records ?? []).map((r) => r.flowerName)
    const merged = new Set([...flowerNames, ...fromRecords].filter(Boolean))
    return [...merged].sort((a, b) => a.localeCompare(b))
  }, [flowerNames, records])

  const knownColors = useMemo(() => {
    const fromRecords = (records ?? []).map((r) => r.core?.color).filter((c): c is string => Boolean(c))
    const merged = new Set([...colors, ...fromRecords].filter(Boolean))
    return [...merged].sort((a, b) => a.localeCompare(b))
  }, [colors, records])

  const canSave = useMemo(() => {
    const hasPlantingState = plantingState !== undefined
    const hasRequiredStateDetails = plantingState === 'in_garden'
      ? gardenArea.length > 0 && gardenRow.length > 0 && gardenPosition.length > 0 && !gardenLocationInUse
      : true

    return form.flowerName.trim().length > 0 && hasPlantingState && hasRequiredStateDetails && Number.isFinite(form.seasonYearStart)
  }, [form.flowerName, gardenArea, gardenLocationInUse, gardenPosition, gardenRow, plantingState, form.seasonYearStart])

  const hasChanges = useMemo(() => {
    return photoFile !== null || normalizeInputForComparison(form) !== initialSnapshot
  }, [form, initialSnapshot, photoFile])

  useEffect(() => {
    if (initial) {
      const original = recordToInput(initial)
      const next = inputWithNormalizedBloomWidth(original)
      setForm(next)
      setInitialSnapshot(normalizeInputForComparison(original))
      setDeletedInheritedCultivarUrls([])
      setDirtyPhotoSection(null)
    }
  }, [initial])

  useEffect(() => {
    if (!confirmAction) return

    function clearOnOutsidePointer(event: PointerEvent) {
      if (!confirmAreaRef.current?.contains(event.target as Node)) {
        setConfirmAction(null)
      }
    }

    document.addEventListener('pointerdown', clearOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', clearOnOutsidePointer)
  }, [confirmAction])

  function handleCloseRequest() {
    if (hasChanges) {
      setCloseError('Save or discard your unsaved changes before closing.')
      return
    }
    onClose()
  }

  async function selectPhoto(file: File | undefined) {
    if (!file) return
    const isHeic = file.type === 'image/heic' || file.type === 'image/heif' || /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name)
    if (!file.type.startsWith('image/') && !isHeic) {
      setPhotoError('Please select an image file.')
      return
    }

    setPhotoError(null)

    if (isHeic) {
      setPhotoConverting(true)
      try {
        const { heicTo } = await import('heic-to')
        const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 })
        const convertedName = file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg')
        const convertedFile = new File([jpeg], convertedName, { type: 'image/jpeg' })
        setPhotoFile(convertedFile)
        setPhotoPreview((previous) => {
          if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous)
          return URL.createObjectURL(jpeg)
        })
      } catch {
        setPhotoError('Could not convert HEIC file. Please try a different photo format.')
      } finally {
        setPhotoConverting(false)
      }
      return
    }

    setPhotoFile(file)
    setPhotoPreview((previous) => {
      if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous)
      return URL.createObjectURL(file)
    })
  }

  async function submitIdentifyPhoto() {
    if (identifyBusy) return

    setIdentifyBusy(true)
    setIdentifyError(null)
    try {
      const out = photoFile
        ? await identifyPhoto({ file: photoFile })
        : await identifyPhoto({ imageUrl: currentViewerPhoto })
      setIdentifyResult(out)
    } catch (e: any) {
      setIdentifyError(e?.message ?? String(e))
    } finally {
      setIdentifyBusy(false)
    }
  }

  function cancelPhotoSelection() {
    setPhotoFile(null)
    setPhotoPreview((previous) => {
      if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous)
      return null
    })
    setPhotoError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (galleriesFileInputRef.current) galleriesFileInputRef.current.value = ''
  }

  function setGardenArea(value: string | undefined) {
    setConfirmAction(null)
    setForm((previous) => ({
      ...previous,
      meta: {
        ...previous.meta,
        gardenArea: value,
        gardenZone: value,
        gardenRow: undefined,
        rowOrBed: undefined,
        gardenPosition: undefined,
        position: undefined,
      },
    }))
  }

  function setGardenRow(value: string | undefined) {
    setConfirmAction(null)
    setForm((previous) => ({
      ...previous,
      meta: {
        ...previous.meta,
        gardenRow: value,
        rowOrBed: value,
        gardenPosition: undefined,
        position: undefined,
      },
    }))
  }

  function setGardenPosition(value: string | undefined) {
    setConfirmAction(null)
    const position = value ? Number(value) : undefined
    setForm((previous) => ({
      ...previous,
      meta: {
        ...previous.meta,
        gardenPosition: position,
        position,
      },
    }))
  }

  function setPlantingState(value: string | undefined) {
    setConfirmAction(null)
    const nextState = value as PlantingState | undefined
    setForm((previous) => ({
      ...previous,
      meta: {
        ...previous.meta,
        plantingState: nextState,
        gardenArea: nextState === 'in_garden' ? previous.meta.gardenZone ?? previous.meta.gardenArea ?? 'Main Garden' : previous.meta.gardenArea,
        gardenZone: nextState === 'in_garden' ? previous.meta.gardenZone ?? previous.meta.gardenArea ?? 'Main Garden' : previous.meta.gardenZone,
        notPlantedReason: nextState === 'not_planted' ? previous.meta.notPlantedReason ?? 'not_received' : undefined,
        notViableReason: nextState === 'not_viable' ? previous.meta.notViableReason ?? 'no_longer_present' : undefined,
      },
    }))
  }

  function setNotPlantedReason(value: NotPlantedReason) {
    setConfirmAction(null)
    setForm((previous) => ({
      ...previous,
      meta: {
        ...previous.meta,
        plantingState: 'not_planted',
        notPlantedReason: value,
      },
    }))
  }

  function setNotViableReason(value: NotViableReason) {
    setConfirmAction(null)
    setForm((previous) => ({
      ...previous,
      meta: {
        ...previous.meta,
        plantingState: 'not_viable',
        notViableReason: value,
      },
    }))
  }

  function setSeasonYearStart(value: string) {
    setConfirmAction(null)
    setForm((previous) => ({ ...previous, seasonYearStart: Number(value || 0) }))
  }

  function setSourceCompany(value: string | undefined) {
    setConfirmAction(null)
    setForm((previous) => ({ ...previous, tuber: { ...previous.tuber, source: value } }))
  }

  async function handleReviewClick() {
    if (!onReview) return
    if (confirmAction !== 'review') {
      setConfirmAction('review')
      return
    }
    setConfirmAction(null)
    await onReview(inputWithGardenLocation(form))
  }

  async function handleDeleteClick() {
    if (!onDelete) return
    if (confirmAction !== 'delete') {
      setConfirmAction('delete')
      return
    }
    setConfirmAction(null)
    await onDelete()
  }

  function handleDuplicateClick() {
    if (!initial || !onDuplicate) return
    if (confirmAction !== 'duplicate') {
      setConfirmAction('duplicate')
      return
    }
    setConfirmAction(null)
    onDuplicate(initial)
  }

  function handleVarietyRecordClick(record: DahliaRecord) {
    if (record.id === initial?.id || !onOpenRecord) return
    if (hasChanges) {
      setCloseError('Save or discard your unsaved changes before switching records.')
      return
    }
    setCloseError(null)
    setConfirmAction(null)
    onOpenRecord(record)
  }

  async function handleProposeCorrection() {
    if (!onProposeCorrection || missedIssueText.trim().length === 0) return
    await onProposeCorrection(inputWithGardenLocation(form), missedIssueText)
  }

  async function handleApplyCorrection() {
    if (!onApplyCorrection || !correctionResult) return
    const next = mergeRecordPatch(inputWithGardenLocation(form), correctionResult.recordPatch)
    setForm(next)
    await onApplyCorrection(next)
  }

  async function savePhotoState(next: DahliaRecordInput, dirtySection: 'record' | 'cultivar') {
    setForm(next)
    setDirtyPhotoSection(dirtySection)
    setSaving(true)
    setPhotoError(null)
    try {
      await onSave(next, { keepOpen: true })
      setDirtyPhotoSection(null)
      setInitialSnapshot(normalizeInputForComparison(next))
    } catch (e: any) {
      setPhotoError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  function isGardenOptionInUse(row: string | undefined, position: number | undefined) {
    const key = getGardenKey(row, position)
    return Boolean(key && usedGardenKeys.has(key))
  }

  async function deletePhotos(photos: DahliaPhoto[], scope: 'record' | 'cultivar') {
    setPhotoError(null)
    if (!photos.length) return
    if (scope === 'cultivar' && onDeleteCultivarPhoto && initial) {
      setSaving(true)
      setDeletedInheritedCultivarUrls((previous) => Array.from(new Set([...previous, ...photos.map((photo) => photo.imageUrl)])))
      try {
        for (const photo of photos) {
          await onDeleteCultivarPhoto(photo.imageUrl)
        }
      } catch (e: any) {
        setPhotoError(e?.message ?? String(e))
      } finally {
        setSaving(false)
      }
      return
    }

    const deletedIds = new Set(photos.map((photo) => photo.id))
    const deletedUrls = new Set(photos.map((photo) => photo.imageUrl))
    if (scope === 'record') {
      const remaining = (form.recordPhotos ?? []).filter((existing) => !deletedIds.has(existing.id) && !deletedUrls.has(existing.imageUrl))
      const nextDefault = form.defaultRecordPhotoId && deletedIds.has(form.defaultRecordPhotoId) ? remaining[0]?.id : form.defaultRecordPhotoId
      await savePhotoState(withResolvedPhotoFields({ ...form, recordPhotos: remaining, defaultRecordPhotoId: nextDefault, imageUrl: form.imageUrl && deletedUrls.has(form.imageUrl) ? undefined : form.imageUrl, thumbnailUrl: form.imageUrl && deletedUrls.has(form.imageUrl) ? undefined : form.thumbnailUrl }), 'record')
      return
    }

    setDeletedInheritedCultivarUrls((urls) => Array.from(new Set([...urls, ...deletedUrls])))
    const remaining = (form.cultivarPhotos ?? []).filter((existing) => !deletedIds.has(existing.id) && !deletedUrls.has(existing.imageUrl))
    const nextDefault = form.defaultCultivarPhotoId && deletedIds.has(form.defaultCultivarPhotoId) ? remaining[0]?.id : form.defaultCultivarPhotoId
    await savePhotoState(withResolvedPhotoFields({ ...form, cultivarPhotos: remaining, defaultCultivarPhotoId: nextDefault, cultivarImageUrl: form.cultivarImageUrl && deletedUrls.has(form.cultivarImageUrl) ? undefined : form.cultivarImageUrl, cultivarThumbnailUrl: form.cultivarImageUrl && deletedUrls.has(form.cultivarImageUrl) ? undefined : form.cultivarThumbnailUrl }), 'cultivar')
  }

  async function copyPhotosToScope(photos: DahliaPhoto[], targetScope: 'record' | 'cultivar') {
    setPhotoError(null)
    if (!photos.length) return
    const nextPhotos = photos.map((photo) => copiedPhoto(photo, targetScope))

    if (targetScope === 'cultivar' && onSaveCultivarPhoto && initial) {
      setSaving(true)
      try {
        const next = withResolvedPhotoFields({
          ...form,
          cultivarPhotos: [...nextPhotos, ...cultivarPhotos],
          defaultCultivarPhotoId: form.defaultCultivarPhotoId || nextPhotos[0]?.id,
          defaultPhotoScope: form.defaultPhotoScope || 'cultivar',
        })
        setForm(next)
        for (const photo of nextPhotos) {
          await onSaveCultivarPhoto({
            cultivarImageUrl: photo.imageUrl,
            cultivarThumbnailUrl: photo.thumbnailUrl,
            photo,
          })
        }
        setDirtyPhotoSection(null)
      } catch (e: any) {
        setPhotoError(e?.message ?? String(e))
      } finally {
        setSaving(false)
      }
      return
    }

    if (targetScope === 'record') {
      await savePhotoState(withResolvedPhotoFields({
        ...form,
        recordPhotos: [...nextPhotos, ...(form.recordPhotos ?? [])],
        defaultRecordPhotoId: form.defaultRecordPhotoId || nextPhotos[0]?.id,
        defaultPhotoScope: form.defaultPhotoScope || 'record',
      }), 'record')
      return
    }

    await savePhotoState(withResolvedPhotoFields({
      ...form,
      cultivarPhotos: [...nextPhotos, ...cultivarPhotos],
      defaultCultivarPhotoId: form.defaultCultivarPhotoId || nextPhotos[0]?.id,
      defaultPhotoScope: form.defaultPhotoScope || 'cultivar',
    }), 'cultivar')
  }

  async function setCultivarDefault(photo: DahliaPhoto, applyToAll: boolean) {
    setDirtyPhotoSection('cultivar')
    const next = withResolvedPhotoFields({ ...form, cultivarPhotos, defaultCultivarPhotoId: photo.id, defaultPhotoScope: 'cultivar' })

    if (!applyToAll || !onSetCultivarPhotoDefault) {
      await savePhotoState(next, 'cultivar')
      return
    }

    setForm(next)

    setSaving(true)
    setPhotoError(null)
    try {
      await onSetCultivarPhotoDefault(photo)
      setDirtyPhotoSection(null)
      setInitialSnapshot(normalizeInputForComparison(next))
    } catch (e: any) {
      setPhotoError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  async function setRecordDefault(photo: DahliaPhoto) {
    setDirtyPhotoSection('record')
    const next = withResolvedPhotoFields({ ...form, defaultRecordPhotoId: photo.id, defaultPhotoScope: 'record' })
    setForm(next)

    if (!onSetRecordPhotoDefault) {
      await savePhotoState(next, 'record')
      return
    }

    setSaving(true)
    setPhotoError(null)
    try {
      await onSetRecordPhotoDefault(photo)
      setDirtyPhotoSection(null)
      setInitialSnapshot(normalizeInputForComparison(next))
    } catch (e: any) {
      setPhotoError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleSave(options?: { keepOpen?: boolean; dirtyPhotoSection?: 'record' | 'cultivar' | null }) {
    setSaving(true)
    setPhotoError(null)
    try {
      if (plantingState === 'in_garden' && gardenLocationInUse) {
        throw new Error('That garden location is already assigned to another record.')
      }

      let next: DahliaRecordInput = {
        ...inputWithGardenLocation(form),
        core: {
          ...form.core,
          cultivar: form.core.cultivar?.trim() ? form.core.cultivar : form.flowerName,
        },
      }
      const source = next.tuber.source?.trim()
      if (source) {
        const matchedCompanyName = findCompanyNameMatch(companies, source)
        if (matchedCompanyName) {
          next = { ...next, tuber: { ...next.tuber, source: matchedCompanyName } }
        } else {
          if (!onCreateCompany) throw new Error('Company creation is not configured.')
          const company = await onCreateCompany({ name: normalizeCompanyName(source) })
          next = { ...next, tuber: { ...next.tuber, source: company.name } }
        }
        setForm(next)
      }
      const ownCultivarPhotos = uniquePhotos(next.cultivarPhotos ?? [])
      const ownRecordPhotos = photosWithLegacy(next, 'record')
      const scopedDefaultValid =
        (next.defaultPhotoScope === 'cultivar' && ownCultivarPhotos.some((p) => p.id === next.defaultCultivarPhotoId)) ||
        (next.defaultPhotoScope === 'record' && ownRecordPhotos.some((p) => p.id === next.defaultRecordPhotoId))
      if (!scopedDefaultValid) {
        const byAge = (a: DahliaPhoto, b: DahliaPhoto) => (a.createdAt ?? 'z').localeCompare(b.createdAt ?? 'z')
        const oldestCultivar = [...ownCultivarPhotos].sort(byAge)[0]
        const oldestRecord = [...ownRecordPhotos].sort(byAge)[0]
        if (oldestCultivar) {
          next = { ...next, defaultCultivarPhotoId: oldestCultivar.id, defaultPhotoScope: 'cultivar' }
        } else if (oldestRecord) {
          next = { ...next, defaultRecordPhotoId: oldestRecord.id, defaultPhotoScope: 'record' }
        }
      }
      let uploadedPhoto: DahliaPhoto | undefined
      if (photoFile) {
        if (!onUploadPhoto) throw new Error('Photo uploads are not configured.')
        const uploaded = await onUploadPhoto(photoFile)
        uploadedPhoto = {
          id: `${photoScope}-${Date.now()}`,
          imageUrl: uploaded.imageUrl,
          thumbnailUrl: uploaded.thumbnailUrl ?? uploaded.imageUrl,
          scope: photoScope,
          createdAt: new Date().toISOString(),
        }
        next = photoScope === 'cultivar'
          ? withResolvedPhotoFields({ ...next, cultivarPhotos: [uploadedPhoto, ...(next.cultivarPhotos ?? [])], defaultCultivarPhotoId: next.defaultCultivarPhotoId || uploadedPhoto.id, defaultPhotoScope: next.defaultPhotoScope || 'cultivar' })
          : withResolvedPhotoFields({ ...next, recordPhotos: [uploadedPhoto, ...(next.recordPhotos ?? [])], defaultRecordPhotoId: next.defaultRecordPhotoId || uploadedPhoto.id, defaultPhotoScope: next.defaultPhotoScope || 'record' })
        setForm(next)
      }
      if (uploadedPhoto && photoScope === 'cultivar' && initial && onSaveCultivarPhoto) {
        const propagatedPhoto = next.cultivarPhotos?.find((photo) => photo.imageUrl === uploadedPhoto.imageUrl) ?? uploadedPhoto
        await onSaveCultivarPhoto({
          cultivarImageUrl: propagatedPhoto.imageUrl,
          cultivarThumbnailUrl: propagatedPhoto.thumbnailUrl,
          photo: propagatedPhoto,
        })
      } else if (options?.keepOpen && initial) {
        await onSave(next, { keepOpen: true })
      } else {
        await onSave(next)
      }
      setPhotoFile(null)
      setPhotoPreview((previous) => {
        if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous)
        return null
      })
      if (options?.dirtyPhotoSection !== undefined && dirtyPhotoSection === options.dirtyPhotoSection) {
        setDirtyPhotoSection(null)
      }
    } catch (e: any) {
      setPhotoError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const inheritedCultivarPhoto = useMemo(() => {
    const key = varietyKey(form)
    if (!key) return ''

    const matchingRecord = (records ?? []).find((record) => varietyKey(record) === key && (record.cultivarThumbnailUrl || record.cultivarImageUrl) && !deletedInheritedCultivarUrls.includes(record.cultivarImageUrl ?? ''))
    return matchingRecord?.cultivarThumbnailUrl ?? matchingRecord?.cultivarImageUrl ?? ''
  }, [deletedInheritedCultivarUrls, form, records])
  const inheritedCultivarPhotos = ((records ?? []).find((record) => record.id !== initial?.id && varietyKey(record) === varietyKey(form) && record.cultivarPhotos?.length)?.cultivarPhotos ?? []).filter((photo) => !deletedInheritedCultivarUrls.includes(photo.imageUrl))
  const recordPhotos = photosWithLegacy(form, 'record')
  const cultivarPhotos = photosWithLegacy({ ...form, cultivarPhotos: uniquePhotos([...(form.cultivarPhotos ?? []), ...inheritedCultivarPhotos]) }, 'cultivar')
  const resolvedRecordDefaultPhotoId = resolvedDefaultPhotoId(recordPhotos, form.defaultRecordPhotoId, form.imageUrl)
  const resolvedCultivarDefaultPhotoId = resolvedDefaultPhotoId(cultivarPhotos, form.defaultCultivarPhotoId, form.cultivarImageUrl)
  const currentResolvedPhoto = resolvedScopedCurrentPhoto(recordPhotos, cultivarPhotos, resolvedRecordDefaultPhotoId, resolvedCultivarDefaultPhotoId, form.defaultPhotoScope)
  const overallRecordDefaultPhotoId = form.defaultPhotoScope === 'record' ? currentResolvedPhoto?.id : undefined
  const overallCultivarDefaultPhotoId = form.defaultPhotoScope === 'cultivar' ? currentResolvedPhoto?.id : undefined
  const currentPhoto = photoPreview ?? (photoUrl(currentResolvedPhoto) || form.thumbnailUrl || form.imageUrl || form.cultivarThumbnailUrl || form.cultivarImageUrl || inheritedCultivarPhoto)
  const currentViewerPhoto = photoPreview ?? (fullPhotoUrl(currentResolvedPhoto) || form.imageUrl || form.thumbnailUrl || form.cultivarImageUrl || form.cultivarThumbnailUrl || inheritedCultivarPhoto)

  useEffect(() => {
    setPhotoLoadError(false)
  }, [currentPhoto])
  const linkedOrderItemIds = form.tuber.linkedOrderItemIds ?? []
  const allAssignedOrderItemIds = useMemo(() => {
    const ids = new Set<string>(linkedOrderItemIds)
    for (const record of [...(recordSummaries ?? []), ...(records ?? [])]) {
      if (record.id === initial?.id) continue
      for (const id of record.tuber?.linkedOrderItemIds ?? []) {
        ids.add(id)
      }
    }
    return ids
  }, [linkedOrderItemIds, recordSummaries, records, initial?.id])
  const linkedOrderRows = orders.flatMap((order) =>
    order.items
      .filter((item) => linkedOrderItemIds.includes(item.id))
      .map((item) => ({ order, item })),
  )
  const invoiceItemCompanyFilter = selectedSourceCompany ? normalizeCompanyKey(selectedSourceCompany) : ''
  const availableInvoiceItems = orders.flatMap((order) =>
    order.items
      .filter((item) =>
        (!item.gardenId || !gardenId || item.gardenId === gardenId) &&
        !allAssignedOrderItemIds.has(item.id) &&
        (!invoiceItemCompanyFilter || normalizeCompanyKey(order.company?.name ?? '') === invoiceItemCompanyFilter)
      )
      .map((item) => ({
        value: item.id,
        label: `${order.company?.name ?? 'Company'}${order.invoiceNumber ? ` - ${order.invoiceNumber}` : ''} - ${item.flowerName}`,
      }))
  )
  const invoiceItemsCompanyFiltered = Boolean(invoiceItemCompanyFilter)
  const invoiceItemsEmpty = invoiceItemsCompanyFiltered && availableInvoiceItems.length === 0
  const relatedVarietyRecords = useMemo(() => {
    if (!initial) return []
    const key = varietyKey(form)
    if (!key) return []

    return (records ?? [])
      .filter((record) => varietyKey(record) === key)
      .sort((a, b) => (a.recordNumber ?? 0) - (b.recordNumber ?? 0))
  }, [form, initial, records])

  return (
    <Overlay>
      <div className="modalHeader">
        <div>
          <div className="modalTitle">{title}</div>
          <div className="modalSub">Core is expanded by default; other categories are collapsible.</div>
        </div>
        <button className="btn ghost" onClick={handleCloseRequest}>
          Close
        </button>
      </div>

      <div className="modalBody">
        <div className="sections">
          <div className="section">
            <button
              className="sectionHead"
              onClick={() => setOpen((p) => ({ ...p, core: !p.core }))}
              type="button"
            >
              <span>{sectionTitle('core')}</span>
              <span className="chev">{open.core ? '▾' : '▸'}</span>
            </button>

            {open.core ? (
              <div className="sectionBody">
                <div className="grid4">
                  <div className="gridSpan2">
                    <FlowerNameField
                      label="Flower Name"
                      hint="The primary display name for this dahlia record."
                      required
                      value={form.flowerName}
                      knownFlowerNames={knownFlowerNames}
                      onChange={(v) => setForm((p) => ({
                        ...p,
                        flowerName: v,
                        core: {
                          ...p.core,
                          cultivar: p.core.cultivar === p.flowerName ? v : p.core.cultivar,
                        },
                      }))}
                      placeholder="e.g. Cafe au Lait"
                      labelAction={onOpenFlowerNames ? (
                        <button className="labelLink" type="button" onClick={onOpenFlowerNames}>
                          Flower Name
                        </button>
                      ) : undefined}
                    />
                  </div>
                  <div className="gridSpan2">
                    <Field label="Season" hint="The growing season year for this record." required type="number" value={String(form.seasonYearStart)} onChange={setSeasonYearStart} />
                  </div>
                  <DahliaPickerField
                    label="Planting State"
                    hint="Where this specific tuber or plant is currently being tracked."
                    required
                    clearable={false}
                    options={PLANTING_STATES}
                    value={plantingState}
                    onChange={setPlantingState}
                  />
                  {plantingState === 'not_planted' ? (
                    <div className="field gridSpan3">
                      <FieldLabel label="Not Planted Reason" hint="Why this dahlia is tracked but not planted." />
                      <div className="radioRow">
                        {NOT_PLANTED_REASONS.map((option) => (
                          <label key={option.value} className="radioOption">
                            <input
                              type="radio"
                              name="notPlantedState"
                              value={option.value}
                              checked={notPlantedReason === option.value}
                              onChange={() => setNotPlantedReason(option.value)}
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {plantingState === 'not_viable' ? (
                    <div className="field gridSpan3">
                      <FieldLabel label="Not Viable Reason" hint="Why this dahlia is no longer viable." />
                      <div className="radioRow">
                        {NOT_VIABLE_REASONS.map((option) => (
                          <label key={option.value} className="radioOption">
                            <input
                              type="radio"
                              name="notViableState"
                              value={option.value}
                              checked={notViableReason === option.value}
                              onChange={() => setNotViableReason(option.value)}
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {plantingState === 'in_garden' ? (
                    <>
                      <DahliaPickerField
                        label="Zone"
                        hint="The zone or section where this dahlia is planted."
                        required
                        value={gardenArea || undefined}
                        options={gardenOptions.gardenAreas}
                        onChange={setGardenArea}
                        labelAction={onOpenGardenOptions ? (
                          <button className="labelLink" type="button" onClick={() => onOpenGardenOptions('gardenAreas')}>
                            Zone
                          </button>
                        ) : undefined}
                      />
                      <DahliaPickerField
                        label="Row/Bed"
                        hint="Row or bed labels available for planted records."
                        required
                        value={gardenRow || undefined}
                        options={availableGardenRows}
                        disabled={!gardenArea}
                        onChange={setGardenRow}
                        labelAction={onOpenGardenOptions ? (
                          <button className="labelLink" type="button" onClick={() => onOpenGardenOptions('gardenRows')}>
                            Row/Bed
                          </button>
                        ) : undefined}
                      />
                      <DahliaPickerField
                        label="Position"
                        hint="Position labels available inside each row or bed."
                        required
                        value={gardenPosition || undefined}
                        options={gardenOptions.gardenPositions.map((position) => ({
                          value: position,
                          label: position,
                          disabled: isGardenOptionInUse(gardenRow, Number(position)),
                        }))}
                        disabled={!gardenRow}
                        onChange={setGardenPosition}
                        labelAction={onOpenGardenOptions ? (
                          <button className="labelLink" type="button" onClick={() => onOpenGardenOptions('gardenPositions')}>
                            Position
                          </button>
                        ) : undefined}
                      />
                      {gardenLocationInUse ? <div className="error inlineError gridSpanFull">That garden location is already assigned to another record.</div> : null}
                    </>
                  ) : null}
                </div>
                <div className="grid2">
                  <Field label="Cultivar" hint="The cultivar name. If blank, Flower Name is used when saving." value={form.core.cultivar ?? ''} onChange={(v) => setForm((p) => ({ ...p, core: { ...p.core, cultivar: v } }))} />
                  <Field label="Planted Date" hint="Date planted. This may be earlier than the current season year for overwintered or moved plants." type="date" value={form.core.plantedDate ?? plantedDateForYear(form.seasonYearStart)} onChange={(v) => setForm((p) => ({ ...p, core: { ...p.core, plantedDate: v } }))} />
                  <ColorField
                    label="Color"
                    hint="Main bloom color or color description."
                    value={form.core.color ?? ''}
                    knownColors={knownColors}
                    onChange={(v) => setForm((p) => ({ ...p, core: { ...p.core, color: v } }))}
                    labelAction={onOpenColors ? (
                      <button className="labelLink" type="button" onClick={onOpenColors}>
                        Color
                      </button>
                    ) : undefined}
                  />
                  <DahliaPickerField label="Form" title="Bloom Form" hint="Bloom form, such as decorative, ball, cactus, or anemone." options={DAHLIA_FORM_OPTIONS} value={form.core.form} onChange={(v) => setForm((p) => ({ ...p, core: { ...p.core, form: v } }))} />
                </div>
                <TextArea label="Notes" hint="General notes about the dahlia, bloom, or record." value={form.core.notes ?? ''} onChange={(v) => setForm((p) => ({ ...p, core: { ...p.core, notes: v } }))} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="photoField photosSection">
          <button
            className="photosSectionHeader"
            type="button"
            onClick={() => setOpen((previous) => ({ ...previous, photos: !previous.photos }))}
          >
            <div className="photosSectionTitle">Photos</div>
            <span className="chev">{open.photos ? '▾' : '▸'}</span>
          </button>
          {open.photos ? (
            <div className="photosSectionBody">
              <div className="photosCollapseColumn">
                {currentPhoto && !photoLoadError ? (
                  <div className="photoPreviewFrame">
                    <img key={currentPhoto} className="photoPreview" src={currentPhoto} alt="Selected dahlia" loading="lazy" decoding="async" width={PHOTO_PREVIEW_SIZE} height={PHOTO_PREVIEW_SIZE} onError={() => setPhotoLoadError(true)} />
                    <button className="photoPreviewOverlayButton" type="button" onClick={() => { setViewerPhotoUrl(currentViewerPhoto); setPhotoViewerOpen(true) }} aria-label="View larger flower photo" />
                  </div>
                ) : (
                  <div className="photoPlaceholder">{photoLoadError ? 'Photo failed to load' : 'No photo yet'}</div>
                )}
                <div className="photosCollapseButtonRow">
                  <button
                    className="btn ghost compact photosCollapseButton"
                    type="button"
                    onClick={() => setGalleriesOpen(true)}
                  >
                    Show Galleries
                  </button>
                </div>
              </div>
              {photoLoadError ? <div className="error inlineError">The photo URL is saved but the browser could not load it in the preview.</div> : null}
              {photoError ? <div className="error inlineError">{photoError}</div> : null}
            </div>
          ) : null}
        </div>

        <div className="sections">
          {(['growth', 'care', 'health', 'storage', 'varieties', 'tuber', 'meta'] as SectionKey[]).map((k) => (
            <div key={k} className="section">
              <button
                className="sectionHead"
                onClick={() =>
                  setOpen((p) => ({
                    ...p,
                    [k]: !p[k],
                  }))
                }
                type="button"
              >
                <span>{sectionTitle(k)}</span>
                <span className="chev">{open[k] ? '▾' : '▸'}</span>
              </button>

              {open[k] ? (
                <div className="sectionBody">
                  {k === 'growth' ? (
                    <div className="grid2">
                      <Field label="Height (in feet)" hint="Expected or observed plant height in feet." value={form.growth.height ?? ''} onChange={(v) => setForm((p) => ({ ...p, growth: { ...p.growth, height: v } }))} />
                      <DahliaPickerField label="Bloom Width" hint="Expected or observed bloom diameter category." options={BLOOM_WIDTH_OPTIONS} value={form.core.size} onChange={(v) => setForm((p) => ({ ...p, core: { ...p.core, size: v } }))} />
                      <Field label="Bloom Time" hint="When this dahlia typically blooms, such as early, mid, late, or a month range." value={form.growth.bloomTime ?? ''} onChange={(v) => setForm((p) => ({ ...p, growth: { ...p.growth, bloomTime: v } }))} />
                      <DahliaPickerField label="Habit" hint="Growth habit or plant shape." options={DAHLIA_HABIT_OPTIONS} value={form.growth.habit || undefined} onChange={(v) => setForm((p) => ({ ...p, growth: { ...p.growth, habit: v } }))} />
                    </div>
                  ) : null}

                  {k === 'care' ? (
                    <div className="grid2">
                      <Field label="Sun" hint="Sun exposure needs or actual exposure for this plant." value={form.care.sun ?? ''} onChange={(v) => setForm((p) => ({ ...p, care: { ...p.care, sun: v } }))} />
                      <Field label="Water" hint="Watering needs, frequency, or observations." value={form.care.water ?? ''} onChange={(v) => setForm((p) => ({ ...p, care: { ...p.care, water: v } }))} />
                      <Field label="Soil" hint="Soil type, amendments, drainage, or bed conditions." value={form.care.soil ?? ''} onChange={(v) => setForm((p) => ({ ...p, care: { ...p.care, soil: v } }))} />
                      <Field label="Fertilizer" hint="Fertilizer plan, product, timing, or notes." value={form.care.fertilizer ?? ''} onChange={(v) => setForm((p) => ({ ...p, care: { ...p.care, fertilizer: v } }))} />
                      <Field label="Staking" hint="Staking method or support needed for this plant." value={form.care.staking ?? ''} onChange={(v) => setForm((p) => ({ ...p, care: { ...p.care, staking: v } }))} />
                    </div>
                  ) : null}

                  {k === 'tuber' ? (
                    <>
                      <DahliaPickerField
                        label="Invoice Item"
                        hint="Associate one saved invoice order item with this dahlia record. Remove the current item to assign a different one."
                        layout="list"
                        clearable={false}
                        placeholder="Select Invoice Item..."
                        disabled={linkedOrderItemIds.length >= 1 || invoiceItemsEmpty}
                        options={availableInvoiceItems}
                        value={undefined}
                        onChange={(value) => {
                          if (!value) return
                          const matchingOrder = orders.find((order) => order.items.some((item) => item.id === value))
                          const companyName = matchingOrder?.company?.name
                          setForm((p) => ({
                            ...p,
                            tuber: {
                              ...p.tuber,
                              linkedOrderItemIds: [value],
                              ...(!p.tuber.source && companyName ? { source: companyName } : {}),
                            },
                          }))
                        }}
                      />
                      {invoiceItemsEmpty ? (
                        <div className="fieldMessage">No invoice items match &ldquo;{selectedSourceCompany}&rdquo;.</div>
                      ) : null}
                      {linkedOrderRows.length ? (
                        <div className="tableWrap miniTable">
                          <table className="table">
                            <thead>
                              <tr>
                                <th>Invoice</th>
                                <th>Company</th>
                                <th>Item</th>
                                <th>Cost</th>
                                <th>View File(s)</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {linkedOrderRows.map(({ order, item }) => (
                                <tr key={item.id}>
                                  <td>{order.invoiceNumber ?? ''}</td>
                                  <td>{order.company?.name ?? ''}</td>
                                  <td>{item.flowerName}</td>
                                  <td>{item.itemCost === undefined ? '' : `$${item.itemCost.toFixed(2)}`}</td>
                                  <td>
                                    {order.files.length > 0 ? (
                                      <DropdownField
                                        label="View file"
                                        value=""
                                        portal
                                        options={[
                                          { value: '', label: 'Select...' },
                                          ...[...order.files]
                                            .sort((a, b) => a.originalFileName.localeCompare(b.originalFileName))
                                            .map((file, i) => ({ value: file.fileUrl, label: `Doc ${i + 1}` })),
                                        ]}
                                        onChange={(url) => { if (url) window.open(url, '_blank', 'noreferrer') }}
                                      />
                                    ) : null}
                                  </td>
                                  <td>
                                    <button
                                      className="btn ghost compact"
                                      type="button"
                                      onClick={() =>
                                        setForm((p) => ({
                                          ...p,
                                          tuber: { ...p.tuber, linkedOrderItemIds: (p.tuber.linkedOrderItemIds ?? []).filter((id) => id !== item.id) },
                                        }))
                                      }
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                      <div className="customEntryWrap">
                        <FieldLabel label="Custom Entry" hint="Optional manual source details for gifts, trades, historical records, or sources without an invoice record." />
                        <div className="customEntryBox">
                          <div className="grid2">
                            <DahliaPickerField
                              label="Company"
                              hint="Manual company or source name when no invoice record is linked. Add new companies from the Companies modal."
                              layout="list"
                              options={companies.map((company) => company.name)}
                              value={selectedSourceCompany || undefined}
                              onChange={setSourceCompany}
                              labelAction={onOpenCompanies ? (
                                <button className="labelLink" type="button" onClick={onOpenCompanies}>
                                  Company
                                </button>
                              ) : undefined}
                            />
                            <Field
                              label="Acquired Year"
                              hint="Manual acquired year when no invoice record is linked."
                              type="number"
                              value={form.tuber.acquiredYear ? String(form.tuber.acquiredYear) : ''}
                              onChange={(v) => setForm((p) => ({ ...p, tuber: { ...p.tuber, acquiredYear: v ? Number(v) : undefined } }))}
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : null}

                  {k === 'storage' ? (
                    <>
                      <div className="grid2">
                        <DahliaPickerField
                          label="Container Type"
                          hint="The container used to store the tuber."
                          options={['Cardboard Box', 'Mesh Bag', 'Paper Bag', 'Plastic Bin', 'Ventilated Plastic Bin', 'Wooden Crate']}
                          value={form.tuber.containerType}
                          onChange={(v) => setForm((p) => ({ ...p, tuber: { ...p.tuber, containerType: v } }))}
                        />
                        <DahliaPickerField
                          label="Container Fill Type"
                          hint="The material packed around the stored tuber."
                          options={['Peat Moss', 'Sawdust', 'Vermiculite', 'Wood Shavings']}
                          value={form.tuber.containerFillType}
                          onChange={(v) => setForm((p) => ({ ...p, tuber: { ...p.tuber, containerFillType: v } }))}
                        />
                      </div>
                      <Toggle
                        label="Overwintered"
                        hint="Whether this tuber was saved and stored through winter."
                        value={form.tuber.overwintered ?? false}
                        onChange={(v) =>
                          setForm((p) => ({
                            ...p,
                            tuber: {
                              ...p.tuber,
                              overwintered: v,
                            },
                          }))
                        }
                      />
                      <TextArea
                        label="Storage Notes"
                        hint="Notes about storage conditions, condition checks, or overwintering results."
                        value={form.tuber.storageNotes ?? ''}
                        onChange={(v) => setForm((p) => ({ ...p, tuber: { ...p.tuber, storageNotes: v } }))}
                      />
                    </>
                  ) : null}

                  {k === 'health' ? (
                    <>
                      <div className="healthGrid">
                        <Toggle
                          label="Infested?"
                          hint="Whether pests are present for this plant. Enables the Pests field."
                          value={form.health.pests !== undefined}
                          onChange={(v) => setForm((p) => ({ ...p, health: { ...p.health, pests: v ? p.health.pests ?? '' : undefined } }))}
                        />
                        <Field label="Pests" hint="Observed pests or pest pressure affecting this plant." value={form.health.pests ?? ''} disabled={form.health.pests === undefined} onChange={(v) => setForm((p) => ({ ...p, health: { ...p.health, pests: v } }))} />
                        <Toggle
                          label="Diseased?"
                          hint="Whether disease is present for this plant. Enables the Disease field."
                          value={form.health.disease !== undefined}
                          onChange={(v) => setForm((p) => ({ ...p, health: { ...p.health, disease: v ? p.health.disease ?? '' : undefined } }))}
                        />
                        <Field label="Disease" hint="Observed disease symptoms, diagnosis, or concerns." value={form.health.disease ?? ''} disabled={form.health.disease === undefined} onChange={(v) => setForm((p) => ({ ...p, health: { ...p.health, disease: v } }))} />
                      </div>
                      <TextArea
                        label="Treatments"
                        hint="Treatments applied for pests, disease, or plant health."
                        value={form.health.treatments ?? ''}
                        onChange={(v) => setForm((p) => ({ ...p, health: { ...p.health, treatments: v } }))}
                      />
                    </>
                  ) : null}

                  {k === 'varieties' ? (
                    relatedVarietyRecords.length ? (
                      <div className="tableWrap miniTable">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Flower Name</th>
                              <th>Location</th>
                              <th>Season</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {relatedVarietyRecords.map((record) => {
                              const isCurrentRecord = record.id === initial?.id
                              return (
                              <tr key={record.id} className={isCurrentRecord ? 'currentVarietyRow' : undefined}>
                                <td>{record.recordNumber}</td>
                                <td>
                                  {isCurrentRecord || !onOpenRecord ? (
                                    record.flowerName
                                  ) : (
                                    <button className="labelLink" type="button" onClick={() => handleVarietyRecordClick(record)}>
                                      {record.flowerName}
                                    </button>
                                  )}
                                </td>
                                <td>{formatLocation(record)}</td>
                                <td>{record.seasonYearStart}</td>
                                <td>{isCurrentRecord ? <span className="currentBadge">Current</span> : null}</td>
                              </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty inlineEmpty">No related variety records found.</div>
                    )
                  ) : null}

                  {k === 'meta' ? (
                    <div className="grid2">
                      <Field
                        label="Record Number"
                        value={form.recordNumber === undefined ? 'DRAFT' : String(form.recordNumber)}
                        inputClassName={`recordNumberInput${form.recordNumber === undefined ? ' draftRecordNumber' : ''}`}
                        tabIndex={-1}
                        readOnly
                      />
                      <Field label="Created At" value={form.meta.createdAt ?? 'Auto-generated on save'} readOnly />
                      <Field label="Updated At" value={form.meta.updatedAt ?? 'Auto-generated on save'} readOnly />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {reviewResult ? (
          <div className={`callout ${reviewResult.status === 'pass' ? 'ok' : 'warn'} reviewPanel`}>
            <div>{reviewResult.summary}</div>
            {reviewResult.findings.length ? (
              <div className="reviewFindings">
                {reviewResult.findings.map((finding, index) => (
                  <div key={`${finding.field}-${index}`}>
                    <strong>{finding.severity.toUpperCase()} {finding.field}:</strong> {finding.issue}
                    {finding.suggestedFix ? ` Suggested fix: ${finding.suggestedFix}` : ''}
                  </div>
                ))}
              </div>
            ) : null}
            {reviewResult.promptSuggestion ? <div className="reviewPromptSuggestion">Prompt suggestion: {reviewResult.promptSuggestion}</div> : null}
            {onProposeCorrection ? (
              <div className="missedIssueBox">
                <textarea
                  className="textarea missedIssueInput"
                  value={missedIssueText}
                  disabled={correctionBusy}
                  onChange={(event) => setMissedIssueText(event.target.value)}
                  placeholder="Add a missed issue, e.g. storage text should set container type and fill type..."
                  rows={3}
                />
                <button className="btn ghost compact" type="button" disabled={correctionBusy || missedIssueText.trim().length === 0} onClick={() => void handleProposeCorrection()}>
                  {correctionBusy ? 'Proposing...' : 'Propose Fix'}
                </button>
              </div>
            ) : null}
            {correctionResult ? (
              <div className="correctionBox">
                <div>{correctionResult.summary}</div>
                <pre className="correctionPatch">{JSON.stringify(correctionResult.recordPatch, null, 2)}</pre>
                {correctionResult.promptSuggestion ? <div className="reviewPromptSuggestion">Prompt suggestion: {correctionResult.promptSuggestion}</div> : null}
                {onApplyCorrection ? (
                  <button className="btn compact" type="button" onClick={() => void handleApplyCorrection()}>
                    Apply Proposed Fix
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="modalFooter">
        <div className="footerLeft" ref={confirmAreaRef}>
          {confirmAction ? <div className="callout warn footerConfirmMessage">Click the highlighted action again to confirm.</div> : null}
          <div className="footerActionRow">
            {onReview ? (
              <button className="btn ghost" type="button" disabled={reviewBusy} onClick={() => void handleReviewClick()}>
                {reviewBusy ? 'Reviewing...' : confirmAction === 'review' ? 'Confirm Review' : 'Review With Debug Agent'}
              </button>
            ) : null}
            {onDelete ? (
              <button className="btn danger" onClick={() => void handleDeleteClick()}>
                {confirmAction === 'delete' ? 'Confirm Delete' : 'Delete'}
              </button>
            ) : null}
            {initial && onDuplicate ? (
              <button className="btn ghost" type="button" onClick={handleDuplicateClick}>
                {confirmAction === 'duplicate' ? 'Confirm Duplicate' : 'Duplicate'}
              </button>
            ) : null}
          </div>
        </div>
        <div className="footerStack">
          {closeError ? <div className="error inlineError footerError">{closeError}</div> : null}
          <div className="footerRight">
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" disabled={!canSave || !hasChanges || saving} onClick={() => void handleSave()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      {galleriesOpen ? (
        <div className="photoViewerOverlay" role="dialog" aria-modal="true" aria-label="Photo galleries">
          <div className="photoViewerModal photoGalleriesModal">
            <div className="photoViewerHeader">
              <div>
                <div className="modalTitle">Photo Galleries</div>
                <div className="photoHint">Record photos are specific to this plant. Cultivar photos are shared across matching records.</div>
              </div>
              <button className="btn ghost" type="button" onClick={() => setGalleriesOpen(false)}>
                Close
              </button>
            </div>
            <div className="photoViewerBody photoGalleriesBody">
              <div className="photoSubhead">Assigned Image</div>
              <div
                className="photoDropzone"
                onDragOver={(e) => {
                  e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  void selectPhoto(e.dataTransfer.files[0])
                }}
              >
                {currentPhoto && !photoLoadError ? (
                  <div className="photoPreviewFrame">
                    <img key={currentPhoto} className="photoPreview" src={currentPhoto} alt="Selected dahlia" loading="lazy" decoding="async" width={PHOTO_PREVIEW_SIZE} height={PHOTO_PREVIEW_SIZE} onError={() => setPhotoLoadError(true)} />
                  </div>
                ) : (
                  <div className="photoPlaceholder">{photoLoadError ? 'Photo failed to load' : 'Drop a photo here'}</div>
                )}
                <div className="photoActions">
                  <div className="photoHint">Add a new image by dragging it here, or choose one from your device.</div>
                  <div className="photoUploadTarget" role="radiogroup" aria-label="Photo upload target">
                    <label className="radioOption">
                      <input type="radio" name="galleriesPhotoScope" value="cultivar" checked={photoScope === 'cultivar'} onChange={() => setPhotoScope('cultivar')} />
                      <span>All {form.core.cultivar || form.flowerName || 'cultivar'} records</span>
                    </label>
                    <label className="radioOption">
                      <input type="radio" name="galleriesPhotoScope" value="record" checked={photoScope === 'record'} onChange={() => setPhotoScope('record')} />
                      <span>This record only</span>
                    </label>
                  </div>
                  <div className="photoActionButtons">
                    <button
                      className={photoFile ? 'btn photoActionPrimary' : 'btn ghost photoActionPrimary'}
                      type="button"
                      disabled={photoFile ? !canSave || saving || photoConverting : photoConverting}
                      onClick={() => photoFile ? void handleSave({ keepOpen: true }) : galleriesFileInputRef.current?.click()}
                    >
                      {photoConverting ? 'Converting...' : photoFile ? saving ? 'Saving...' : 'Save Photo' : 'Add Photo'}
                    </button>
                    {photoFile ? (
                      <button
                        className="btn ghost photoActionChoose"
                        type="button"
                        disabled={saving || photoConverting}
                        onClick={() => galleriesFileInputRef.current?.click()}
                      >
                        Choose Different Photo
                      </button>
                    ) : null}
                    {photoFile ? (
                      <button
                        className="btn ghost photoActionCancel"
                        type="button"
                        disabled={saving || photoConverting}
                        onClick={cancelPhotoSelection}
                      >
                        Cancel
                      </button>
                    ) : null}
                    <button
                      className="btn ghost photoActionIdentify"
                      type="button"
                      disabled={!currentPhoto || photoLoadError || photoConverting || identifyBusy}
                      onClick={() => void submitIdentifyPhoto()}
                    >
                      {photoConverting ? 'Converting...' : identifyBusy ? 'Identifying...' : 'Identify Photo'}
                    </button>
                  </div>
                  <input
                    ref={galleriesFileInputRef}
                    className="fileInput"
                    type="file"
                    accept="image/*,.heic,.heif"
                    onChange={(e) => void selectPhoto(e.target.files?.[0])}
                  />
                </div>
              </div>
              {photoLoadError ? <div className="error inlineError">The photo URL is saved but the browser could not load it in the preview.</div> : null}
              {photoError ? <div className="error inlineError">{photoError}</div> : null}
              {identifyError ? <div className="error inlineError">{identifyError}</div> : null}
              <div className="photoGalleryGroups">
                <PhotoGallery
                  title="Record Photos"
                  empty="No record-specific photos yet."
                  photos={recordPhotos}
                  defaultPhotoId={resolvedRecordDefaultPhotoId}
                  overallDefaultPhotoId={overallRecordDefaultPhotoId}
                  onView={(url) => { setViewerPhotoUrl(url); setPhotoViewerOpen(true) }}
                  onSetDefault={(photo) => void setRecordDefault(photo)}
                  onDelete={(photos) => void deletePhotos(photos, 'record')}
                  onCopy={(photos) => void copyPhotosToScope(photos, 'cultivar')}
                  copyLabel="Copy to Cultivar"
                  onSave={() => void handleSave({ keepOpen: true, dirtyPhotoSection: 'record' })}
                  showSave={dirtyPhotoSection === 'record'}
                  saveDisabled={!canSave || !hasChanges || saving}
                  saving={saving}
                />
                <PhotoGallery
                  title="Cultivar Photos"
                  empty="No shared cultivar photos yet."
                  photos={cultivarPhotos}
                  defaultPhotoId={resolvedCultivarDefaultPhotoId}
                  overallDefaultPhotoId={overallCultivarDefaultPhotoId}
                  onView={(url) => { setViewerPhotoUrl(url); setPhotoViewerOpen(true) }}
                  onSetDefault={(photo) => {
                    setDirtyPhotoSection('cultivar')
                    setForm((previous) => withResolvedPhotoFields({ ...previous, cultivarPhotos, defaultCultivarPhotoId: photo.id, defaultPhotoScope: 'cultivar' }))
                  }}
                  onSetDefaultForAll={(photo) => void setCultivarDefault(photo, true)}
                  applyDefaultToAllLabel="All related records"
                  onDelete={(photos) => void deletePhotos(photos, 'cultivar')}
                  onCopy={(photos) => void copyPhotosToScope(photos, 'record')}
                  copyLabel="Copy to Record"
                  onSave={() => void handleSave({ keepOpen: true, dirtyPhotoSection: 'cultivar' })}
                  showSave={dirtyPhotoSection === 'cultivar'}
                  saveDisabled={!canSave || !hasChanges || saving}
                  saving={saving}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {photoViewerOpen && (viewerPhotoUrl || currentPhoto) ? (
        <div className="photoViewerOverlay" role="dialog" aria-modal="true" aria-label="Flower photo viewer" onMouseDown={() => setPhotoViewerOpen(false)}>
          <div className="photoViewerModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="photoViewerHeader">
              <div className="modalTitle">Flower Photo</div>
              <button className="btn ghost" type="button" onClick={() => setPhotoViewerOpen(false)}>
                Close
              </button>
            </div>
            <div className="photoViewerBody">
              <img className="photoViewerImage" src={viewerPhotoUrl || currentViewerPhoto} alt="Selected dahlia enlarged" decoding="async" />
            </div>
          </div>
        </div>
      ) : null}
      {identifyResult ? (
        <PhotoIdentifyResultsModal result={identifyResult} onBack={() => setIdentifyResult(null)} onClose={() => setIdentifyResult(null)} />
      ) : null}
    </Overlay>
  )
}

function PhotoGallery({ title, empty, photos, defaultPhotoId, overallDefaultPhotoId, onView, onSetDefault, onSetDefaultForAll, applyDefaultToAllLabel, onDelete, onCopy, copyLabel, onSave, showSave, saveDisabled, saving }: { title: string; empty: string; photos: DahliaPhoto[]; defaultPhotoId?: string; overallDefaultPhotoId?: string; onView: (url: string) => void; onSetDefault: (photo: DahliaPhoto) => void; onSetDefaultForAll?: (photo: DahliaPhoto) => void; applyDefaultToAllLabel?: string; onDelete: (photos: DahliaPhoto[]) => void; onCopy: (photos: DahliaPhoto[]) => void; copyLabel: string; onSave: () => void; showSave: boolean; saveDisabled: boolean; saving: boolean }) {
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([])
  const [applyDefaultToAll, setApplyDefaultToAll] = useState(false)
  const selectedPhotos = photos.filter((photo) => selectedPhotoIds.includes(photo.id))

  useEffect(() => {
    const availableIds = new Set(photos.map((photo) => photo.id))
    setSelectedPhotoIds((previous) => previous.filter((id) => availableIds.has(id)))
  }, [photos])

  useEffect(() => {
    if (selectedPhotos.length !== 1) setApplyDefaultToAll(false)
  }, [selectedPhotos.length])

  function toggleSelected(photoId: string, selected: boolean) {
    setSelectedPhotoIds((previous) => {
      if (selected) return previous.includes(photoId) ? previous : [...previous, photoId]
      return previous.filter((id) => id !== photoId)
    })
  }

  function clearSelection() {
    setSelectedPhotoIds([])
  }

  function handleSetDefault() {
    if (selectedPhotos.length !== 1) return
    if (applyDefaultToAll && onSetDefaultForAll) onSetDefaultForAll(selectedPhotos[0])
    else onSetDefault(selectedPhotos[0])
    clearSelection()
  }

  function handleCopy() {
    if (!selectedPhotos.length) return
    onCopy(selectedPhotos)
    clearSelection()
  }

  function handleDelete() {
    if (!selectedPhotos.length) return
    onDelete(selectedPhotos)
    clearSelection()
  }

  return (
    <div className="photoGalleryGroup">
      <div className="photoGalleryHeader">
        <div>
          <div className="photoGalleryTitle">{title}</div>
          <div className="photoGalleryCount">{selectedPhotos.length ? `${selectedPhotos.length} selected` : `${photos.length} photo${photos.length === 1 ? '' : 's'}`}</div>
        </div>
        <div className="photoGalleryActions" aria-label={`${title} selected photo actions`}>
          <button className="btn ghost compact" type="button" disabled={selectedPhotos.length !== 1} onClick={handleSetDefault}>
            Set Default
          </button>
          {onSetDefaultForAll && selectedPhotos.length === 1 ? (
            <label className="photoGalleryOption">
              <input type="checkbox" checked={applyDefaultToAll} onChange={(event) => setApplyDefaultToAll(event.target.checked)} />
              <span>{applyDefaultToAllLabel}</span>
            </label>
          ) : null}
          <button className="btn ghost compact" type="button" disabled={!selectedPhotos.length} onClick={handleCopy}>
            {copyLabel}
          </button>
          <button className="btn ghost compact" type="button" disabled={!selectedPhotos.length} onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>
      {photos.length ? (
        <div className="photoGalleryGrid">
          {photos.map((photo) => {
            const thumbnailUrl = photoUrl(photo)
            const viewerUrl = fullPhotoUrl(photo)
            const isDefault = photo.id === defaultPhotoId
            const isOverallDefault = photo.id === overallDefaultPhotoId
            const isSelected = selectedPhotoIds.includes(photo.id)
            return (
              <div key={photo.id} className={`photoTile${isDefault ? ' default' : ''}${isSelected ? ' selected' : ''}`}>
                <button className="photoTileImageButton" type="button" onClick={() => onView(viewerUrl)}>
                  <img src={thumbnailUrl} alt="Dahlia gallery item" loading="lazy" decoding="async" width={PHOTO_GALLERY_THUMB_SIZE} height={PHOTO_GALLERY_THUMB_SIZE} />
                </button>
                <label className="photoTileSelect" aria-label={`Select ${title} photo`}>
                  <input type="checkbox" checked={isSelected} onChange={(event) => toggleSelected(photo.id, event.target.checked)} />
                  <span aria-hidden="true" />
                </label>
                {isOverallDefault ? <div className="photoDefaultBadge">Default</div> : null}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="photoGalleryEmpty">{empty}</div>
      )}
      {showSave ? (
        <div className="photoGalleryFooter">
          <button className="btn compact" type="button" disabled={saveDisabled} onClick={onSave}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
