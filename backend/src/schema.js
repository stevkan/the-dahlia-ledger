import { z } from 'zod'

export const DahliaPhotoSchema = z.object({
  id: z.string().min(1),
  imageUrl: z.string().min(1),
  thumbnailUrl: z.string().optional().nullable(),
  listThumbnailUrl: z.string().optional().nullable(),
  scope: z.enum(['record', 'cultivar']),
  createdAt: z.string().optional().nullable(),
})

export const DahliaRecordInputSchema = z.object({
  id: z.string().optional(),
  recordNumber: z.number().int().nonnegative().optional(),
  gardenId: z.string().optional().nullable(),
  flowerName: z.string().min(1),
  gardenLocation: z.string().optional().nullable(),
  seasonYearStart: z.number().int().min(1900).max(3000),
  thumbnailUrl: z.string().optional().nullable(),
  listThumbnailUrl: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  cultivarThumbnailUrl: z.string().optional().nullable(),
  cultivarListThumbnailUrl: z.string().optional().nullable(),
  cultivarImageUrl: z.string().optional().nullable(),
  recordPhotos: z.array(DahliaPhotoSchema).optional().nullable(),
  cultivarPhotos: z.array(DahliaPhotoSchema).optional().nullable(),
  defaultRecordPhotoId: z.string().optional().nullable(),
  defaultCultivarPhotoId: z.string().optional().nullable(),
  defaultPhotoScope: z.enum(['record', 'cultivar']).optional().nullable(),

  core: z
    .object({
      cultivar: z.string().optional().nullable(),
      plantedDate: z.string().optional().nullable(),
      color: z.string().optional().nullable(),
      form: z.string().optional().nullable(),
      size: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    })
    .default({}),

  growth: z
    .object({
      height: z.string().optional().nullable(),
      bloomTime: z.string().optional().nullable(),
      habit: z.string().optional().nullable(),
    })
    .default({}),

  care: z
    .object({
      sun: z.string().optional().nullable(),
      water: z.string().optional().nullable(),
      soil: z.string().optional().nullable(),
      fertilizer: z.string().optional().nullable(),
      staking: z.string().optional().nullable(),
    })
    .default({}),

  tuber: z
    .object({
      source: z.string().optional().nullable(),
      acquiredYear: z.number().int().optional().nullable(),
      storageNotes: z.string().optional().nullable(),
      overwintered: z.boolean().optional().nullable(),
      containerType: z.string().optional().nullable(),
      containerFillType: z.string().optional().nullable(),
      linkedOrderItemIds: z.array(z.string()).optional().nullable(),
    })
    .default({}),

  health: z
    .object({
      pests: z.string().optional().nullable(),
      disease: z.string().optional().nullable(),
      treatments: z.string().optional().nullable(),
    })
    .default({}),

  meta: z
    .object({
      createdAt: z.string().optional().nullable(),
      updatedAt: z.string().optional().nullable(),
      gardenArea: z.string().optional().nullable(),
      gardenRow: z.string().optional().nullable(),
      gardenPosition: z.number().int().min(1).optional().nullable(),
      gardenZone: z.string().optional().nullable(),
      rowOrBed: z.string().optional().nullable(),
      position: z.number().int().min(1).optional().nullable(),
      plantingState: z.enum(['garden_tray', 'in_garden', 'not_planted', 'not_viable', 'purchased_container', 'did_not_grow']).optional().nullable(),
      notPlantedReason: z.enum(['not_received', 'refunded']).optional().nullable(),
      notViableReason: z.enum(['no_longer_present', 'removed', 'unused']).optional().nullable(),
      nameStatus: z.enum(['mystery', 'unknown', 'seedling']).optional().nullable(),
      agentOriginalInput: z.string().optional().nullable(),
      agentExtractionPromptPath: z.string().optional().nullable(),
      agentExtractionModel: z.string().optional().nullable(),
      agentExtractedAt: z.string().optional().nullable(),
    })
    .default({}),
})

export const CompanyInputSchema = z.object({
  ownerUserId: z.string().optional().nullable(),
  gardenId: z.string().optional().nullable(),
  name: z.string().min(1),
  website: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export const OrderItemInputSchema = z.object({
  id: z.string().optional(),
  orderId: z.string().optional(),
  gardenId: z.string().optional().nullable(),
  itemNo: z.string().optional().nullable(),
  flowerName: z.string().min(1),
  cultivarName: z.string().optional().nullable(),
  itemCost: z.number().nonnegative().optional().nullable(),
  quantity: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
})

export const OrderInputSchema = z.object({
  ownerUserId: z.string().optional().nullable(),
  companyId: z.string().min(1),
  invoiceNumber: z.string().optional().nullable(),
  orderDate: z.string().optional().nullable(),
  totalCost: z.number().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(OrderItemInputSchema).default([]),
})

export const AssetInputSchema = z.object({
  ownerUserId: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  asset: z.string().min(1),
  category: z.string().optional().nullable(),
  quantity: z.number().nonnegative().optional().nullable(),
  totalCost: z.number().nonnegative().optional().nullable(),
  purchaseDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  linkedOrderItemIds: z.array(z.string()).optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  invoiceTotal: z.number().nonnegative().optional().nullable(),
})

export const GardenInputSchema = z.object({
  name: z.string().trim().min(1),
  organizationName: z.string().optional().nullable(),
  locationName: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  gardenOptions: z.object({
    gardenAreas: z.array(z.string().trim().min(1)),
    gardenRows: z.array(z.string().trim().min(1)),
    gardenPositions: z.array(z.string().trim().min(1)),
  }).optional(),
})

export const MemberInputSchema = z.object({
  userId: z.string().trim().min(1),
  email: z.string().trim().optional().nullable(),
  displayName: z.string().trim().optional().nullable(),
  role: z.string().trim().min(1),
})

export const InviteInputSchema = z.object({
  gardenId: z.string().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  role: z.string().trim().min(1),
  expiresAt: z.string().optional().nullable(),
})

export const CompanyReassignmentSchema = z.object({
  companyIds: z.array(z.string().trim().min(1)).min(1),
  ownerUserId: z.string().trim().min(1),
})

export const MaintenanceReminderInputSchema = z.object({
  title: z.string().trim().min(1),
  notes: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  relatedRecordIds: z.array(z.string()).optional(),
  source: z.enum(['user', 'agent']).optional(),
  gardenId: z.string().optional().nullable(),
  ownerUserId: z.string().optional().nullable(),
  assignedToUserId: z.string().optional().nullable(),
  visibility: z.enum(['private', 'garden']).optional(),
  priority: z.enum(['normal', 'high']).optional(),
})
