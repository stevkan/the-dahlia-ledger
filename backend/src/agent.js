import OpenAI from 'openai'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listRecords, getRecord } from './records.js'
import { listCompanies, listOrders } from './orders.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROMPTS_DIR = path.resolve(__dirname, '..', 'prompts')
const AGENT_HELPER_PROMPT_PATH = path.join(PROMPTS_DIR, 'agent-helper.md')
const REVIEW_PROMPT_PATH = path.join(PROMPTS_DIR, 'review-agent.md')
const CORRECTION_PROMPT_PATH = path.join(PROMPTS_DIR, 'correction-agent.md')

const VisualizationSchema = z.object({
  type: z.enum(['bar', 'line', 'pie', 'scatter', 'table', 'garden-map']).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  data: z.array(z.record(z.string(), z.any())).default([]),
  xKey: z.string().optional(),
  yKey: z.string().optional(),
  seriesKey: z.string().optional(),
  valueKey: z.string().optional(),
  labelKey: z.string().optional(),
  unit: z.string().optional(),
  renderer: z.enum(['recharts', 'd3', 'table']).optional(),
  xLabelAngle: z.number().optional(),
})

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

const AgentResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('needs_clarification'),
    message: z.string(),
  }),
  z.object({
    status: z.literal('answer'),
    message: z.string(),
    visualization: VisualizationSchema.optional(),
    chart: VisualizationSchema.optional(),
    caveats: z.array(z.string()).optional().default([]),
    sourcesUsed: z.array(z.enum(['records', 'orders', 'companies'])).optional().default([]),
  }).transform((value) => ({
    ...value,
    visualization: value.visualization ?? value.chart,
  })),
])

const AnalyticsFiltersSchema = z.object({
  companies: z.array(z.string()).optional().default([]),
  gardenAreas: z.array(z.string()).optional().default([]),
  plantingStates: z.array(z.string()).optional().default([]),
  colors: z.array(z.string()).optional().default([]),
  forms: z.array(z.string()).optional().default([]),
}).optional().default({})

const MetricSpecSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('needs_clarification'),
    message: z.string(),
  }),
  z.object({
    status: z.literal('metric_request'),
    metric: z.enum([
      'flower_purchase_count_by_company',
      'flower_count_by_color',
      'flower_count_by_garden_area',
      'flower_count_by_planting_state',
      'flower_count_by_form',
      'invoice_total_by_company',
      'flower_count_by_season',
      'height_vs_bloom_size',
      'average_item_cost_by_company',
      'linked_vs_unlinked_purchase_records',
      'missing_data_summary',
      'garden_area_by_planting_state',
      'invoice_total_by_season',
      'flower_count_by_company_and_season',
      'average_item_cost_by_form',
      'garden_fill_by_area',
      'not_viable_reason_summary',
      'not_planted_reason_summary',
      'average_item_cost_by_season',
      'order_count_by_company',
      'flower_count_by_bloom_size',
      'flower_count_by_height',
      'flower_count_by_source',
      'flower_count_by_photo_type',
    ]),
    seasonYearStart: z.number().int().min(1900).max(3000).optional(),
    seasonYearStarts: z.array(z.number().int().min(1900).max(3000)).optional().default([]),
    filters: AnalyticsFiltersSchema,
    photoTypes: z.array(z.enum(['any', 'record', 'cultivar', 'none'])).optional(),
    sortBy: z.enum(['company', 'value_desc', 'value_asc']).optional().default('company'),
    visualization: VisualizationSchema.omit({ data: true }).optional().default({}),
  }),
])

const ReviewFindingSchema = z.object({
  severity: z.enum(['low', 'medium', 'high']),
  field: z.string(),
  issue: z.string(),
  evidence: z.string().optional(),
  suggestedFix: z.string().optional(),
})

export const ReviewResultSchema = z.object({
  status: z.enum(['pass', 'issues_found']),
  summary: z.string(),
  findings: z.array(ReviewFindingSchema).default([]),
  promptSuggestion: z.string().optional().default(''),
})

const StringishSchema = z.preprocess((value) => (value == null ? value : String(value)), z.string().optional())
const OptionalYearSchema = z.preprocess((value) => {
  if (value == null || value === '') return undefined
  const year = Number(value)
  return Number.isFinite(year) ? year : value
}, z.number().int().min(1900).max(3000).optional())
const OptionalDateSchema = z.preprocess((value) => (value == null ? value : String(value)), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional())
const BooleanishSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['yes', 'true', 'y'].includes(normalized)) return true
    if (['no', 'false', 'n'].includes(normalized)) return false
  }
  return value
}, z.boolean().optional())

const RecordPatchSchema = z.object({
  flowerName: StringishSchema,
  gardenLocation: StringishSchema,
  location: StringishSchema,
  seasonYearStart: OptionalYearSchema,
  season: OptionalYearSchema,
  core: z
    .object({
      cultivar: StringishSchema,
      plantedDate: OptionalDateSchema,
      color: StringishSchema,
      form: StringishSchema,
      size: StringishSchema,
      bloomWidth: StringishSchema,
      notes: StringishSchema,
    })
    .optional(),
  growth: z
    .object({
      height: StringishSchema,
      bloomTime: StringishSchema,
      habit: StringishSchema,
    })
    .optional(),
  care: z
    .object({
      sun: StringishSchema,
      water: StringishSchema,
      soil: StringishSchema,
      fertilizer: StringishSchema,
      staking: StringishSchema,
    })
    .optional(),
  tuber: z
    .object({
      source: StringishSchema,
      acquiredYear: OptionalYearSchema,
      containerType: StringishSchema,
      containerFillType: StringishSchema,
      storageNotes: StringishSchema,
      overwintered: BooleanishSchema,
      linkedOrderItemIds: z.array(z.string()).optional(),
    })
    .optional(),
  health: z
    .object({
      pests: StringishSchema,
      disease: StringishSchema,
      treatments: StringishSchema,
    })
    .optional(),
  meta: z
    .object({
      gardenArea: StringishSchema,
      gardenRow: StringishSchema,
      gardenPosition: OptionalYearSchema,
      plantingState: z.enum(['garden_tray', 'in_garden', 'not_planted', 'not_viable', 'purchased_container']).optional(),
      notPlantedReason: z.enum(['not_received', 'refunded']).optional(),
      notViableReason: z.enum(['no_longer_present', 'removed', 'unused']).optional(),
    })
    .optional(),
})

const CorrectionResultSchema = z.object({
  recordPatch: RecordPatchSchema,
  summary: z.string(),
  promptSuggestion: z.string().optional().default(''),
})

async function readPrompt(filePath) {
  return await readFile(filePath, 'utf8')
}

function slimRecord(record) {
  return {
    id: record.id,
    recordNumber: record.recordNumber,
    flowerName: record.flowerName,
    seasonYearStart: record.seasonYearStart,
    core: record.core
      ? {
          cultivar: record.core.cultivar,
          plantedDate: record.core.plantedDate,
          color: record.core.color,
          form: record.core.form,
          size: record.core.size,
          notes: record.core.notes,
        }
      : undefined,
    growth: record.growth,
    care: record.care,
    tuber: record.tuber
      ? {
          source: record.tuber.source,
          acquiredYear: record.tuber.acquiredYear,
          storageNotes: record.tuber.storageNotes,
          overwintered: record.tuber.overwintered,
          containerType: record.tuber.containerType,
          containerFillType: record.tuber.containerFillType,
          linkedOrderItemIds: record.tuber.linkedOrderItemIds,
        }
      : undefined,
    health: record.health,
    meta: record.meta
      ? {
          gardenArea: record.meta.gardenArea,
          gardenRow: record.meta.gardenRow,
          gardenPosition: record.meta.gardenPosition,
          gardenZone: record.meta.gardenZone,
          plantingState: record.meta.plantingState,
          notPlantedReason: record.meta.notPlantedReason,
          notViableReason: record.meta.notViableReason,
        }
      : undefined,
  }
}

function slimOrder(order) {
  return {
    id: order.id,
    company: order.company ? { name: order.company.name } : undefined,
    companyName: order.companyName,
    invoiceNumber: order.invoiceNumber,
    orderDate: order.orderDate,
    totalCost: order.totalCost,
    notes: order.notes,
    items: (order.items ?? []).map((item) => ({
      id: item.id,
      flowerName: item.flowerName,
      cultivarName: item.cultivarName,
      itemCost: item.itemCost,
      quantity: item.quantity,
      notes: item.notes,
    })),
  }
}

function slimCompany(company) {
  return {
    id: company.id,
    name: company.name,
    website: company.website,
    email: company.email,
    phone: company.phone,
    notes: company.notes,
  }
}

async function parseJsonResponse(resp) {
  return JSON.parse(resp.output_text)
}

function normalizeRecordKeys(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record

  const next = { ...record }
  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = normalizeRecordKeys(value)
    }
    if (!key.includes('.')) continue

    const parts = key.split('.')
    let target = next
    for (const part of parts.slice(0, -1)) {
      target[part] = target[part] && typeof target[part] === 'object' && !Array.isArray(target[part]) ? target[part] : {}
      target = target[part]
    }
    target[parts.at(-1)] = value
    delete next[key]
  }

  if (next.location !== undefined && next.gardenLocation === undefined) {
    next.gardenLocation = next.location
  }
  delete next.location

  if (next.season !== undefined && next.seasonYearStart === undefined) {
    next.seasonYearStart = next.season
  }
  delete next.season

  if (next.core?.bloomWidth !== undefined && next.core.size === undefined) {
    next.core.size = next.core.bloomWidth
  }
  if (next.core) delete next.core.bloomWidth

  return next
}

function normalizeCompanyKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function buildOrderItemCompanyLookup(orders) {
  const lookup = new Map()
  for (const order of orders) {
    for (const item of order.items ?? []) {
      lookup.set(item.id, order.company?.name || order.companyName || 'Unknown Company')
    }
  }
  return lookup
}

function buildOrderItemLookup(orders) {
  const lookup = new Map()
  for (const order of orders) {
    for (const item of order.items ?? []) {
      lookup.set(item.id, { item, order })
    }
  }
  return lookup
}

function companyNameFromSource(source, companies) {
  const sourceKey = normalizeCompanyKey(source)
  if (!sourceKey) return null

  const exact = companies.find((company) => normalizeCompanyKey(company.name) === sourceKey)
  if (exact) return exact.name

  return String(source).trim() || null
}

function attributedCompanyName(record, { orderItemCompanyById, companies }) {
  const linkedCompanies = new Set(
    (record.tuber?.linkedOrderItemIds ?? [])
      .map((id) => orderItemCompanyById.get(id))
      .filter(Boolean),
  )

  if (linkedCompanies.size > 0) {
    return {
      companyName: Array.from(linkedCompanies).sort((a, b) => String(a).localeCompare(String(b)))[0],
      attribution: 'linked',
    }
  }

  const sourceCompany = companyNameFromSource(record.tuber?.source, companies)
  if (sourceCompany) return { companyName: sourceCompany, attribution: 'source' }
  return { companyName: 'Unmatched', attribution: 'unmatched' }
}

function normalizedSet(values) {
  return new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))
}

function recordMatchesAnalyticsFilters(record, spec, context) {
  const filters = spec.filters ?? {}
  const companyFilters = normalizedSet(filters.companies)
  if (companyFilters.size > 0) {
    const companyName = attributedCompanyName(record, {
      orderItemCompanyById: context.orderItemCompanyById,
      companies: context.companies,
    }).companyName
    if (!companyFilters.has(companyName)) return false
  }

  const gardenAreas = normalizedSet(filters.gardenAreas)
  if (gardenAreas.size > 0 && !gardenAreas.has(String(record.meta?.gardenArea ?? '').trim() || 'Unassigned')) return false

  const plantingStates = normalizedSet(filters.plantingStates)
  if (plantingStates.size > 0 && !plantingStates.has(plantingStateLabel(record.meta?.plantingState) || 'Unspecified')) return false

  const colors = normalizedSet(filters.colors)
  if (colors.size > 0 && !colors.has(String(record.core?.color ?? '').trim() || 'Unspecified')) return false

  const forms = normalizedSet(filters.forms)
  if (forms.size > 0 && !forms.has(String(record.core?.form ?? '').trim() || 'Unspecified')) return false

  const photoTypes = spec.photoTypes
  if (photoTypes?.length) {
    const hasRecord = hasRecordPhoto(record)
    const hasCultivar = hasCultivarPhoto(record)
    const passes = photoTypes.some((type) => {
      if (type === 'any') return hasRecord || hasCultivar
      if (type === 'record') return hasRecord
      if (type === 'cultivar') return hasCultivar
      if (type === 'none') return !hasRecord && !hasCultivar
      return false
    })
    if (!passes) return false
  }

  return true
}

function orderMatchesAnalyticsFilters(order, spec) {
  const filters = spec.filters ?? {}
  const companyFilters = normalizedSet(filters.companies)
  if (companyFilters.size > 0 && !companyFilters.has(String(order.company?.name ?? '').trim() || 'Unmatched')) return false
  return true
}

function applyAnalyticsFilters(context, spec) {
  const orderItemCompanyById = buildOrderItemCompanyLookup(context.orders)
  return {
    ...context,
    records: context.records.filter((record) => recordMatchesAnalyticsFilters(record, spec, { orderItemCompanyById, companies: context.companies })),
    orders: context.orders.filter((order) => orderMatchesAnalyticsFilters(order, spec)),
  }
}

function sortMetricRows(data, sortBy, labelKey, valueKey) {
  data.sort((a, b) => {
    if (sortBy === 'value_desc') return b[valueKey] - a[valueKey] || String(a[labelKey]).localeCompare(String(b[labelKey]))
    if (sortBy === 'value_asc') return a[valueKey] - b[valueKey] || String(a[labelKey]).localeCompare(String(b[labelKey]))
    return String(a[labelKey]).localeCompare(String(b[labelKey]))
  })
  return data
}

function seasonYearsForSpec(spec) {
  if (!spec || typeof spec !== 'object') return spec ? [spec] : []
  const years = spec.seasonYearStarts?.length ? spec.seasonYearStarts : spec.seasonYearStart ? [spec.seasonYearStart] : []
  return Array.from(new Set(years)).sort((a, b) => b - a)
}

function matchesSeason(recordYear, spec) {
  const years = seasonYearsForSpec(spec)
  return years.length === 0 || (recordYear !== undefined && years.includes(recordYear))
}

function seasonListText(spec) {
  const years = seasonYearsForSpec(spec)
  if (years.length === 0) return ''
  if (years.length === 1) return String(years[0])
  return years.join(', ')
}

function titleSuffixForSeason(spec) {
  const text = seasonListText(spec)
  return text ? ` (Season ${text})` : ''
}

function textForSeason(spec) {
  const text = seasonListText(spec)
  return text ? ` for the ${text} season${seasonYearsForSpec(spec).length === 1 ? '' : 's'}` : ''
}

function computeFlowerCountByField({ spec, records, labelKey, valueLabel, title, description, readValue, missingLabel = 'Unspecified' }) {
  const counts = new Map()
  const quality = {
    recordsConsidered: 0,
    missingRecords: 0,
  }

  for (const record of records) {
    if (!matchesSeason(record.seasonYearStart, spec)) continue
    quality.recordsConsidered += 1

    const rawValue = readValue(record)
    const label = String(rawValue ?? '').trim() || missingLabel
    if (label === missingLabel) quality.missingRecords += 1
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  const data = sortMetricRows(Array.from(counts, ([label, flowerCount]) => ({ [labelKey]: label, flowerCount })), spec.sortBy, labelKey, 'flowerCount')
  const caveats = []
  if (quality.missingRecords > 0) caveats.push(`${quality.missingRecords} record${quality.missingRecords === 1 ? '' : 's'} did not have ${valueLabel} and are grouped as ${missingLabel}.`)

  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed flower counts by ${valueLabel}${textForSeason(spec)} from ${quality.recordsConsidered} saved record${quality.recordsConsidered === 1 ? '' : 's'}. ${quality.missingRecords} record${quality.missingRecords === 1 ? '' : 's'} had no ${valueLabel} value.`,
    visualization: {
      type: spec.visualization?.type ?? 'bar',
      title: spec.visualization?.title ?? `${title}${titleSuffixForSeason(spec)}`,
      description,
      data,
      xKey: labelKey,
      yKey: 'flowerCount',
      valueKey: 'flowerCount',
      labelKey,
      unit: 'flowers',
      renderer: spec.visualization?.renderer ?? 'd3',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats,
    sourcesUsed: ['records'],
  })
}

function parseMeasurementInches(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return undefined

  const feetInches = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:(\d+(?:\.\d+)?)\s*(?:in|inch|inches|"))?/)
  if (feetInches) return Number(feetInches[1]) * 12 + Number(feetInches[2] ?? 0)

  const inches = text.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")/)
  if (inches) return Number(inches[1])

  const number = text.match(/\d+(?:\.\d+)?/)
  if (!number) return undefined
  return Number(number[0])
}

function isPresent(value) {
  return String(value ?? '').trim() !== ''
}

const MissingDataFieldReaders = {
  Color: (record) => record.core?.color,
  Form: (record) => record.core?.form,
  Height: (record) => record.growth?.height,
  'Bloom size': (record) => record.core?.size,
  Source: (record) => record.tuber?.source,
  'Linked invoice item': (record) => (record.tuber?.linkedOrderItemIds ?? []).length ? 'linked' : '',
  'Garden area': (record) => record.meta?.gardenArea,
  'Garden row': (record) => record.meta?.gardenRow,
  'Garden position': (record) => record.meta?.gardenPosition,
}

function drilldownRecord(record) {
  return {
    id: record.id,
    recordNumber: record.recordNumber,
    flowerName: record.flowerName,
    cultivar: record.core?.cultivar ?? '',
    seasonYearStart: record.seasonYearStart,
    color: record.core?.color ?? '',
    form: record.core?.form ?? '',
    height: record.growth?.height ?? '',
    size: record.core?.size ?? '',
    source: record.tuber?.source ?? '',
    gardenArea: record.meta?.gardenArea ?? '',
    gardenRow: record.meta?.gardenRow ?? '',
    gardenPosition: record.meta?.gardenPosition ?? '',
    plantingState: plantingStateLabel(record.meta?.plantingState),
    record,
  }
}

function drilldownOrder(order) {
  return {
    id: order.id,
    company: order.company?.name ?? 'Unmatched',
    invoiceNumber: order.invoiceNumber ?? '',
    orderDate: order.orderDate ?? '',
    totalCost: Number.isFinite(Number(order.totalCost)) ? Number(order.totalCost) : undefined,
    itemCount: (order.items ?? []).length,
    notes: order.notes ?? '',
  }
}

function computeFlowerPurchaseCountByCompany({ spec, records, orders, companies }) {
  const orderItemCompanyById = buildOrderItemCompanyLookup(orders)
  const counts = new Map()
  const quality = {
    recordsConsidered: 0,
    linkedOrderItemMatches: 0,
    sourceFallbackMatches: 0,
    unmatchedRecords: 0,
  }

  for (const record of records) {
    if (!matchesSeason(record.seasonYearStart, spec)) continue
    quality.recordsConsidered += 1

    const { companyName, attribution } = attributedCompanyName(record, { orderItemCompanyById, companies })
    if (attribution === 'linked') {
      quality.linkedOrderItemMatches += 1
    } else if (attribution === 'source') {
      quality.sourceFallbackMatches += 1
    } else {
      quality.unmatchedRecords += 1
    }

    counts.set(companyName, (counts.get(companyName) ?? 0) + 1)
  }

  const data = Array.from(counts, ([company, flowerCount]) => ({ company, flowerCount }))
  data.sort((a, b) => {
    if (spec.sortBy === 'value_desc') return b.flowerCount - a.flowerCount || a.company.localeCompare(b.company)
    if (spec.sortBy === 'value_asc') return a.flowerCount - b.flowerCount || a.company.localeCompare(b.company)
    return a.company.localeCompare(b.company)
  })

  const caveats = []
  if (quality.sourceFallbackMatches > 0) caveats.push(`${quality.sourceFallbackMatches} record${quality.sourceFallbackMatches === 1 ? '' : 's'} used tuber.source because no linked order item was present.`)
  if (quality.unmatchedRecords > 0) caveats.push(`${quality.unmatchedRecords} record${quality.unmatchedRecords === 1 ? '' : 's'} could not be matched to a company and are grouped as Unmatched.`)

  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed flower purchase counts by company${textForSeason(spec)} from saved records. ${quality.linkedOrderItemMatches} record${quality.linkedOrderItemMatches === 1 ? '' : 's'} used linked invoice items; ${quality.sourceFallbackMatches} used source fallback; ${quality.unmatchedRecords} were unmatched.`,
    visualization: {
      type: spec.visualization?.type ?? 'bar',
      title: spec.visualization?.title ?? `Number of Flowers Purchased by Company${titleSuffixForSeason(spec)}`,
      description: 'Compares how many flowers are attributed to each company, helping identify your largest suppliers and records that rely on source fallback instead of linked invoice items.',
      data,
      xKey: 'company',
      yKey: 'flowerCount',
      valueKey: 'flowerCount',
      labelKey: 'company',
      unit: 'flowers',
      renderer: spec.visualization?.renderer ?? 'd3',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats,
    sourcesUsed: ['records', 'orders', 'companies'],
  })
}

function computeFlowerCountByColor({ spec, records }) {
  return computeFlowerCountByField({
    spec,
    records,
    labelKey: 'color',
    valueLabel: 'color',
    title: 'Number of Flowers by Color',
    description: 'Shows the color distribution in your saved records, making it easier to spot dominant colors, underrepresented colors, and records grouped as unspecified.',
    readValue: (record) => record.core?.color,
  })
}

function plantingStateLabel(value) {
  return String(value ?? '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function enumReasonLabel(value) {
  return String(value ?? '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function computeFlowerCountByGardenArea({ spec, records }) {
  return computeFlowerCountByField({
    spec,
    records,
    labelKey: 'gardenArea',
    valueLabel: 'garden area',
    title: 'Number of Flowers by Garden Area',
    description: 'Compares flower counts across garden areas so you can see where plants are concentrated and which areas may have extra capacity.',
    readValue: (record) => record.meta?.gardenArea,
    missingLabel: 'Unassigned',
  })
}

function computeFlowerCountByPlantingState({ spec, records }) {
  return computeFlowerCountByField({
    spec,
    records,
    labelKey: 'plantingState',
    valueLabel: 'planting state',
    title: 'Number of Flowers by Planting State',
    description: 'Breaks records down by planting state, showing what is in the garden, still in containers or trays, not planted, or no longer viable.',
    readValue: (record) => plantingStateLabel(record.meta?.plantingState),
    missingLabel: 'Unspecified',
  })
}

function computeFlowerCountByForm({ spec, records }) {
  return computeFlowerCountByField({
    spec,
    records,
    labelKey: 'form',
    valueLabel: 'form',
    title: 'Number of Flowers by Form',
    description: 'Shows the distribution of bloom forms in your collection, helping compare variety mix and identify records with missing form details.',
    readValue: (record) => record.core?.form,
  })
}

function computeFlowerCountBySeason({ spec, records }) {
  return computeFlowerCountByField({
    spec: { ...spec, seasonYearStart: undefined, seasonYearStarts: [] },
    records,
    labelKey: 'season',
    valueLabel: 'season',
    title: 'Number of Flowers by Season',
    description: 'Compares record counts by season, showing how your collection changes over time and which seasons have the most saved flowers.',
    readValue: (record) => record.seasonYearStart,
  })
}

function computeInvoiceTotalByCompany({ spec, orders }) {
  const totals = new Map()
  const quality = {
    ordersConsidered: 0,
    missingTotalOrders: 0,
    missingCompanyOrders: 0,
  }

  for (const order of orders) {
    const orderYear = order.orderDate ? Number(String(order.orderDate).slice(0, 4)) : undefined
    if (!matchesSeason(orderYear, spec)) continue
    quality.ordersConsidered += 1

    const company = String(order.company?.name ?? '').trim() || 'Unmatched'
    if (company === 'Unmatched') quality.missingCompanyOrders += 1
    const total = Number(order.totalCost)
    if (!Number.isFinite(total)) {
      quality.missingTotalOrders += 1
      continue
    }
    totals.set(company, (totals.get(company) ?? 0) + total)
  }

  const data = sortMetricRows(Array.from(totals, ([company, invoiceTotal]) => ({ company, invoiceTotal: Number(invoiceTotal.toFixed(2)) })), spec.sortBy, 'company', 'invoiceTotal')
  const caveats = []
  if (quality.missingTotalOrders > 0) caveats.push(`${quality.missingTotalOrders} invoice${quality.missingTotalOrders === 1 ? '' : 's'} had no totalCost and were excluded from totals.`)
  if (quality.missingCompanyOrders > 0) caveats.push(`${quality.missingCompanyOrders} invoice${quality.missingCompanyOrders === 1 ? '' : 's'} had no matched company and are grouped as Unmatched if they had totals.`)

  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed invoice totals by company${textForSeason(spec)} from ${quality.ordersConsidered} invoice${quality.ordersConsidered === 1 ? '' : 's'}. ${quality.missingTotalOrders} invoice${quality.missingTotalOrders === 1 ? '' : 's'} had no totalCost.`,
    visualization: {
      type: spec.visualization?.type ?? 'bar',
      title: spec.visualization?.title ?? `Invoice Total by Company${titleSuffixForSeason(spec)}`,
      description: 'Compares total invoice spend by company, helping identify where most purchasing dollars went and which suppliers dominate order costs.',
      data,
      xKey: 'company',
      yKey: 'invoiceTotal',
      valueKey: 'invoiceTotal',
      labelKey: 'company',
      unit: 'dollars',
      renderer: spec.visualization?.renderer ?? 'd3',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats,
    sourcesUsed: ['orders', 'companies'],
  })
}

function computeHeightVsBloomSize({ spec, records }) {
  const data = []
  const quality = {
    recordsConsidered: 0,
    missingHeight: 0,
    missingBloomSize: 0,
  }

  for (const record of records) {
    if (!matchesSeason(record.seasonYearStart, spec)) continue
    quality.recordsConsidered += 1

    const heightInches = parseMeasurementInches(record.growth?.height)
    const bloomSizeInches = parseMeasurementInches(record.core?.size)
    if (heightInches === undefined) quality.missingHeight += 1
    if (bloomSizeInches === undefined) quality.missingBloomSize += 1
    if (heightInches === undefined || bloomSizeInches === undefined) continue

    data.push({
      id: record.id,
      flowerName: record.flowerName,
      cultivar: record.core?.cultivar ?? '',
      seasonYearStart: record.seasonYearStart,
      heightInches,
      bloomSizeInches,
    })
  }

  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed height vs bloom size${textForSeason(spec)} from ${data.length} complete record${data.length === 1 ? '' : 's'}. ${quality.missingHeight} record${quality.missingHeight === 1 ? '' : 's'} lacked parseable height; ${quality.missingBloomSize} lacked parseable bloom size.`,
    visualization: {
      type: spec.visualization?.type ?? 'scatter',
      title: spec.visualization?.title ?? `Height vs Bloom Size${titleSuffixForSeason(spec)}`,
      description: 'Plots plant height against bloom size to show whether taller plants tend to produce larger blooms and to reveal compact large-bloom or tall small-bloom outliers.',
      data,
      xKey: 'heightInches',
      yKey: 'bloomSizeInches',
      valueKey: 'bloomSizeInches',
      labelKey: 'flowerName',
      unit: 'inches',
      renderer: spec.visualization?.renderer ?? 'd3',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: [
      ...(quality.missingHeight > 0 ? [`${quality.missingHeight} record${quality.missingHeight === 1 ? '' : 's'} were excluded because height was missing or not parseable.`] : []),
      ...(quality.missingBloomSize > 0 ? [`${quality.missingBloomSize} record${quality.missingBloomSize === 1 ? '' : 's'} were excluded because bloom size was missing or not parseable.`] : []),
    ],
    sourcesUsed: ['records'],
  })
}

function computeAverageItemCostByCompany({ spec, orders }) {
  const stats = new Map()
  const quality = {
    itemsConsidered: 0,
    missingCostItems: 0,
  }

  for (const order of orders) {
    const orderYear = order.orderDate ? Number(String(order.orderDate).slice(0, 4)) : undefined
    if (!matchesSeason(orderYear, spec)) continue
    const company = String(order.company?.name ?? '').trim() || 'Unmatched'
    const stat = stats.get(company) ?? { company, itemCostTotal: 0, pricedItemCount: 0, averageItemCost: 0 }

    for (const item of order.items ?? []) {
      quality.itemsConsidered += 1
      const cost = Number(item.itemCost)
      if (!Number.isFinite(cost)) {
        quality.missingCostItems += 1
        continue
      }
      const quantity = Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0 ? Number(item.quantity) : 1
      stat.itemCostTotal += cost * quantity
      stat.pricedItemCount += quantity
    }

    stats.set(company, stat)
  }

  const data = sortMetricRows(
    Array.from(stats.values())
      .filter((stat) => stat.pricedItemCount > 0)
      .map((stat) => ({
        company: stat.company,
        averageItemCost: Number((stat.itemCostTotal / stat.pricedItemCount).toFixed(2)),
        pricedItemCount: stat.pricedItemCount,
        itemCostTotal: Number(stat.itemCostTotal.toFixed(2)),
      })),
    spec.sortBy,
    'company',
    'averageItemCost',
  )

  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed average item cost by company${textForSeason(spec)} from ${quality.itemsConsidered} invoice item${quality.itemsConsidered === 1 ? '' : 's'}. ${quality.missingCostItems} item${quality.missingCostItems === 1 ? '' : 's'} had no itemCost.`,
    visualization: {
      type: spec.visualization?.type ?? 'bar',
      title: spec.visualization?.title ?? `Average Item Cost by Company${titleSuffixForSeason(spec)}`,
      description: 'Compares average item cost by company, helping evaluate supplier pricing while accounting for item quantities when available.',
      data,
      xKey: 'company',
      yKey: 'averageItemCost',
      valueKey: 'averageItemCost',
      labelKey: 'company',
      unit: 'dollars',
      renderer: spec.visualization?.renderer ?? 'd3',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: quality.missingCostItems > 0 ? [`${quality.missingCostItems} invoice item${quality.missingCostItems === 1 ? '' : 's'} were excluded because itemCost was missing.`] : [],
    sourcesUsed: ['orders', 'companies'],
  })
}

function computeLinkedVsUnlinkedPurchaseRecords({ spec, records }) {
  const buckets = new Map([
    ['Linked invoice item', 0],
    ['Source fallback only', 0],
    ['No source or link', 0],
  ])

  for (const record of records) {
    if (!matchesSeason(record.seasonYearStart, spec)) continue
    if ((record.tuber?.linkedOrderItemIds ?? []).length > 0) {
      buckets.set('Linked invoice item', (buckets.get('Linked invoice item') ?? 0) + 1)
    } else if (isPresent(record.tuber?.source)) {
      buckets.set('Source fallback only', (buckets.get('Source fallback only') ?? 0) + 1)
    } else {
      buckets.set('No source or link', (buckets.get('No source or link') ?? 0) + 1)
    }
  }

  const data = sortMetricRows(Array.from(buckets, ([linkStatus, flowerCount]) => ({ linkStatus, flowerCount })), spec.sortBy, 'linkStatus', 'flowerCount')

  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed purchase-link status${textForSeason(spec)} from ${data.reduce((sum, row) => sum + row.flowerCount, 0)} saved record${data.reduce((sum, row) => sum + row.flowerCount, 0) === 1 ? '' : 's'}.`,
    visualization: {
      type: spec.visualization?.type ?? 'pie',
      title: spec.visualization?.title ?? `Linked vs Unlinked Purchase Records${titleSuffixForSeason(spec)}`,
      description: 'Shows how many purchase records are fully linked to invoice items versus source-only or unlinked, highlighting purchase-tracking completeness.',
      data,
      xKey: 'linkStatus',
      yKey: 'flowerCount',
      valueKey: 'flowerCount',
      labelKey: 'linkStatus',
      unit: 'records',
      renderer: spec.visualization?.renderer ?? 'd3',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: [],
    sourcesUsed: ['records'],
  })
}

function computeMissingDataSummary({ spec, records }) {
  const recordsForSeason = records.filter((record) => matchesSeason(record.seasonYearStart, spec))
  const data = Object.entries(MissingDataFieldReaders).map(([field, readValue]) => {
    const missingCount = recordsForSeason.filter((record) => !isPresent(readValue(record))).length
    return {
      field,
      missingCount,
      presentCount: recordsForSeason.length - missingCount,
      totalRecords: recordsForSeason.length,
    }
  })
  sortMetricRows(data, spec.sortBy, 'field', 'missingCount')

  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed missing data summary${textForSeason(spec)} across ${recordsForSeason.length} saved record${recordsForSeason.length === 1 ? '' : 's'}.`,
    visualization: {
      type: spec.visualization?.type ?? 'table',
      title: spec.visualization?.title ?? `Missing Data Summary${titleSuffixForSeason(spec)}`,
      description: 'Highlights which important record fields are missing most often, helping prioritize cleanup work that will improve filtering, charts, and record quality.',
      data,
      xKey: 'field',
      yKey: 'missingCount',
      valueKey: 'missingCount',
      labelKey: 'field',
      unit: 'records',
      renderer: spec.visualization?.renderer ?? 'table',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: [],
    sourcesUsed: ['records'],
  })
}

function computeGardenAreaByPlantingState({ spec, records }) {
  const rows = new Map()
  const recordsForSeason = records.filter((record) => matchesSeason(record.seasonYearStart, spec))

  for (const record of recordsForSeason) {
    const gardenArea = String(record.meta?.gardenArea ?? '').trim() || 'Unassigned'
    const plantingState = plantingStateLabel(record.meta?.plantingState) || 'Unspecified'
    const key = `${gardenArea}|${plantingState}`
    rows.set(key, { gardenArea, plantingState, flowerCount: (rows.get(key)?.flowerCount ?? 0) + 1 })
  }

  const data = sortMetricRows(Array.from(rows.values()), spec.sortBy, 'gardenArea', 'flowerCount')
  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed garden area by planting state${textForSeason(spec)} from ${recordsForSeason.length} saved record${recordsForSeason.length === 1 ? '' : 's'}.`,
    visualization: {
      type: spec.visualization?.type ?? 'table',
      title: spec.visualization?.title ?? `Garden Area by Planting State${titleSuffixForSeason(spec)}`,
      description: 'Deterministic cross-tab count of records grouped by garden area and planting state.',
      data,
      xKey: 'gardenArea',
      yKey: 'flowerCount',
      seriesKey: 'plantingState',
      valueKey: 'flowerCount',
      labelKey: 'gardenArea',
      unit: 'flowers',
      renderer: spec.visualization?.renderer ?? 'table',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: [],
    sourcesUsed: ['records'],
  })
}

function computeInvoiceTotalBySeason({ spec, orders }) {
  const totals = new Map()
  let missingTotalOrders = 0
  for (const order of orders) {
    const season = order.orderDate ? String(order.orderDate).slice(0, 4) : 'No Date'
    const total = Number(order.totalCost)
    if (!Number.isFinite(total)) {
      missingTotalOrders += 1
      continue
    }
    totals.set(season, (totals.get(season) ?? 0) + total)
  }
  const data = sortMetricRows(Array.from(totals, ([season, invoiceTotal]) => ({ season, invoiceTotal: Number(invoiceTotal.toFixed(2)) })), spec.sortBy, 'season', 'invoiceTotal')
  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed invoice totals by season from ${orders.length} invoice${orders.length === 1 ? '' : 's'}. ${missingTotalOrders} invoice${missingTotalOrders === 1 ? '' : 's'} had no totalCost.`,
    visualization: {
      type: spec.visualization?.type ?? 'line',
      title: spec.visualization?.title ?? 'Invoice Total by Season',
      description: 'Deterministic sum of invoice totalCost values grouped by order date year.',
      data,
      xKey: 'season',
      yKey: 'invoiceTotal',
      valueKey: 'invoiceTotal',
      labelKey: 'season',
      unit: 'dollars',
      renderer: spec.visualization?.renderer ?? 'd3',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: missingTotalOrders > 0 ? [`${missingTotalOrders} invoice${missingTotalOrders === 1 ? '' : 's'} were excluded because totalCost was missing.`] : [],
    sourcesUsed: ['orders'],
  })
}

function computeFlowerCountByCompanyAndSeason({ spec, records, orders, companies }) {
  const orderItemCompanyById = buildOrderItemCompanyLookup(orders)
  const rows = new Map()
  for (const record of records) {
    if (!matchesSeason(record.seasonYearStart, spec)) continue
    const company = attributedCompanyName(record, { orderItemCompanyById, companies }).companyName
    const season = record.seasonYearStart ?? 'Unspecified'
    const key = `${company}|${season}`
    rows.set(key, { company, season, flowerCount: (rows.get(key)?.flowerCount ?? 0) + 1 })
  }
  const data = sortMetricRows(Array.from(rows.values()), spec.sortBy, 'company', 'flowerCount')
  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed flower counts by company and season${textForSeason(spec)} from saved records.`,
    visualization: {
      type: spec.visualization?.type ?? 'table',
      title: spec.visualization?.title ?? `Flower Count by Company and Season${titleSuffixForSeason(spec)}`,
      description: 'Deterministic cross-tab count using linked invoice item attribution, source fallback, then Unmatched.',
      data,
      xKey: 'company',
      yKey: 'flowerCount',
      seriesKey: 'season',
      valueKey: 'flowerCount',
      labelKey: 'company',
      unit: 'flowers',
      renderer: spec.visualization?.renderer ?? 'table',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: [],
    sourcesUsed: ['records', 'orders', 'companies'],
  })
}

function computeAverageItemCostByForm({ spec, records, orders }) {
  const orderItemById = buildOrderItemLookup(orders)
  const stats = new Map()
  let linkedRecords = 0
  let missingCostLinks = 0

  for (const record of records) {
    if (!matchesSeason(record.seasonYearStart, spec)) continue
    const form = String(record.core?.form ?? '').trim() || 'Unspecified'
    for (const itemId of record.tuber?.linkedOrderItemIds ?? []) {
      const linked = orderItemById.get(itemId)
      if (!linked) continue
      linkedRecords += 1
      const cost = Number(linked.item.itemCost)
      if (!Number.isFinite(cost)) {
        missingCostLinks += 1
        continue
      }
      const stat = stats.get(form) ?? { form, itemCostTotal: 0, linkedItemCount: 0, averageItemCost: 0 }
      stat.itemCostTotal += cost
      stat.linkedItemCount += 1
      stats.set(form, stat)
    }
  }

  const data = sortMetricRows(Array.from(stats.values()).map((stat) => ({
    form: stat.form,
    averageItemCost: Number((stat.itemCostTotal / stat.linkedItemCount).toFixed(2)),
    linkedItemCount: stat.linkedItemCount,
    itemCostTotal: Number(stat.itemCostTotal.toFixed(2)),
  })), spec.sortBy, 'form', 'averageItemCost')

  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed average linked item cost by form${textForSeason(spec)} from ${linkedRecords} linked record/item relationship${linkedRecords === 1 ? '' : 's'}. ${missingCostLinks} linked item${missingCostLinks === 1 ? '' : 's'} had no itemCost.`,
    visualization: {
      type: spec.visualization?.type ?? 'bar',
      title: spec.visualization?.title ?? `Average Item Cost by Form${titleSuffixForSeason(spec)}`,
      description: 'Deterministic average using records linked to invoice items, grouped by record form.',
      data,
      xKey: 'form',
      yKey: 'averageItemCost',
      valueKey: 'averageItemCost',
      labelKey: 'form',
      unit: 'dollars',
      renderer: spec.visualization?.renderer ?? 'd3',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: missingCostLinks > 0 ? [`${missingCostLinks} linked item${missingCostLinks === 1 ? '' : 's'} were excluded because itemCost was missing.`] : [],
    sourcesUsed: ['records', 'orders'],
  })
}

function computeGardenFillByArea({ spec, records }) {
  const stats = new Map()
  const recordsForSeason = records.filter((record) => matchesSeason(record.seasonYearStart, spec))
  for (const record of recordsForSeason) {
    const gardenArea = String(record.meta?.gardenArea ?? '').trim() || 'Unassigned'
    const stat = stats.get(gardenArea) ?? { gardenArea, flowerCount: 0, assignedPositionCount: 0, rows: new Set() }
    stat.flowerCount += 1
    if (isPresent(record.meta?.gardenPosition)) stat.assignedPositionCount += 1
    if (isPresent(record.meta?.gardenRow)) stat.rows.add(record.meta.gardenRow)
    stats.set(gardenArea, stat)
  }
  const data = sortMetricRows(Array.from(stats.values()).map((stat) => ({
    gardenArea: stat.gardenArea,
    flowerCount: stat.flowerCount,
    assignedPositionCount: stat.assignedPositionCount,
    rowCount: stat.rows.size,
  })), spec.sortBy, 'gardenArea', 'flowerCount')
  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed garden fill by area${textForSeason(spec)} from ${recordsForSeason.length} saved record${recordsForSeason.length === 1 ? '' : 's'}.`,
    visualization: {
      type: spec.visualization?.type ?? 'table',
      title: spec.visualization?.title ?? `Garden Fill by Area${titleSuffixForSeason(spec)}`,
      description: 'Deterministic area summary with record count, assigned position count, and distinct row count.',
      data,
      xKey: 'gardenArea',
      yKey: 'flowerCount',
      valueKey: 'flowerCount',
      labelKey: 'gardenArea',
      unit: 'flowers',
      renderer: spec.visualization?.renderer ?? 'table',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: [],
    sourcesUsed: ['records'],
  })
}

function computeReasonSummary({ spec, records, plantingState, reasonKey, label, title }) {
  const filtered = records.filter((record) => (!spec.seasonYearStart || record.seasonYearStart === spec.seasonYearStart) && record.meta?.plantingState === plantingState)
  const counts = new Map()
  for (const record of filtered) {
    const reason = enumReasonLabel(record.meta?.[reasonKey]) || 'Unspecified'
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  const data = sortMetricRows(Array.from(counts, ([reason, flowerCount]) => ({ reason, flowerCount })), spec.sortBy, 'reason', 'flowerCount')
  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed ${label}${textForSeason(spec)} from ${filtered.length} matching record${filtered.length === 1 ? '' : 's'}.`,
    visualization: {
      type: spec.visualization?.type ?? 'bar',
      title: spec.visualization?.title ?? `${title}${titleSuffixForSeason(spec)}`,
      description: `Deterministic count of ${label} grouped by saved reason field.`,
      data,
      xKey: 'reason',
      yKey: 'flowerCount',
      valueKey: 'flowerCount',
      labelKey: 'reason',
      unit: 'records',
      renderer: spec.visualization?.renderer ?? 'd3',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: [],
    sourcesUsed: ['records'],
  })
}

function computeAverageItemCostBySeason({ spec, orders }) {
  const stats = new Map()
  let itemsConsidered = 0
  let missingCostItems = 0

  for (const order of orders) {
    const season = order.orderDate ? String(order.orderDate).slice(0, 4) : 'No Date'
    const stat = stats.get(season) ?? { season, itemCostTotal: 0, pricedItemCount: 0 }

    for (const item of order.items ?? []) {
      itemsConsidered += 1
      const cost = Number(item.itemCost)
      if (!Number.isFinite(cost)) {
        missingCostItems += 1
        continue
      }
      const quantity = Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0 ? Number(item.quantity) : 1
      stat.itemCostTotal += cost * quantity
      stat.pricedItemCount += quantity
    }

    stats.set(season, stat)
  }

  const data = sortMetricRows(
    Array.from(stats.values())
      .filter((stat) => stat.pricedItemCount > 0)
      .map((stat) => ({
        season: stat.season,
        averageItemCost: Number((stat.itemCostTotal / stat.pricedItemCount).toFixed(2)),
        pricedItemCount: stat.pricedItemCount,
      })),
    spec.sortBy,
    'season',
    'averageItemCost',
  )

  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed average item cost by season from ${itemsConsidered} invoice item${itemsConsidered === 1 ? '' : 's'}. ${missingCostItems} item${missingCostItems === 1 ? '' : 's'} had no itemCost.`,
    visualization: {
      type: spec.visualization?.type ?? 'line',
      title: spec.visualization?.title ?? 'Average Item Cost by Season',
      description: 'Compares the average cost per item across seasons, helping track price trends over time.',
      data,
      xKey: 'season',
      yKey: 'averageItemCost',
      valueKey: 'averageItemCost',
      labelKey: 'season',
      unit: 'dollars',
      renderer: spec.visualization?.renderer ?? 'd3',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: missingCostItems > 0 ? [`${missingCostItems} invoice item${missingCostItems === 1 ? '' : 's'} were excluded because itemCost was missing.`] : [],
    sourcesUsed: ['orders'],
  })
}

function computeOrderCountByCompany({ spec, orders }) {
  const counts = new Map()
  let missingCompanyOrders = 0

  for (const order of orders) {
    const orderYear = order.orderDate ? Number(String(order.orderDate).slice(0, 4)) : undefined
    if (!matchesSeason(orderYear, spec)) continue
    const company = String(order.company?.name ?? '').trim() || 'Unmatched'
    if (company === 'Unmatched') missingCompanyOrders += 1
    counts.set(company, (counts.get(company) ?? 0) + 1)
  }

  const data = sortMetricRows(Array.from(counts, ([company, orderCount]) => ({ company, orderCount })), spec.sortBy, 'company', 'orderCount')

  return AgentResultSchema.parse({
    status: 'answer',
    message: `Computed order counts by company${textForSeason(spec)} from ${orders.length} invoice${orders.length === 1 ? '' : 's'}.`,
    visualization: {
      type: spec.visualization?.type ?? 'bar',
      title: spec.visualization?.title ?? `Order Count by Company${titleSuffixForSeason(spec)}`,
      description: 'Compares how many separate orders were placed with each company, showing purchase frequency rather than total spend.',
      data,
      xKey: 'company',
      yKey: 'orderCount',
      valueKey: 'orderCount',
      labelKey: 'company',
      unit: 'orders',
      renderer: spec.visualization?.renderer ?? 'd3',
      xLabelAngle: spec.visualization?.xLabelAngle,
    },
    caveats: missingCompanyOrders > 0 ? [`${missingCompanyOrders} order${missingCompanyOrders === 1 ? '' : 's'} had no matched company and are grouped as Unmatched.`] : [],
    sourcesUsed: ['orders', 'companies'],
  })
}

function computeFlowerCountByBloomSize({ spec, records }) {
  return computeFlowerCountByField({
    spec,
    records,
    labelKey: 'bloomSize',
    valueLabel: 'bloom size',
    title: 'Number of Flowers by Bloom Size',
    description: 'Shows the distribution of bloom sizes across your saved records, helping identify the most common size categories and records with missing size data.',
    readValue: (record) => record.core?.size,
  })
}

function computeFlowerCountByHeight({ spec, records }) {
  return computeFlowerCountByField({
    spec,
    records,
    labelKey: 'height',
    valueLabel: 'height',
    title: 'Number of Flowers by Height',
    description: 'Shows the distribution of plant heights across your saved records, helping compare height variety and identify records with missing height data.',
    readValue: (record) => record.growth?.height,
  })
}

function computeFlowerCountBySource({ spec, records }) {
  return computeFlowerCountByField({
    spec,
    records,
    labelKey: 'source',
    valueLabel: 'source',
    title: 'Number of Flowers by Source',
    description: 'Breaks down records by the tuber source field, showing how many flowers came from each listed source or supplier name.',
    readValue: (record) => record.tuber?.source,
  })
}

function hasRecordPhoto(record) {
  return (record.recordPhotos?.length ?? 0) > 0 || !!record.imageUrl || !!record.thumbnailUrl
}

function hasCultivarPhoto(record) {
  return (record.cultivarPhotos?.length ?? 0) > 0 || !!record.cultivarImageUrl || !!record.cultivarThumbnailUrl
}

function computeFlowerCountByPhotoType({ spec, records }) {
  const requestedTypes = spec.photoTypes?.length ? spec.photoTypes : ['any', 'record', 'cultivar', 'none']
  const categories = [
    { key: 'any', label: 'Any photos', test: (r) => hasRecordPhoto(r) || hasCultivarPhoto(r) },
    { key: 'record', label: 'Record photos', test: hasRecordPhoto },
    { key: 'cultivar', label: 'Cultivar photos', test: hasCultivarPhoto },
    { key: 'none', label: 'No photos', test: (r) => !hasRecordPhoto(r) && !hasCultivarPhoto(r) },
  ].filter((cat) => requestedTypes.includes(cat.key))

  const recordsForSeason = records.filter((record) => matchesSeason(record.seasonYearStart, spec))
  const total = recordsForSeason.length

  const data = categories.map(({ label, test }) => ({
    'Photo Type': label,
    Count: recordsForSeason.filter(test).length,
  }))

  return AgentResultSchema.parse({
    status: 'answer',
    message: `Photo coverage across ${total} record${total === 1 ? '' : 's'}${textForSeason(spec)}.`,
    visualization: {
      type: 'table',
      renderer: 'table',
      title: `Flowers by Photo Type${titleSuffixForSeason(spec)}`,
      description: 'Shows how many records have record-level photos, cultivar-level photos, both types, or no photos at all. Records can appear in multiple rows.',
      data,
      labelKey: 'Photo Type',
      valueKey: 'Count',
    },
    sourcesUsed: ['records'],
  })
}

function computeMetric(spec, context) {
  context = applyAnalyticsFilters(context, spec)

  if (spec.metric === 'flower_purchase_count_by_company') {
    return computeFlowerPurchaseCountByCompany({ spec, ...context })
  }
  if (spec.metric === 'flower_count_by_color') {
    return computeFlowerCountByColor({ spec, ...context })
  }
  if (spec.metric === 'flower_count_by_garden_area') {
    return computeFlowerCountByGardenArea({ spec, ...context })
  }
  if (spec.metric === 'flower_count_by_planting_state') {
    return computeFlowerCountByPlantingState({ spec, ...context })
  }
  if (spec.metric === 'flower_count_by_form') {
    return computeFlowerCountByForm({ spec, ...context })
  }
  if (spec.metric === 'invoice_total_by_company') {
    return computeInvoiceTotalByCompany({ spec, ...context })
  }
  if (spec.metric === 'flower_count_by_season') {
    return computeFlowerCountBySeason({ spec, ...context })
  }
  if (spec.metric === 'height_vs_bloom_size') {
    return computeHeightVsBloomSize({ spec, ...context })
  }
  if (spec.metric === 'average_item_cost_by_company') {
    return computeAverageItemCostByCompany({ spec, ...context })
  }
  if (spec.metric === 'linked_vs_unlinked_purchase_records') {
    return computeLinkedVsUnlinkedPurchaseRecords({ spec, ...context })
  }
  if (spec.metric === 'missing_data_summary') {
    return computeMissingDataSummary({ spec, ...context })
  }
  if (spec.metric === 'garden_area_by_planting_state') {
    return computeGardenAreaByPlantingState({ spec, ...context })
  }
  if (spec.metric === 'invoice_total_by_season') {
    return computeInvoiceTotalBySeason({ spec, ...context })
  }
  if (spec.metric === 'flower_count_by_company_and_season') {
    return computeFlowerCountByCompanyAndSeason({ spec, ...context })
  }
  if (spec.metric === 'average_item_cost_by_form') {
    return computeAverageItemCostByForm({ spec, ...context })
  }
  if (spec.metric === 'garden_fill_by_area') {
    return computeGardenFillByArea({ spec, ...context })
  }
  if (spec.metric === 'not_viable_reason_summary') {
    return computeReasonSummary({ spec, ...context, plantingState: 'not_viable', reasonKey: 'notViableReason', label: 'not viable reason summary', title: 'Not Viable Reason Summary' })
  }
  if (spec.metric === 'not_planted_reason_summary') {
    return computeReasonSummary({ spec, ...context, plantingState: 'not_planted', reasonKey: 'notPlantedReason', label: 'not planted reason summary', title: 'Not Planted Reason Summary' })
  }
  if (spec.metric === 'average_item_cost_by_season') {
    return computeAverageItemCostBySeason({ spec, ...context })
  }
  if (spec.metric === 'order_count_by_company') {
    return computeOrderCountByCompany({ spec, ...context })
  }
  if (spec.metric === 'flower_count_by_bloom_size') {
    return computeFlowerCountByBloomSize({ spec, ...context })
  }
  if (spec.metric === 'flower_count_by_height') {
    return computeFlowerCountByHeight({ spec, ...context })
  }
  if (spec.metric === 'flower_count_by_source') {
    return computeFlowerCountBySource({ spec, ...context })
  }
  if (spec.metric === 'flower_count_by_photo_type') {
    return computeFlowerCountByPhotoType({ spec, ...context })
  }

  return AgentResultSchema.parse({
    status: 'needs_clarification',
    message: 'That metric is not supported by the deterministic metrics engine yet.',
  })
}

async function getAgentContext() {
  const [records, orders, companies] = await Promise.all([
    listRecords().catch(() => []),
    listOrders().catch(() => []),
    listCompanies().catch(() => []),
  ])
  return { records, orders, companies }
}

export async function runMetricRequest(specInput) {
  const spec = MetricSpecSchema.safeParse({ status: 'metric_request', ...specInput })
  if (!spec.success) {
    return AgentResultSchema.parse({
      status: 'needs_clarification',
      message: `I could not generate that chart: ${z.prettifyError(spec.error)}`,
    })
  }

  return computeMetric(spec.data, await getAgentContext())
}

export async function runMetricDrilldown(input) {
  const context = applyAnalyticsFilters(await getAgentContext(), input)
  const { records, orders, companies } = context
  const recordsForSeason = records.filter((record) => matchesSeason(record.seasonYearStart, input))
  let title = 'Drilldown Records'
  let filtered = []

  if (input.metric === 'missing_data_summary') {
    const readValue = MissingDataFieldReaders[input.field]
    if (!readValue) return { title: 'Unsupported missing data field', records: [] }
    title = `Records Missing ${input.field}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => !isPresent(readValue(record)))
  } else if (input.metric === 'flower_count_by_color') {
    title = `Records with Color: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => (String(record.core?.color ?? '').trim() || 'Unspecified') === input.bucket)
  } else if (input.metric === 'flower_count_by_garden_area') {
    title = `Records in Garden Area: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => (String(record.meta?.gardenArea ?? '').trim() || 'Unassigned') === input.bucket)
  } else if (input.metric === 'flower_count_by_form') {
    title = `Records with Form: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => (String(record.core?.form ?? '').trim() || 'Unspecified') === input.bucket)
  } else if (input.metric === 'flower_count_by_planting_state') {
    title = `Records with Planting State: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => (plantingStateLabel(record.meta?.plantingState) || 'Unspecified') === input.bucket)
  } else if (input.metric === 'linked_vs_unlinked_purchase_records') {
    title = `Records in Bucket: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => {
      const bucket = (record.tuber?.linkedOrderItemIds ?? []).length > 0 ? 'Linked invoice item' : isPresent(record.tuber?.source) ? 'Source fallback only' : 'No source or link'
      return bucket === input.bucket
    })
  } else if (input.metric === 'flower_purchase_count_by_company') {
    const orderItemCompanyById = buildOrderItemCompanyLookup(orders)
    title = `Records Attributed to Company: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => attributedCompanyName(record, { orderItemCompanyById, companies }).companyName === input.bucket)
  } else if (input.metric === 'invoice_total_by_company') {
    const orderRows = orders
      .filter((order) => {
        const orderYear = order.orderDate ? Number(String(order.orderDate).slice(0, 4)) : undefined
        if (!matchesSeason(orderYear, input)) return false
        const company = String(order.company?.name ?? '').trim() || 'Unmatched'
        return company === input.bucket
      })
      .map(drilldownOrder)
    return {
      type: 'orders',
      title: `Invoices for Company: ${input.bucket}${titleSuffixForSeason(input)}`,
      orders: orderRows,
    }
  } else if (input.metric === 'flower_count_by_season') {
    const season = Number(input.bucket)
    if (!Number.isFinite(season)) return { title: 'Unsupported season drilldown', records: [] }
    title = `Records in Season: ${season}`
    filtered = records.filter((record) => record.seasonYearStart === season)
  } else if (input.metric === 'height_vs_bloom_size') {
    const id = String(input.bucket ?? '')
    title = 'Height vs Bloom Size Record'
    filtered = recordsForSeason.filter((record) => record.id === id)
  } else if (input.metric === 'garden_area_by_planting_state') {
    const [gardenArea, plantingState] = String(input.bucket ?? '').split('|')
    title = `Records in ${gardenArea} with Planting State: ${plantingState}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => (String(record.meta?.gardenArea ?? '').trim() || 'Unassigned') === gardenArea && (plantingStateLabel(record.meta?.plantingState) || 'Unspecified') === plantingState)
  } else if (input.metric === 'invoice_total_by_season') {
    const orderRows = orders
      .filter((order) => (order.orderDate ? String(order.orderDate).slice(0, 4) : 'No Date') === String(input.bucket ?? ''))
      .map(drilldownOrder)
    return {
      type: 'orders',
      title: `Invoices in Season: ${input.bucket}`,
      orders: orderRows,
    }
  } else if (input.metric === 'flower_count_by_company_and_season') {
    const [company, seasonText] = String(input.bucket ?? '').split('|')
    const season = Number(seasonText)
    const orderItemCompanyById = buildOrderItemCompanyLookup(orders)
    title = `Records for ${company} in Season ${seasonText}`
    filtered = records.filter((record) => record.seasonYearStart === season && attributedCompanyName(record, { orderItemCompanyById, companies }).companyName === company)
  } else if (input.metric === 'average_item_cost_by_form') {
    title = `Records with Linked Item Cost for Form: ${input.bucket}${titleSuffixForSeason(input)}`
    const orderItemById = buildOrderItemLookup(orders)
    filtered = recordsForSeason.filter((record) => {
      const form = String(record.core?.form ?? '').trim() || 'Unspecified'
      return form === input.bucket && (record.tuber?.linkedOrderItemIds ?? []).some((id) => Number.isFinite(Number(orderItemById.get(id)?.item.itemCost)))
    })
  } else if (input.metric === 'garden_fill_by_area') {
    title = `Records in Garden Area: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => (String(record.meta?.gardenArea ?? '').trim() || 'Unassigned') === input.bucket)
  } else if (input.metric === 'not_viable_reason_summary') {
    title = `Not Viable Records with Reason: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => record.meta?.plantingState === 'not_viable' && (enumReasonLabel(record.meta?.notViableReason) || 'Unspecified') === input.bucket)
  } else if (input.metric === 'not_planted_reason_summary') {
    title = `Not Planted Records with Reason: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => record.meta?.plantingState === 'not_planted' && (enumReasonLabel(record.meta?.notPlantedReason) || 'Unspecified') === input.bucket)
  } else if (input.metric === 'average_item_cost_by_season') {
    const orderRows = orders
      .filter((order) => (order.orderDate ? String(order.orderDate).slice(0, 4) : 'No Date') === String(input.bucket ?? ''))
      .map(drilldownOrder)
    return { type: 'orders', title: `Invoices in Season: ${input.bucket}`, orders: orderRows }
  } else if (input.metric === 'order_count_by_company') {
    const orderRows = orders
      .filter((order) => {
        const orderYear = order.orderDate ? Number(String(order.orderDate).slice(0, 4)) : undefined
        if (!matchesSeason(orderYear, input)) return false
        return (String(order.company?.name ?? '').trim() || 'Unmatched') === input.bucket
      })
      .map(drilldownOrder)
    return { type: 'orders', title: `Invoices for Company: ${input.bucket}${titleSuffixForSeason(input)}`, orders: orderRows }
  } else if (input.metric === 'flower_count_by_bloom_size') {
    title = `Records with Bloom Size: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => (String(record.core?.size ?? '').trim() || 'Unspecified') === input.bucket)
  } else if (input.metric === 'flower_count_by_height') {
    title = `Records with Height: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => (String(record.growth?.height ?? '').trim() || 'Unspecified') === input.bucket)
  } else if (input.metric === 'flower_count_by_source') {
    title = `Records with Source: ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => (String(record.tuber?.source ?? '').trim() || 'Unspecified') === input.bucket)
  } else if (input.metric === 'flower_count_by_photo_type') {
    const labelToKey = { 'Any photos': 'any', 'Record photos': 'record', 'Cultivar photos': 'cultivar', 'No photos': 'none' }
    const key = labelToKey[input.bucket]
    if (!key) return { title: 'Unsupported photo type drilldown', records: [] }
    title = `Records with ${input.bucket}${titleSuffixForSeason(input)}`
    filtered = recordsForSeason.filter((record) => {
      if (key === 'any') return hasRecordPhoto(record) || hasCultivarPhoto(record)
      if (key === 'record') return hasRecordPhoto(record)
      if (key === 'cultivar') return hasCultivarPhoto(record)
      if (key === 'none') return !hasRecordPhoto(record) && !hasCultivarPhoto(record)
      return false
    })
  } else {
    return { title: 'Unsupported drilldown', records: [] }
  }

  return {
    type: 'records',
    title,
    records: filtered.map(drilldownRecord),
  }
}

export async function ingestText(text) {
  const client = getClient()
  if (!client) {
    return AgentResultSchema.parse({
      status: 'needs_clarification',
      message: 'Agent unavailable because OPENAI_API_KEY is not configured.',
    })
  }

  const { records, orders, companies } = await getAgentContext()

  const system = await readPrompt(AGENT_HELPER_PROMPT_PATH)
  const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'

  const resp = await client.responses.create({
    model,
    input: [
      {
        role: 'system',
        content: system,
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: text,
          generatedAt: new Date().toISOString(),
          records: records.map(slimRecord),
          orders: orders.map(slimOrder),
          companies: companies.map(slimCompany),
        }),
      },
    ],
    text: { format: { type: 'json_object' } },
  })

  try {
    return AgentResultSchema.parse(await parseJsonResponse(resp))
  } catch (error) {
    console.warn('Agent helper response validation failed:', error)
    return AgentResultSchema.parse({
      status: 'needs_clarification',
      message: 'I could not parse the Agent Helper response. Please restate the dahlia or saved-records question.',
    })
  }
}

export async function reviewRecordMapping({ originalText, record, recordId }) {
  const client = getClient()
  if (!client) {
    throw new Error('Agent unavailable because OPENAI_API_KEY is not configured.')
  }

  const reviewRecord = recordId ? await getRecord(recordId) : record
  if (!reviewRecord) throw new Error('Record not found.')
  const reviewText = originalText?.trim() || reviewRecord.meta?.agentOriginalInput?.trim()
  if (!reviewText) throw new Error('Debug review needs the original Agent Input text for this record.')

  const system = await readPrompt(REVIEW_PROMPT_PATH)
  const resp = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content: system,
      },
      {
        role: 'user',
        content: JSON.stringify({ originalText: reviewText, record: reviewRecord }),
      },
    ],
    text: { format: { type: 'json_object' } },
  })

  let parsed
  try {
    parsed = await parseJsonResponse(resp)
  } catch {
    throw new Error('Debug review agent returned invalid JSON.')
  }

  return ReviewResultSchema.parse(parsed)
}

export async function proposeMissedIssueCorrection({ originalText, record, recordId, review, userCorrection }) {
  const client = getClient()
  if (!client) {
    throw new Error('Agent unavailable because OPENAI_API_KEY is not configured.')
  }

  const correctionRecord = recordId ? await getRecord(recordId) : record
  if (!correctionRecord) throw new Error('Record not found.')
  const correctionText = originalText?.trim() || correctionRecord.meta?.agentOriginalInput?.trim()
  if (!correctionText) throw new Error('Correction needs the original Agent Input text for this record.')

  const system = await readPrompt(CORRECTION_PROMPT_PATH)
  const resp = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content: system,
      },
      {
        role: 'user',
        content: JSON.stringify({ originalText: correctionText, record: correctionRecord, review, userCorrection }),
      },
    ],
    text: { format: { type: 'json_object' } },
  })

  let parsed
  try {
    parsed = await parseJsonResponse(resp)
  } catch {
    throw new Error('Correction agent returned invalid JSON.')
  }

  return CorrectionResultSchema.parse({
    ...parsed,
    recordPatch: normalizeRecordKeys(parsed.recordPatch ?? {}),
  })
}
