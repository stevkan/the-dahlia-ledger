import { describe, it, expect } from 'vitest'
import { DahliaRecordInputSchema, DahliaPhotoSchema, CompanyInputSchema, OrderInputSchema, AssetInputSchema, GardenInputSchema, MemberInputSchema, InviteInputSchema, CompanyReassignmentSchema, MaintenanceReminderInputSchema } from '../schema.js'

// ---------------------------------------------------------------------------
// DahliaRecordInputSchema
// ---------------------------------------------------------------------------

describe('DahliaRecordInputSchema', () => {
  const minimal = {
    flowerName: 'Bishop of Llandaff',
    seasonYearStart: 2025,
  }

  it('accepts a minimal valid record', () => {
    expect(DahliaRecordInputSchema.safeParse(minimal).success).toBe(true)
  })

  it('rejects a record missing flowerName', () => {
    const { flowerName: _, ...rest } = minimal
    expect(DahliaRecordInputSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects an empty flowerName', () => {
    expect(DahliaRecordInputSchema.safeParse({ ...minimal, flowerName: '' }).success).toBe(false)
  })

  it('rejects a record missing seasonYearStart', () => {
    const { seasonYearStart: _, ...rest } = minimal
    expect(DahliaRecordInputSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a seasonYearStart below 1900', () => {
    expect(DahliaRecordInputSchema.safeParse({ ...minimal, seasonYearStart: 1899 }).success).toBe(false)
  })

  it('rejects a seasonYearStart above 3000', () => {
    expect(DahliaRecordInputSchema.safeParse({ ...minimal, seasonYearStart: 3001 }).success).toBe(false)
  })

  it('rejects a non-integer seasonYearStart', () => {
    expect(DahliaRecordInputSchema.safeParse({ ...minimal, seasonYearStart: 2025.5 }).success).toBe(false)
  })

  it('accepts a valid plantingState', () => {
    const result = DahliaRecordInputSchema.safeParse({ ...minimal, meta: { plantingState: 'in_garden' } })
    expect(result.success).toBe(true)
    expect(result.data?.meta.plantingState).toBe('in_garden')
  })

  it('rejects an unknown plantingState', () => {
    expect(DahliaRecordInputSchema.safeParse({ ...minimal, meta: { plantingState: 'lost' } }).success).toBe(false)
  })

  it('defaults nested objects when omitted', () => {
    const result = DahliaRecordInputSchema.safeParse(minimal)
    expect(result.success).toBe(true)
    expect(result.data?.core).toEqual({})
    expect(result.data?.growth).toEqual({})
    expect(result.data?.tuber).toEqual({})
    expect(result.data?.health).toEqual({})
    expect(result.data?.meta).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// DahliaPhotoSchema
// ---------------------------------------------------------------------------

describe('DahliaPhotoSchema', () => {
  const valid = { id: 'photo-1', imageUrl: 'https://example.com/photo.jpg', scope: 'record' }

  it('accepts a valid photo', () => {
    expect(DahliaPhotoSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a photo with an empty id', () => {
    expect(DahliaPhotoSchema.safeParse({ ...valid, id: '' }).success).toBe(false)
  })

  it('rejects a photo with an empty imageUrl', () => {
    expect(DahliaPhotoSchema.safeParse({ ...valid, imageUrl: '' }).success).toBe(false)
  })

  it('rejects an invalid scope', () => {
    expect(DahliaPhotoSchema.safeParse({ ...valid, scope: 'profile' }).success).toBe(false)
  })

  it('accepts scope "cultivar"', () => {
    expect(DahliaPhotoSchema.safeParse({ ...valid, scope: 'cultivar' }).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CompanyInputSchema
// ---------------------------------------------------------------------------

describe('CompanyInputSchema', () => {
  it('accepts a minimal valid company', () => {
    expect(CompanyInputSchema.safeParse({ name: 'Swan Island Dahlias' }).success).toBe(true)
  })

  it('rejects a company with an empty name', () => {
    expect(CompanyInputSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects a company missing name', () => {
    expect(CompanyInputSchema.safeParse({}).success).toBe(false)
  })

  it('accepts optional fields', () => {
    const result = CompanyInputSchema.safeParse({
      name: 'Acme Dahlias',
      website: 'https://acme.com',
      email: 'info@acme.com',
      notes: 'Great selection',
    })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// OrderInputSchema
// ---------------------------------------------------------------------------

describe('OrderInputSchema', () => {
  const minimal = { companyId: 'company-1', items: [] }

  it('accepts a minimal valid order', () => {
    expect(OrderInputSchema.safeParse(minimal).success).toBe(true)
  })

  it('rejects an order missing companyId', () => {
    expect(OrderInputSchema.safeParse({ items: [] }).success).toBe(false)
  })

  it('rejects an order with an empty companyId', () => {
    expect(OrderInputSchema.safeParse({ companyId: '', items: [] }).success).toBe(false)
  })

  it('defaults items to an empty array when omitted', () => {
    const result = OrderInputSchema.safeParse({ companyId: 'company-1' })
    expect(result.success).toBe(true)
    expect(result.data?.items).toEqual([])
  })

  it('rejects a negative totalCost', () => {
    expect(OrderInputSchema.safeParse({ ...minimal, totalCost: -1 }).success).toBe(false)
  })

  it('accepts an order item with required fields', () => {
    const result = OrderInputSchema.safeParse({
      ...minimal,
      items: [{ flowerName: 'Karma Choc' }],
    })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AssetInputSchema
// ---------------------------------------------------------------------------

describe('AssetInputSchema', () => {
  it('accepts a minimal valid asset', () => {
    expect(AssetInputSchema.safeParse({ asset: 'Drip tape' }).success).toBe(true)
  })

  it('rejects an asset with an empty asset field', () => {
    expect(AssetInputSchema.safeParse({ asset: '' }).success).toBe(false)
  })

  it('rejects an asset missing the asset field', () => {
    expect(AssetInputSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a negative totalCost', () => {
    expect(AssetInputSchema.safeParse({ asset: 'Stakes', totalCost: -5 }).success).toBe(false)
  })

  it('rejects a negative quantity', () => {
    expect(AssetInputSchema.safeParse({ asset: 'Stakes', quantity: -1 }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// GardenInputSchema
// ---------------------------------------------------------------------------

describe('GardenInputSchema', () => {
  it('accepts a minimal valid garden', () => {
    expect(GardenInputSchema.safeParse({ name: 'My Garden' }).success).toBe(true)
  })

  it('rejects a garden with an empty name', () => {
    expect(GardenInputSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects a garden missing name', () => {
    expect(GardenInputSchema.safeParse({}).success).toBe(false)
  })

  it('trims whitespace before checking min length on name', () => {
    expect(GardenInputSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('accepts optional string fields as null', () => {
    const result = GardenInputSchema.safeParse({ name: 'My Garden', organizationName: null, locationName: null, address: null, notes: null })
    expect(result.success).toBe(true)
  })

  it('accepts a full gardenOptions object', () => {
    const result = GardenInputSchema.safeParse({
      name: 'My Garden',
      gardenOptions: { gardenAreas: ['Main'], gardenRows: ['A', 'B'], gardenPositions: ['1', '2'] },
    })
    expect(result.success).toBe(true)
  })

  it('rejects gardenOptions with an empty area name', () => {
    const result = GardenInputSchema.safeParse({
      name: 'My Garden',
      gardenOptions: { gardenAreas: [''], gardenRows: ['A'], gardenPositions: ['1'] },
    })
    expect(result.success).toBe(false)
  })

  it('accepts .partial() for update routes (all fields optional)', () => {
    expect(GardenInputSchema.partial().safeParse({ notes: 'updated' }).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MemberInputSchema
// ---------------------------------------------------------------------------

describe('MemberInputSchema', () => {
  const valid = { userId: 'user-1', role: 'editor' }

  it('accepts a minimal valid member', () => {
    expect(MemberInputSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a member missing userId', () => {
    expect(MemberInputSchema.safeParse({ role: 'editor' }).success).toBe(false)
  })

  it('rejects an empty userId', () => {
    expect(MemberInputSchema.safeParse({ userId: '', role: 'editor' }).success).toBe(false)
  })

  it('rejects a member missing role', () => {
    expect(MemberInputSchema.safeParse({ userId: 'user-1' }).success).toBe(false)
  })

  it('rejects an empty role', () => {
    expect(MemberInputSchema.safeParse({ userId: 'user-1', role: '' }).success).toBe(false)
  })

  it('accepts optional fields as null', () => {
    const result = MemberInputSchema.safeParse({ ...valid, email: null, displayName: null })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// InviteInputSchema
// ---------------------------------------------------------------------------

describe('InviteInputSchema', () => {
  it('accepts a minimal valid invite (role only)', () => {
    expect(InviteInputSchema.safeParse({ role: 'viewer' }).success).toBe(true)
  })

  it('rejects an invite missing role', () => {
    expect(InviteInputSchema.safeParse({ email: 'a@b.com' }).success).toBe(false)
  })

  it('rejects an empty role', () => {
    expect(InviteInputSchema.safeParse({ role: '' }).success).toBe(false)
  })

  it('accepts all optional fields populated', () => {
    const result = InviteInputSchema.safeParse({ gardenId: 'g-1', email: 'a@b.com', role: 'editor', expiresAt: '2025-12-31' })
    expect(result.success).toBe(true)
  })

  it('accepts optional fields as null', () => {
    expect(InviteInputSchema.safeParse({ gardenId: null, email: null, role: 'viewer', expiresAt: null }).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CompanyReassignmentSchema
// ---------------------------------------------------------------------------

describe('CompanyReassignmentSchema', () => {
  const valid = { companyIds: ['company-1', 'company-2'], ownerUserId: 'user-1' }

  it('accepts a valid reassignment', () => {
    expect(CompanyReassignmentSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an empty companyIds array', () => {
    expect(CompanyReassignmentSchema.safeParse({ companyIds: [], ownerUserId: 'user-1' }).success).toBe(false)
  })

  it('rejects a companyId that is an empty string', () => {
    expect(CompanyReassignmentSchema.safeParse({ companyIds: [''], ownerUserId: 'user-1' }).success).toBe(false)
  })

  it('rejects a missing ownerUserId', () => {
    expect(CompanyReassignmentSchema.safeParse({ companyIds: ['company-1'] }).success).toBe(false)
  })

  it('rejects an empty ownerUserId', () => {
    expect(CompanyReassignmentSchema.safeParse({ companyIds: ['company-1'], ownerUserId: '' }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// MaintenanceReminderInputSchema
// ---------------------------------------------------------------------------

describe('MaintenanceReminderInputSchema', () => {
  const minimal = { title: 'Check irrigation' }

  it('accepts a minimal valid reminder', () => {
    expect(MaintenanceReminderInputSchema.safeParse(minimal).success).toBe(true)
  })

  it('rejects a reminder missing title', () => {
    expect(MaintenanceReminderInputSchema.safeParse({}).success).toBe(false)
  })

  it('rejects an empty title (including whitespace-only after trim)', () => {
    expect(MaintenanceReminderInputSchema.safeParse({ title: '' }).success).toBe(false)
    expect(MaintenanceReminderInputSchema.safeParse({ title: '   ' }).success).toBe(false)
  })

  it('accepts a valid YYYY-MM-DD dueDate', () => {
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, dueDate: '2025-06-15' }).success).toBe(true)
  })

  it('accepts an empty string dueDate (clears the field)', () => {
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, dueDate: '' }).success).toBe(true)
  })

  it('rejects a dueDate that is not YYYY-MM-DD format', () => {
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, dueDate: '06/15/2025' }).success).toBe(false)
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, dueDate: '2025-6-15' }).success).toBe(false)
  })

  it('accepts valid source values', () => {
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, source: 'user' }).success).toBe(true)
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, source: 'agent' }).success).toBe(true)
  })

  it('rejects an unknown source value', () => {
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, source: 'system' }).success).toBe(false)
  })

  it('accepts valid visibility values', () => {
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, visibility: 'private' }).success).toBe(true)
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, visibility: 'garden' }).success).toBe(true)
  })

  it('rejects an unknown visibility value', () => {
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, visibility: 'public' }).success).toBe(false)
  })

  it('accepts valid priority values', () => {
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, priority: 'normal' }).success).toBe(true)
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, priority: 'high' }).success).toBe(true)
  })

  it('rejects an unknown priority value', () => {
    expect(MaintenanceReminderInputSchema.safeParse({ ...minimal, priority: 'critical' }).success).toBe(false)
  })
})
