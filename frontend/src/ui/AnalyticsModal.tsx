import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { jsPDF } from 'jspdf'
import type { AgentVisualization, Company, DahliaRecord } from '../types'
import { api } from '../api/client'
import { DahliaPickerField } from './DahliaPickerField'
import { formatGardenLocation, resolveRecordPhoto } from './RecordsTable'

const AgentVisualizationView = lazy(async () => {
  const module = await import('./AgentVisualizationView')
  return { default: module.AgentVisualizationView }
})

function openPdfInNewTab(pdf: jsPDF, targetWindow?: Window | null) {
  const blob = pdf.output('blob')
  const url = URL.createObjectURL(blob)
  const opened = targetWindow ?? window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) throw new Error('Pop-up blocked. Allow pop-ups for this site to view the PDF export.')
  if (targetWindow) targetWindow.location.href = url
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function formatPdfCell(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  return String(value)
}

function addTablePdf({ title, subtitle, columns, rows }: { title: string; subtitle?: string; columns: Array<{ key: string; label: string }>; rows: Record<string, unknown>[] }) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 36
  const usableWidth = pageWidth - margin * 2
  const colWidth = usableWidth / columns.length
  let y = margin

  function addHeader() {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.text(title, margin, y)
    y += 18
    if (subtitle) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.text(pdf.splitTextToSize(subtitle, usableWidth), margin, y)
      y += 26
    }
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    columns.forEach((column, index) => pdf.text(column.label, margin + index * colWidth, y, { maxWidth: colWidth - 4 }))
    y += 12
    pdf.line(margin, y, pageWidth - margin, y)
    y += 12
    pdf.setFont('helvetica', 'normal')
  }

  addHeader()
  pdf.setFontSize(8)
  for (const row of rows) {
    const cellLines = columns.map((column) => pdf.splitTextToSize(formatPdfCell(row[column.key]), colWidth - 4))
    const rowHeight = Math.max(14, ...cellLines.map((lines) => lines.length * 10))
    if (y + rowHeight > pageHeight - margin) {
      pdf.addPage('letter', 'landscape')
      y = margin
      addHeader()
      pdf.setFontSize(8)
    }
    cellLines.forEach((lines, index) => pdf.text(lines, margin + index * colWidth, y, { maxWidth: colWidth - 4 }))
    y += rowHeight
  }

  return pdf
}

type AgentResult =
  | {
      status: 'needs_clarification'
      message: string
    }
  | {
      status: 'answer'
      message: string
      visualization?: AgentVisualization
      chart?: AgentVisualization
      caveats?: string[]
      sourcesUsed?: Array<'records' | 'orders' | 'companies'>
    }

type AnalyticsMetric =
  | 'flower_purchase_count_by_company'
  | 'flower_count_by_color'
  | 'flower_count_by_garden_area'
  | 'flower_count_by_planting_state'
  | 'flower_count_by_form'
  | 'invoice_total_by_company'
  | 'flower_count_by_season'
  | 'height_vs_bloom_size'
  | 'average_item_cost_by_company'
  | 'linked_vs_unlinked_purchase_records'
  | 'missing_data_summary'
  | 'garden_area_by_planting_state'
  | 'invoice_total_by_season'
  | 'flower_count_by_company_and_season'
  | 'average_item_cost_by_form'
  | 'garden_fill_by_area'
  | 'not_viable_reason_summary'
  | 'not_planted_reason_summary'
  | 'average_item_cost_by_season'
  | 'order_count_by_company'
  | 'flower_count_by_bloom_size'
  | 'flower_count_by_height'
  | 'flower_count_by_source'
  | 'flower_count_by_photo_type'
type AnalyticsSort = 'company' | 'value_desc' | 'value_asc'
type AnalyticsChartType = 'bar' | 'line' | 'pie' | 'scatter' | 'table'
type AnalyticsFilters = {
  companies: string[]
  gardenAreas: string[]
  plantingStates: string[]
  colors: string[]
  forms: string[]
}

type AnalyticsDrilldownRecord = {
  id: string
  recordNumber?: number
  flowerName: string
  cultivar?: string
  seasonYearStart?: number
  color?: string
  form?: string
  height?: string
  size?: string
  source?: string
  gardenArea?: string
  gardenRow?: string
  gardenPosition?: string | number
  record: DahliaRecord
}

type AnalyticsDrilldown = {
  type?: 'records' | 'orders'
  title: string
  records?: AnalyticsDrilldownRecord[]
  orders?: Array<{
    id: string
    company: string
    invoiceNumber?: string
    orderDate?: string
    totalCost?: number
    itemCount?: number
    notes?: string
  }>
}

type DrilldownSort = {
  table: 'records' | 'orders'
  key: string
  direction: 'asc' | 'desc'
}

type DrilldownRecordColumnId =
  | 'recordNumber'
  | 'thumb'
  | 'flowerName'
  | 'cultivar'
  | 'color'
  | 'size'
  | 'height'
  | 'location'
  | 'seasonYearStart'
  | 'source'
  | 'plantedDate'

const DRILLDOWN_RECORD_COLUMN_DEFINITIONS: Array<{ id: DrilldownRecordColumnId; label: string; sortable?: boolean }> = [
  { id: 'recordNumber', label: 'Record #' },
  { id: 'thumb', label: 'Photo', sortable: false },
  { id: 'flowerName', label: 'Flower' },
  { id: 'cultivar', label: 'Cultivar' },
  { id: 'color', label: 'Color' },
  { id: 'size', label: 'Bloom Width' },
  { id: 'height', label: 'Height' },
  { id: 'location', label: 'Location' },
  { id: 'seasonYearStart', label: 'Season' },
  { id: 'source', label: 'Company' },
  { id: 'plantedDate', label: 'Planting Date' },
]

const ALPHABETICAL_DRILLDOWN_RECORD_COLUMN_DEFINITIONS = [...DRILLDOWN_RECORD_COLUMN_DEFINITIONS].sort((a, b) => a.label.localeCompare(b.label))
const SORTABLE_DRILLDOWN_RECORD_COLUMN_DEFINITIONS = ALPHABETICAL_DRILLDOWN_RECORD_COLUMN_DEFINITIONS.filter((column) => column.sortable !== false)

function toColumnMajorOrder<T>(items: T[], columns: number) {
  const rows = Math.ceil(items.length / columns)
  const ordered: T[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const index = col * rows + row
      if (index < items.length) ordered.push(items[index])
    }
  }
  return ordered
}

const DRILLDOWN_RECORD_COLUMN_CHECKLIST_READING_ORDER = [
  ...DRILLDOWN_RECORD_COLUMN_DEFINITIONS.filter((column) => column.id === 'recordNumber'),
  ...ALPHABETICAL_DRILLDOWN_RECORD_COLUMN_DEFINITIONS.filter((column) => column.id !== 'recordNumber'),
]
const DRILLDOWN_RECORD_COLUMN_CHECKLIST = toColumnMajorOrder(DRILLDOWN_RECORD_COLUMN_CHECKLIST_READING_ORDER, 2)

const SORTABLE_DRILLDOWN_RECORD_COLUMN_READING_ORDER = [
  ...SORTABLE_DRILLDOWN_RECORD_COLUMN_DEFINITIONS.filter((column) => column.id === 'recordNumber'),
  ...SORTABLE_DRILLDOWN_RECORD_COLUMN_DEFINITIONS.filter((column) => column.id !== 'recordNumber'),
]
const SORTABLE_DRILLDOWN_RECORD_COLUMN_CHECKLIST = toColumnMajorOrder(SORTABLE_DRILLDOWN_RECORD_COLUMN_READING_ORDER, 2)

const DEFAULT_DRILLDOWN_RECORD_COLUMN_VISIBILITY: Record<DrilldownRecordColumnId, boolean> = {
  recordNumber: false,
  thumb: true,
  flowerName: true,
  cultivar: false,
  color: true,
  size: false,
  height: false,
  location: true,
  seasonYearStart: true,
  source: false,
  plantedDate: false,
}

const DRILLDOWN_THUMB_SIZE = 42

const DEFAULT_DRILLDOWN_RECORD_SORT: DrilldownSort = { table: 'records', key: 'location', direction: 'asc' }

export function AnalyticsModal({
  records = [],
  companies = [],
  onClose,
  onOpenRecord,
  onOpenOrder,
}: {
  records?: DahliaRecord[]
  companies?: Company[]
  onClose: () => void
  onOpenRecord?: (record: DahliaRecord) => void
  onOpenOrder?: (orderId: string) => void
}) {
  const [metric, setMetric] = useState<AnalyticsMetric>('flower_count_by_season')
  const [selectedSeasonYears, setSelectedSeasonYears] = useState<number[]>([])
  const defaultSeasonAppliedRef = useRef(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [filters, setFilters] = useState<AnalyticsFilters>({ companies: [], gardenAreas: [], plantingStates: [], colors: [], forms: [] })
  const [sortBy, setSortBy] = useState<AnalyticsSort>('company')
  const [chartType, setChartType] = useState<AnalyticsChartType>('table')
  const [photoTypes, setPhotoTypes] = useState<Array<'any' | 'record' | 'cultivar' | 'none'>>(['any', 'none'])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [visualization, setVisualization] = useState<AgentVisualization | null>(null)
  const [drilldown, setDrilldown] = useState<AnalyticsDrilldown | null>(null)
  const [drilldownSort, setDrilldownSort] = useState<DrilldownSort | null>(null)
  const [drilldownColumnVisibility, setDrilldownColumnVisibility] = useState<Record<DrilldownRecordColumnId, boolean>>(DEFAULT_DRILLDOWN_RECORD_COLUMN_VISIBILITY)
  const [drilldownTableOptionsOpen, setDrilldownTableOptionsOpen] = useState(false)
  const [drilldownBusy, setDrilldownBusy] = useState(false)
  const [clarify, setClarify] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chartExportRef = useRef<HTMLDivElement>(null)

  const seasonYears = useMemo(
    () =>
      Array.from(new Set(records.map((record) => record.seasonYearStart).filter((year): year is number => year != null))).sort(
        (a, b) => b - a,
      ),
    [records],
  )

  useEffect(() => {
    if (!defaultSeasonAppliedRef.current && selectedSeasonYears.length === 0 && seasonYears.length > 0) {
      defaultSeasonAppliedRef.current = true
      setSelectedSeasonYears([seasonYears[0]])
    }
  }, [seasonYears, selectedSeasonYears.length])

  const seasonFilterLabel = useMemo(() => {
    if (selectedSeasonYears.length === 0) return 'All seasons'
    if (selectedSeasonYears.length === 1) return String(selectedSeasonYears[0])
    return `${selectedSeasonYears.length} seasons`
  }, [selectedSeasonYears])

  function sortedUnique(values: Array<string | undefined | null>, fallback = 'Unspecified') {
    return Array.from(new Set(values.map((value) => String(value ?? '').trim() || fallback))).sort((a, b) => a.localeCompare(b))
  }

  function plantingStateLabel(value: unknown) {
    return String(value ?? '')
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  const PLANTING_STATE_OPTION_ORDER = ['Garden Tray', 'In Garden', 'Did Not Grow', 'Not Planted', 'Not Viable', 'Purchased Container']

  function sortedPlantingStates(values: Array<string | undefined | null>, fallback = 'Unspecified') {
    return sortedUnique(values, fallback).sort((a, b) => {
      const orderA = PLANTING_STATE_OPTION_ORDER.indexOf(a)
      const orderB = PLANTING_STATE_OPTION_ORDER.indexOf(b)
      if (orderA !== -1 && orderB !== -1) return orderA - orderB
      if (orderA !== -1) return -1
      if (orderB !== -1) return 1
      return a.localeCompare(b)
    })
  }

  const analyticsOptions = useMemo(() => ({
    companies: companies.map((company) => company.name).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    gardenAreas: sortedUnique(records.map((record) => record.meta?.gardenArea), 'Unassigned'),
    plantingStates: sortedPlantingStates(records.map((record) => plantingStateLabel(record.meta?.plantingState)), 'Unspecified'),
    colors: sortedUnique(records.map((record) => record.core?.color), 'Unspecified'),
    forms: sortedUnique(records.map((record) => record.core?.form), 'Unspecified'),
  }), [companies, records])

  const photoTypesModified = !(photoTypes.length === 2 && photoTypes.includes('any') && photoTypes.includes('none'))
  const activeOptionCount = Object.values(filters).reduce((sum, values) => sum + values.length, 0) + (photoTypesModified ? 1 : 0)

  function filterSummary(key: keyof AnalyticsFilters, allLabel: string) {
    const values = filters[key]
    if (values.length === 0) return allLabel
    if (values.length === 1) return values[0]
    return `${values.length} selected`
  }

  function toggleFilterValue(key: keyof AnalyticsFilters, value: string, checked: boolean) {
    setFilters((previous) => ({
      ...previous,
      [key]: checked
        ? Array.from(new Set([...previous[key], value])).sort((a, b) => a.localeCompare(b))
        : previous[key].filter((item) => item !== value),
    }))
  }

  function analyticsFilterPayload() {
    return Object.fromEntries(Object.entries(filters).filter(([, values]) => values.length > 0))
  }

  function sortValue(value: unknown) {
    if (value == null) return ''
    if (typeof value === 'number') return value
    const text = String(value).trim()
    const numeric = text === '' ? NaN : Number(text)
    return Number.isFinite(numeric) ? numeric : text.toLowerCase()
  }

  function compareValues(a: unknown, b: unknown) {
    const left = sortValue(a)
    const right = sortValue(b)
    if (typeof left === 'number' && typeof right === 'number') return left - right
    return String(left).localeCompare(String(right), undefined, { numeric: true })
  }

  function toggleDrilldownSort(table: 'records' | 'orders', key: string) {
    setDrilldownSort((current) => ({
      table,
      key,
      direction: current?.table === table && current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  function sortIndicator(table: 'records' | 'orders', key: string) {
    if (drilldownSort?.table !== table || drilldownSort.key !== key) return ''
    return drilldownSort.direction === 'asc' ? ' ▲' : ' ▼'
  }

  function SortHeader({ table, columnKey, children }: { table: 'records' | 'orders'; columnKey: string; children: ReactNode }) {
    return (
      <th>
        <button className="tableSortButton" type="button" onClick={() => toggleDrilldownSort(table, columnKey)}>
          {children}{sortIndicator(table, columnKey)}
        </button>
      </th>
    )
  }

  const sortedDrilldownOrders = useMemo(() => {
    const rows = [...(drilldown?.orders ?? [])]
    if (drilldownSort?.table !== 'orders') return rows
    rows.sort((a, b) => compareValues(a[drilldownSort.key as keyof typeof a], b[drilldownSort.key as keyof typeof b]) * (drilldownSort.direction === 'asc' ? 1 : -1))
    return rows
  }, [drilldown?.orders, drilldownSort])

  const sortedDrilldownRecords = useMemo(() => {
    const rows = [...(drilldown?.records ?? [])]
    if (drilldownSort?.table !== 'records') return rows
    function sortFieldValue(row: AnalyticsDrilldownRecord) {
      if (drilldownSort!.key === 'location') return formatGardenLocation(row.record)
      if (drilldownSort!.key === 'plantedDate') return row.record.core?.plantedDate ?? ''
      return row[drilldownSort!.key as keyof AnalyticsDrilldownRecord]
    }
    rows.sort((a, b) => compareValues(sortFieldValue(a), sortFieldValue(b)) * (drilldownSort.direction === 'asc' ? 1 : -1))
    return rows
  }, [drilldown?.records, drilldownSort])

  async function exportAnalyticsChart(targetWindow?: Window | null) {
    try {
      const target = chartExportRef.current
      if (!target) return
      const { default: html2canvas } = await import('html2canvas')
      const clone = target.cloneNode(true) as HTMLDivElement
      clone.classList.add('analyticsPdfExportTheme')
      clone.style.position = 'fixed'
      clone.style.left = '-10000px'
      clone.style.top = '0'
      clone.style.width = `${target.offsetWidth}px`
      clone.style.pointerEvents = 'none'
      document.body.appendChild(clone)
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      let canvas: HTMLCanvasElement
      try {
        canvas = await html2canvas(clone, {
          backgroundColor: '#ffffff',
          scale: Math.min(window.devicePixelRatio || 1, 2),
        })
      } finally {
        clone.remove()
      }
      const orientation = canvas.width > canvas.height ? 'landscape' : 'portrait'
      const pdf = new jsPDF({ orientation, unit: 'pt', format: 'letter' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 24
      const maxWidth = pageWidth - margin * 2
      const maxHeight = pageHeight - margin * 2
      const ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height)
      const width = canvas.width * ratio
      const height = canvas.height * ratio
      const x = (pageWidth - width) / 2
      const y = (pageHeight - height) / 2
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, width, height)
      openPdfInNewTab(pdf, targetWindow)
    } catch (e: any) {
      targetWindow?.close()
      setError(e?.message ?? String(e))
    }
  }

  function exportDrilldownTable(targetWindow?: Window | null) {
    try {
      if (!drilldown) return
      if (drilldown.type === 'orders') {
        const pdf = addTablePdf({
          title: drilldown.title,
          columns: [
            { key: 'invoiceNumber', label: 'Invoice #' },
            { key: 'company', label: 'Company' },
            { key: 'orderDate', label: 'Order Date' },
            { key: 'totalCost', label: 'Total Cost' },
            { key: 'itemCount', label: 'Items' },
            { key: 'notes', label: 'Notes' },
          ],
          rows: sortedDrilldownOrders,
        })
        openPdfInNewTab(pdf, targetWindow)
        return
      }

      const pdfColumns = DRILLDOWN_RECORD_COLUMN_DEFINITIONS
        .filter((column) => column.id !== 'thumb' && drilldownColumnVisibility[column.id])
        .map((column) => ({ key: column.id, label: column.label }))

      const pdf = addTablePdf({
        title: drilldown.title,
        columns: pdfColumns.length ? pdfColumns : [{ key: 'flowerName', label: 'Flower' }],
        rows: sortedDrilldownRecords.map((row) => ({
          ...row,
          location: formatGardenLocation(row.record),
          plantedDate: row.record.core?.plantedDate ?? '',
        })),
      })
      openPdfInNewTab(pdf, targetWindow)
    } catch (e: any) {
      targetWindow?.close()
      setError(e?.message ?? String(e))
    }
  }

  function beginPdfExport(runExport: (targetWindow?: Window | null) => void | Promise<void>) {
    const targetWindow = window.open('', '_blank')
    if (!targetWindow) {
      setError('Pop-up blocked. Allow pop-ups for this site to view the PDF export.')
      return
    }
    targetWindow.document.write('<!doctype html><title>Preparing PDF...</title><body style="font-family: sans-serif; padding: 24px;">Preparing PDF export...</body>')
    void runExport(targetWindow)
  }

  function defaultChartTypeForMetric(nextMetric: AnalyticsMetric): AnalyticsChartType {
    if (nextMetric === 'height_vs_bloom_size') return 'scatter'
    if (nextMetric === 'linked_vs_unlinked_purchase_records') return 'pie'
    if (nextMetric === 'flower_count_by_photo_type') return 'table'
    if (nextMetric === 'flower_count_by_season') return 'table'
    if (['missing_data_summary', 'garden_area_by_planting_state', 'flower_count_by_company_and_season', 'garden_fill_by_area'].includes(nextMetric)) return 'table'
    if (nextMetric === 'invoice_total_by_season' || nextMetric === 'average_item_cost_by_season') return 'line'
    return 'bar'
  }

  function selectMetric(nextMetric: AnalyticsMetric) {
    setMetric(nextMetric)
    setChartType(defaultChartTypeForMetric(nextMetric))
  }

  function canDrilldown(nextMetric: AnalyticsMetric) {
    return [
      'missing_data_summary',
      'flower_count_by_color',
      'flower_count_by_garden_area',
      'flower_count_by_form',
      'flower_count_by_planting_state',
      'linked_vs_unlinked_purchase_records',
      'flower_purchase_count_by_company',
      'invoice_total_by_company',
      'flower_count_by_season',
      'height_vs_bloom_size',
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
    ].includes(nextMetric)
  }

  function drilldownBucket(row: Record<string, unknown>) {
    if (metric === 'flower_count_by_color') return typeof row.color === 'string' ? row.color : ''
    if (metric === 'flower_count_by_garden_area') return typeof row.gardenArea === 'string' ? row.gardenArea : ''
    if (metric === 'flower_count_by_form') return typeof row.form === 'string' ? row.form : ''
    if (metric === 'flower_count_by_planting_state') return typeof row.plantingState === 'string' ? row.plantingState : ''
    if (metric === 'linked_vs_unlinked_purchase_records') return typeof row.linkStatus === 'string' ? row.linkStatus : ''
    if (metric === 'flower_purchase_count_by_company') return typeof row.company === 'string' ? row.company : ''
    if (metric === 'invoice_total_by_company') return typeof row.company === 'string' ? row.company : ''
    if (metric === 'flower_count_by_season') return row.season == null ? '' : String(row.season)
    if (metric === 'height_vs_bloom_size') return typeof row.id === 'string' ? row.id : ''
    if (metric === 'garden_area_by_planting_state') return typeof row.gardenArea === 'string' && typeof row.plantingState === 'string' ? `${row.gardenArea}|${row.plantingState}` : ''
    if (metric === 'invoice_total_by_season') return row.season == null ? '' : String(row.season)
    if (metric === 'flower_count_by_company_and_season') return typeof row.company === 'string' && row.season != null ? `${row.company}|${row.season}` : ''
    if (metric === 'average_item_cost_by_form') return typeof row.form === 'string' ? row.form : ''
    if (metric === 'garden_fill_by_area') return typeof row.gardenArea === 'string' ? row.gardenArea : ''
    if (metric === 'not_viable_reason_summary' || metric === 'not_planted_reason_summary') return typeof row.reason === 'string' ? row.reason : ''
    if (metric === 'average_item_cost_by_season') return row.season == null ? '' : String(row.season)
    if (metric === 'order_count_by_company') return typeof row.company === 'string' ? row.company : ''
    if (metric === 'flower_count_by_bloom_size') return typeof row.bloomSize === 'string' ? row.bloomSize : ''
    if (metric === 'flower_count_by_height') return typeof row.height === 'string' ? row.height : ''
    if (metric === 'flower_count_by_source') return typeof row.source === 'string' ? row.source : ''
    if (metric === 'flower_count_by_photo_type') return typeof row['Photo Type'] === 'string' ? row['Photo Type'] : ''
    return ''
  }

  async function submit() {
    if (busy) return

    setBusy(true)
    setError(null)
    setResult(null)
    setVisualization(null)
    setDrilldown(null)
    setDrilldownSort(null)
    setClarify(null)
    try {
      const out = await api<AgentResult>('/api/agent/metrics', {
        method: 'POST',
        body: JSON.stringify({
          metric,
          seasonYearStarts: selectedSeasonYears.length ? selectedSeasonYears : undefined,
          filters: analyticsFilterPayload(),
          photoTypes,
          sortBy,
          visualization: {
            type: chartType,
            renderer: chartType === 'table' ? 'table' : 'd3',
            xLabelAngle: -90,
          },
        }),
      })
      if (out.status === 'needs_clarification') {
        setClarify(out.message)
      } else {
        setResult(out.message)
        setVisualization(out.visualization ?? out.chart ?? null)
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function openDrilldown(row: Record<string, unknown>) {
    if (!canDrilldown(metric)) return
    const field = typeof row.field === 'string' ? row.field : ''
    const bucket = drilldownBucket(row)
    if (metric === 'missing_data_summary' && !field) return
    if (metric !== 'missing_data_summary' && !bucket) return

    setDrilldownBusy(true)
    setError(null)
    try {
      const out = await api<AnalyticsDrilldown>('/api/agent/metrics/drilldown', {
        method: 'POST',
        body: JSON.stringify({
          metric,
          field: metric === 'missing_data_summary' ? field : undefined,
          bucket: metric === 'missing_data_summary' ? undefined : bucket,
          seasonYearStarts: selectedSeasonYears.length ? selectedSeasonYears : undefined,
          filters: analyticsFilterPayload(),
          photoTypes,
        }),
      })
      setDrilldown(out)
      setDrilldownSort(out.type === 'orders' ? null : DEFAULT_DRILLDOWN_RECORD_SORT)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setDrilldownBusy(false)
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="analytics-title" onMouseDown={onClose}>
      <div className="modal metricsQueryModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <div className="modalTitle" id="analytics-title">Analytics</div>
            <div className="modalSub">Generate supported charts and graphs from saved records.</div>
          </div>
          <button className="btn ghost compact" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modalBody">
          <div className="agent analyticsPanel">
            <div className="muted">Choose a supported chart, set parameters, then generate the visualization from saved records.</div>
            <div className="analyticsControls">
              <DahliaPickerField
                label="Query"
                required
                clearable={false}
                layout="grid"
                columns={2}
                wrapOptionText
                value={metric}
                options={[
                  { value: 'flower_count_by_season', label: 'Flowers by Season' },
                  { value: 'flower_count_by_bloom_size', label: 'Flowers by Bloom Size' },
                  { value: 'flower_count_by_color', label: 'Flowers by Color' },
                  { value: 'flower_count_by_form', label: 'Flowers by Form' },
                  { value: 'flower_count_by_garden_area', label: 'Flowers by Garden Area' },
                  { value: 'flower_count_by_height', label: 'Flowers by Height' },
                  { value: 'flower_count_by_planting_state', label: 'Flowers by Planting State' },
                  { value: 'flower_count_by_photo_type', label: 'Flowers by Photo Type' },
                  { value: 'flower_count_by_source', label: 'Flowers by Source' },
                  { value: 'flower_purchase_count_by_company', label: 'Flowers Purchased by Company' },
                  { value: 'not_planted_reason_summary', label: 'Not Planted Reason Summary' },
                  { value: 'not_viable_reason_summary', label: 'Not Viable Reason Summary' },
                  { value: 'average_item_cost_by_company', label: 'Average Item Cost by Company' },
                  { value: 'average_item_cost_by_form', label: 'Average Item Cost by Form' },
                  { value: 'average_item_cost_by_season', label: 'Average Item Cost by Season' },
                  { value: 'flower_count_by_company_and_season', label: 'Flower Count by Company and Season' },
                  { value: 'garden_area_by_planting_state', label: 'Garden Area by Planting State' },
                  { value: 'garden_fill_by_area', label: 'Garden Fill by Area' },
                  { value: 'height_vs_bloom_size', label: 'Height vs Bloom Size' },
                  { value: 'invoice_total_by_company', label: 'Invoice Total by Company' },
                  { value: 'invoice_total_by_season', label: 'Invoice Total by Season' },
                  { value: 'linked_vs_unlinked_purchase_records', label: 'Linked vs Unlinked Purchase Records' },
                  { value: 'missing_data_summary', label: 'Missing Data Summary' },
                  { value: 'order_count_by_company', label: 'Order Count by Company' },
                ]}
                onChange={(value) => selectMetric(value as AnalyticsMetric)}
              />
              <DahliaPickerField
                label="Season year"
                multiple
                layout="grid"
                columns={3}
                allLabel="All seasons"
                summary={seasonFilterLabel}
                values={selectedSeasonYears.map(String)}
                options={seasonYears.map(String)}
                onChange={(values) => setSelectedSeasonYears(values.map(Number).sort((a, b) => b - a))}
              />
              <DahliaPickerField
                label="Sort by"
                required
                clearable={false}
                layout="list"
                centerOptionText
                modalWidth="min(320px, 100%)"
                value={sortBy}
                options={[{ value: 'company', label: 'Name' }, { value: 'value_desc', label: 'Highest count first' }, { value: 'value_asc', label: 'Lowest count first' }]}
                onChange={(value) => setSortBy(value as AnalyticsSort)}
              />
              <DahliaPickerField
                label="Display"
                required
                clearable={false}
                layout="grid"
                columns={2}
                value={chartType}
                options={[{ value: 'bar', label: 'Bar chart' }, { value: 'line', label: 'Line chart' }, { value: 'pie', label: 'Pie chart' }, { value: 'scatter', label: 'Scatter plot' }, { value: 'table', label: 'Table' }]}
                onChange={(value) => setChartType(value as AnalyticsChartType)}
              />
            </div>
            <div className="agentInputFooter analyticsActions">
              <button className="btn" disabled={busy} onClick={() => void submit()}>
                {busy ? 'Generating...' : 'Generate Chart'}
              </button>
              <button className="btn ghost" type="button" onClick={() => setOptionsOpen(true)}>
                Options{activeOptionCount ? ` (${activeOptionCount})` : ''}
              </button>
            </div>
            {activeOptionCount ? (
              <div className="muted analyticsFilterSummary">
                {filterSummary('companies', 'All Companies')} · {filterSummary('gardenAreas', 'All Garden Areas')} · {filterSummary('plantingStates', 'All Planting States')} · {filterSummary('colors', 'All Colors')} · {filterSummary('forms', 'All Forms')}
              </div>
            ) : null}
            {optionsOpen ? (
              <div className="modalOverlay analyticsOptionsOverlay" role="dialog" aria-modal="true" aria-labelledby="analytics-options-title" onMouseDown={() => setOptionsOpen(false)}>
                <div className="modal analyticsOptionsModal" onMouseDown={(event) => event.stopPropagation()}>
                  <div className="modalHeader">
                    <div>
                      <div className="modalTitle" id="analytics-options-title">Analytics Options</div>
                      <div className="modalSub">Optional filters. Unchanged filters use all values.</div>
                    </div>
                    <button className="btn ghost compact" type="button" onClick={() => setOptionsOpen(false)}>Close</button>
                  </div>
                  <div className="modalBody analyticsOptionsBody">
                    {([
                      ['companies', 'Companies', 'All Companies', analyticsOptions.companies],
                      ['gardenAreas', 'Garden Areas', 'All Garden Areas', analyticsOptions.gardenAreas],
                      ['plantingStates', 'Planting States', 'All Planting States', analyticsOptions.plantingStates],
                      ['colors', 'Colors', 'All Colors', analyticsOptions.colors],
                      ['forms', 'Forms', 'All Forms', analyticsOptions.forms],
                    ] as Array<[keyof AnalyticsFilters, string, string, string[]]>).map(([key, title, allLabel, options]) => (
                      <fieldset className="analyticsOptionGroup" key={key}>
                        <legend>{title}</legend>
                        <label className="seasonFilterOption">
                          <input type="checkbox" checked={filters[key].length === 0} onChange={() => setFilters((previous) => ({ ...previous, [key]: [] }))} />
                          {allLabel}
                        </label>
                        <div className="analyticsOptionList">
                          {options.map((option) => (
                            <label key={option} className="seasonFilterOption">
                              <input
                                type="checkbox"
                                checked={filters[key].includes(option)}
                                onChange={(event) => toggleFilterValue(key, option, event.target.checked)}
                              />
                              {option}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ))}
                    <fieldset className="analyticsOptionGroup">
                      <legend>Photos</legend>
                      <label className="seasonFilterOption">
                        <input type="checkbox" checked={photoTypes.length === 4} onChange={() => setPhotoTypes(['any', 'record', 'cultivar', 'none'])} />
                        All types
                      </label>
                      <div className="analyticsOptionList">
                        {([
                          ['any', 'Records with any photos'],
                          ['record', 'Record-level photos'],
                          ['cultivar', 'Cultivar-level photos'],
                          ['none', 'Records with no photos'],
                        ] as Array<['any' | 'record' | 'cultivar' | 'none', string]>).map(([key, label]) => (
                          <label key={key} className="seasonFilterOption">
                            <input
                              type="checkbox"
                              checked={photoTypes.includes(key)}
                              onChange={(event) => setPhotoTypes((prev) =>
                                event.target.checked
                                  ? Array.from(new Set([...prev, key]))
                                  : prev.filter((t) => t !== key),
                              )}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="agentInputFooter analyticsActions">
                      <button className="btn ghost compact" type="button" onClick={() => { setFilters({ companies: [], gardenAreas: [], plantingStates: [], colors: [], forms: [] }); setPhotoTypes(['any', 'none']) }}>Clear Options</button>
                      <button className="btn compact" type="button" onClick={() => setOptionsOpen(false)}>Apply Options</button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            {clarify ? <div className="callout warn">{clarify}</div> : null}
            {result ? <div className="callout ok">{result}</div> : null}
            {visualization ? (
              <div className="analyticsExportBlock">
                <div className="analyticsExportActions">
                  <button className="btn ghost compact" type="button" onClick={() => beginPdfExport(exportAnalyticsChart)}>Export Chart PDF</button>
                </div>
                <div ref={chartExportRef}>
                  <Suspense fallback={<div className="callout ok">Loading visualization...</div>}>
                    <AgentVisualizationView visualization={visualization} onRowClick={canDrilldown(metric) ? openDrilldown : undefined} />
                  </Suspense>
                </div>
              </div>
            ) : null}
            {drilldownBusy ? <div className="callout ok">Loading drilldown records...</div> : null}
            {drilldown ? (
              <div className="agentChart analyticsDrilldown">
                <div className="analyticsDrilldownHeader">
                  <div className="agentChartTitle">{drilldown.title}</div>
                  <div className="analyticsDrilldownHeaderActions">
                    {drilldown.type !== 'orders' ? (
                      <button className="btn ghost compact tableOptionsButton" type="button" onClick={() => setDrilldownTableOptionsOpen(true)}>
                        Table Options
                      </button>
                    ) : null}
                    <button className="btn ghost compact" type="button" onClick={() => beginPdfExport(exportDrilldownTable)}>Export Table PDF</button>
                  </div>
                </div>

                {drilldownTableOptionsOpen ? (
                  <div
                    className="modalOverlay"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="drilldown-table-options-title"
                    onMouseDown={() => setDrilldownTableOptionsOpen(false)}
                  >
                    <div className="modal tableOptionsModal" onMouseDown={(event) => event.stopPropagation()}>
                      <div className="modalHeader">
                        <div>
                          <div className="modalTitle" id="drilldown-table-options-title">Table Options</div>
                          <div className="modalSub">Choose visible columns and sort order.</div>
                        </div>
                        <button className="btn ghost" type="button" onClick={() => setDrilldownTableOptionsOpen(false)}>Close</button>
                      </div>
                      <div className="modalBody tableOptionsBody">
                        <div className="tableOptionsControls">
                          <DahliaPickerField
                            label="Sort by"
                            required
                            clearable={false}
                            layout="grid"
                            columns={2}
                            value={drilldownSort?.table === 'records' ? drilldownSort.key : DEFAULT_DRILLDOWN_RECORD_SORT.key}
                            options={SORTABLE_DRILLDOWN_RECORD_COLUMN_CHECKLIST.map((column) => ({ value: column.id, label: column.label }))}
                            onChange={(value) =>
                              setDrilldownSort((current) => ({
                                table: 'records',
                                key: value as string,
                                direction: current?.table === 'records' ? current.direction : 'asc',
                              }))
                            }
                          />
                          <DahliaPickerField
                            label="Direction"
                            required
                            clearable={false}
                            layout="list"
                            centerOptionText
                            modalWidth="min(320px, 100%)"
                            value={drilldownSort?.table === 'records' && drilldownSort.direction === 'desc' ? 'desc' : 'asc'}
                            options={[
                              { value: 'asc', label: 'Ascending' },
                              { value: 'desc', label: 'Descending' },
                            ]}
                            onChange={(value) =>
                              setDrilldownSort((current) => ({
                                table: 'records',
                                key: current?.table === 'records' ? current.key : DEFAULT_DRILLDOWN_RECORD_SORT.key,
                                direction: value === 'desc' ? 'desc' : 'asc',
                              }))
                            }
                          />
                        </div>

                        <fieldset className="tableOptionsColumnsGroup">
                          <legend>Columns</legend>
                          <button
                            className="btn ghost compact tableOptionsColumnsReset"
                            type="button"
                            onClick={() => setDrilldownColumnVisibility(DEFAULT_DRILLDOWN_RECORD_COLUMN_VISIBILITY)}
                          >
                            Reset
                          </button>
                          <div className="tableOptionsColumnList">
                            {DRILLDOWN_RECORD_COLUMN_CHECKLIST.map((column) => (
                              <label key={column.id} className="seasonFilterOption">
                                <input
                                  type="checkbox"
                                  checked={drilldownColumnVisibility[column.id]}
                                  onChange={(event) =>
                                    setDrilldownColumnVisibility((previous) => ({ ...previous, [column.id]: event.target.checked }))
                                  }
                                />
                                {column.label}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      </div>
                    </div>
                  </div>
                ) : null}
                {drilldown.type === 'orders' ? (
                  <div className="agentChartTableWrap">
                    <table className="table agentChartTable">
                      <thead>
                        <tr>
                          <SortHeader table="orders" columnKey="invoiceNumber">Invoice #</SortHeader>
                          <SortHeader table="orders" columnKey="company">Company</SortHeader>
                          <SortHeader table="orders" columnKey="orderDate">Order date</SortHeader>
                          <SortHeader table="orders" columnKey="totalCost">Total cost</SortHeader>
                          <SortHeader table="orders" columnKey="itemCount">Items</SortHeader>
                          <SortHeader table="orders" columnKey="notes">Notes</SortHeader>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDrilldownOrders.map((row) => (
                          <tr key={row.id}>
                            <td>{row.invoiceNumber ?? ''}</td>
                            <td>{row.company}</td>
                            <td>{row.orderDate ?? ''}</td>
                            <td>{row.totalCost == null ? '' : `$${row.totalCost.toFixed(2)}`}</td>
                            <td>{row.itemCount ?? ''}</td>
                            <td>{row.notes ?? ''}</td>
                            <td>
                              <button className="btn ghost compact" type="button" onClick={() => onOpenOrder?.(row.id)}>
                                Open
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(drilldown.orders ?? []).length === 0 ? <div className="muted">No matching invoices found.</div> : null}
                  </div>
                ) : (
                  <div className="agentChartTableWrap">
                    <table className="table agentChartTable">
                      <thead>
                        <tr>
                          {drilldownColumnVisibility.recordNumber ? <SortHeader table="records" columnKey="recordNumber">#</SortHeader> : null}
                          {drilldownColumnVisibility.thumb ? <th>Photo</th> : null}
                          {drilldownColumnVisibility.flowerName ? <SortHeader table="records" columnKey="flowerName">Flower</SortHeader> : null}
                          {drilldownColumnVisibility.cultivar ? <SortHeader table="records" columnKey="cultivar">Cultivar</SortHeader> : null}
                          {drilldownColumnVisibility.color ? <SortHeader table="records" columnKey="color">Color</SortHeader> : null}
                          {drilldownColumnVisibility.size ? <SortHeader table="records" columnKey="size">W (in.)</SortHeader> : null}
                          {drilldownColumnVisibility.height ? <SortHeader table="records" columnKey="height">H (ft.)</SortHeader> : null}
                          {drilldownColumnVisibility.location ? <SortHeader table="records" columnKey="location">Location</SortHeader> : null}
                          {drilldownColumnVisibility.seasonYearStart ? <SortHeader table="records" columnKey="seasonYearStart">Season</SortHeader> : null}
                          {drilldownColumnVisibility.source ? <SortHeader table="records" columnKey="source">Company</SortHeader> : null}
                          {drilldownColumnVisibility.plantedDate ? <SortHeader table="records" columnKey="plantedDate">Planting Date</SortHeader> : null}
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDrilldownRecords.map((row) => {
                          const photoUrl = drilldownColumnVisibility.thumb ? resolveRecordPhoto(row.record) : undefined
                          return (
                            <tr key={row.id}>
                              {drilldownColumnVisibility.recordNumber ? <td>{row.recordNumber ?? ''}</td> : null}
                              {drilldownColumnVisibility.thumb ? (
                                <td>
                                  {photoUrl ? (
                                    <img className="thumb" src={photoUrl} alt="" loading="lazy" decoding="async" width={DRILLDOWN_THUMB_SIZE} height={DRILLDOWN_THUMB_SIZE} />
                                  ) : (
                                    <div className="thumb ph" />
                                  )}
                                </td>
                              ) : null}
                              {drilldownColumnVisibility.flowerName ? <td>{row.flowerName}</td> : null}
                              {drilldownColumnVisibility.cultivar ? <td>{row.cultivar ?? ''}</td> : null}
                              {drilldownColumnVisibility.color ? <td>{row.color ?? ''}</td> : null}
                              {drilldownColumnVisibility.size ? <td>{row.size ?? ''}</td> : null}
                              {drilldownColumnVisibility.height ? <td>{row.height ?? ''}</td> : null}
                              {drilldownColumnVisibility.location ? <td>{formatGardenLocation(row.record)}</td> : null}
                              {drilldownColumnVisibility.seasonYearStart ? <td>{row.seasonYearStart ?? ''}</td> : null}
                              {drilldownColumnVisibility.source ? <td>{row.source ?? ''}</td> : null}
                              {drilldownColumnVisibility.plantedDate ? <td>{row.record.core?.plantedDate ?? ''}</td> : null}
                              <td>
                                <button className="btn ghost compact" type="button" onClick={() => onOpenRecord?.(row.record)}>
                                  Open
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {(drilldown.records ?? []).length === 0 ? <div className="muted">No matching records found.</div> : null}
                  </div>
                )}
              </div>
            ) : null}
            {error ? <div className="callout err">{error}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
