export type DahliaRecord = {
  id: string
  recordNumber: number
  gardenId?: string
  flowerName: string
  gardenLocation: string
  seasonYearStart: number
  thumbnailUrl?: string
  imageUrl?: string
  cultivarThumbnailUrl?: string
  cultivarImageUrl?: string
  recordPhotos?: DahliaPhoto[]
  cultivarPhotos?: DahliaPhoto[]
  defaultRecordPhotoId?: string
  defaultCultivarPhotoId?: string
  defaultPhotoScope?: 'record' | 'cultivar'

  core: {
    cultivar?: string
    plantedDate?: string
    color?: string
    form?: string
    size?: string
    notes?: string
  }

  growth: {
    height?: string
    bloomTime?: string
    habit?: string
  }

  care: {
    sun?: string
    water?: string
    soil?: string
    fertilizer?: string
    staking?: string
  }

  tuber: {
    source?: string
    acquiredYear?: number
    containerType?: string
    containerFillType?: string
    storageNotes?: string
    overwintered?: boolean
    linkedOrderItemIds?: string[]
  }

  health: {
    pests?: string
    disease?: string
    treatments?: string
  }

  meta: {
    createdAt?: string
    updatedAt?: string
    gardenArea?: string
    gardenRow?: string
    gardenPosition?: number
    gardenZone?: string
    rowOrBed?: string
    position?: number
    plantingState?: PlantingState
    notPlantedReason?: NotPlantedReason
    notViableReason?: NotViableReason
    agentOriginalInput?: string
    agentExtractionPromptPath?: string
    agentExtractionModel?: string
    agentExtractedAt?: string
  }
}

export type DahliaPhoto = {
  id: string
  imageUrl: string
  thumbnailUrl?: string
  scope: 'record' | 'cultivar'
  createdAt?: string
}

export type PlantingState = 'garden_tray' | 'in_garden' | 'not_planted' | 'not_viable' | 'purchased_container'

export type NotPlantedReason = 'not_received' | 'refunded'

export type NotViableReason = 'no_longer_present' | 'removed' | 'unused'

export type GardenOptionKey = 'gardenAreas' | 'gardenRows' | 'gardenPositions'

export type GardenOptions = Record<GardenOptionKey, string[]>

export type GardenRole = 'owner' | 'admin' | 'editor' | 'viewer'

export type KnownUser = {
  id: string
  userId: string
  email?: string
  displayName?: string
  photoUrl?: string
  provider?: string
  createdAt?: string
  updatedAt?: string
  lastSeenAt?: string
}

export type CurrentUserProfile = {
  uid: string
  email?: string
  displayName?: string
  globalAdmin: boolean
}

export type Garden = {
  id: string
  name: string
  ownershipType: 'personal'
  ownerUserId?: string
  organizationName?: string
  locationName?: string
  address?: string
  notes?: string
  createdByUserId?: string
  isDefault?: boolean
  createdAt?: string
  updatedAt?: string
}

export type GardenMember = {
  id: string
  gardenId: string
  userId: string
  email?: string
  displayName?: string
  role: GardenRole
  invitedByUserId?: string
  createdAt?: string
  updatedAt?: string
}

export type Invite = {
  id: string
  token: string
  gardenId?: string
  email?: string
  role: string
  createdByUserId?: string
  resentAt?: string
  resentByUserId?: string
  acceptedAt?: string
  acceptedByUserId?: string
  expiresAt?: string
  createdAt?: string
  updatedAt?: string
}

export type DahliaRecordInput = Omit<DahliaRecord, 'id' | 'recordNumber'> & { id?: string; recordNumber?: number }

export type AgentReviewFinding = {
  severity: 'low' | 'medium' | 'high'
  field: string
  issue: string
  evidence?: string
  suggestedFix?: string
}

export type AgentReviewResult = {
  status: 'pass' | 'issues_found'
  summary: string
  findings: AgentReviewFinding[]
  promptSuggestion?: string
}

export type AgentVisualization = {
  type?: 'bar' | 'line' | 'pie' | 'scatter' | 'table' | 'garden-map'
  title?: string
  description?: string
  data: Record<string, unknown>[]
  xKey?: string
  yKey?: string
  seriesKey?: string
  valueKey?: string
  labelKey?: string
  unit?: string
  renderer?: 'recharts' | 'd3' | 'table'
  xLabelAngle?: number
}

export type AgentCorrectionResult = {
  recordPatch: Partial<DahliaRecordInput>
  summary: string
  promptSuggestion?: string
}

export type MaintenanceReminder = {
  id: string
  gardenId?: string
  title: string
  notes?: string
  dueDate?: string
  relatedRecordIds?: string[]
  source?: 'user' | 'agent'
  createdByUserId?: string
  ownerUserId?: string
  assignedToUserId?: string
  completedByUserId?: string
  visibility?: 'private' | 'garden'
  priority?: 'normal' | 'high'
  createdAt?: string
  updatedAt?: string
  completedAt?: string
}

export type MaintenanceReminderInput = Omit<MaintenanceReminder, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>

export type Company = {
  id: string
  ownerUserId?: string
  gardenId?: string
  name: string
  website?: string
  email?: string
  phone?: string
  notes?: string
  usage?: {
    orderCount?: number
    flowerRecordCount?: number
    orders?: Array<{ id: string; invoiceNumber?: string | null; orderDate?: string | null; totalCost?: number | null }>
    flowerRecords?: Array<{ id: string; recordNumber?: number | null; flowerName?: string; seasonYearStart?: number | null }>
  }
  canUpdate?: boolean
  canDelete?: boolean
  createdAt?: string
  updatedAt?: string
}

export type OrderItem = {
  id: string
  orderId: string
  gardenId?: string
  flowerName: string
  cultivarName?: string
  itemCost?: number
  quantity?: number
  notes?: string
  createdAt?: string
  updatedAt?: string
}

export type OrderFile = {
  id: string
  orderId: string
  originalFileName: string
  storedFileName: string
  mimeType: string
  fileSize: number
  fileUrl: string
  sourceType: 'uploaded_pdf' | 'image_converted_to_pdf'
  createdAt?: string
}

export type Order = {
  id: string
  ownerUserId?: string
  companyId: string
  company?: Company | null
  invoiceNumber?: string
  orderDate?: string
  totalCost?: number
  notes?: string
  items: OrderItem[]
  files: OrderFile[]
  createdAt?: string
  updatedAt?: string
}

export type CompanyInput = Omit<Company, 'id' | 'usage' | 'canUpdate' | 'canDelete' | 'createdAt' | 'updatedAt'>
export type OrderItemInput = Omit<OrderItem, 'id' | 'orderId' | 'createdAt' | 'updatedAt'>
export type OrderInput = Omit<Order, 'id' | 'company' | 'items' | 'files' | 'createdAt' | 'updatedAt'> & { items: OrderItemInput[] }

export type AssetFile = {
  id: string
  assetId: string
  originalFileName: string
  storedFileName: string
  mimeType: string
  fileSize: number
  fileUrl: string
  sourceType: 'uploaded_pdf' | 'image_converted_to_pdf'
  createdAt?: string
}

export type Asset = {
  id: string
  ownerUserId?: string
  companyId?: string
  company?: Company | null
  asset: string
  category?: string
  quantity?: number
  totalCost?: number
  purchaseDate?: string
  notes?: string
  linkedOrderItemIds?: string[]
  invoiceNumber?: string
  invoiceTotal?: number
  files: AssetFile[]
  createdAt?: string
  updatedAt?: string
}

export type AssetInput = Omit<Asset, 'id' | 'company' | 'files' | 'createdAt' | 'updatedAt'>

export type ExcelImportEntry = {
  excelName: string
  gardenArea: string
  gardenRow: string
  gardenPosition: number
  gardenLocation: string
  spreadsheetRow?: number
}

export type ExcelImportResult = {
  importId?: string
  canRevert?: boolean
  counts: {
    extractedCount: number
    updatedCount: number
    unmatchedCount: number
    ambiguousCount: number
    priorSeasonMissingCount: number
    skippedCount: number
  }
  updated: Array<{
    excelName: string
    gardenLocation: string
    gardenArea: string
    recordId: string
    flowerName: string
    cultivar?: string
    matchType: 'exact' | 'fuzzy'
    score: number
  }>
  unmatched: ExcelImportEntry[]
  ambiguous: Array<ExcelImportEntry & { matches: Array<{ id: string; flowerName: string; cultivar?: string; score: number }> }>
  priorSeasonMissing: Array<ExcelImportEntry & { priorSeasonMatches: Array<{ id: string; flowerName: string; cultivar?: string; seasonYearStart: number }> }>
  skipped: Array<ExcelImportEntry & { reason: string; matchedRecord?: { id: string; flowerName: string; cultivar?: string } }>
}

export type ExcelImportRevertResult = {
  importId: string
  revertedCount: number
  skipped: Array<{ recordId: string; flowerName?: string; reason: string }>
}
