import { useDeferredValue, useEffect, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ColumnDef } from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type PaginationState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { useState } from 'react'
import { DahliaPickerField } from './DahliaPickerField'
import type { DahliaRecordSummary, Order } from '../types'

function compareGardenRows(a: string, b: string) {
  if (a.length !== b.length) return a.length - b.length
  return a.localeCompare(b)
}

const NON_GARDEN_PLANTING_STATES = new Set(['purchased_container', 'garden_tray', 'not_planted', 'not_viable', 'did_not_grow'])

function isNonGardenState(record: DahliaRecordSummary) {
  return NON_GARDEN_PLANTING_STATES.has(record.meta?.plantingState ?? 'purchased_container')
}

function compareGardenLocations(a: DahliaRecordSummary, b: DahliaRecordSummary) {
  const aNonGarden = isNonGardenState(a)
  const bNonGarden = isNonGardenState(b)
  if (aNonGarden !== bNonGarden) return aNonGarden ? 1 : -1
  if (aNonGarden && bNonGarden) return formatGardenLocation(a).localeCompare(formatGardenLocation(b), undefined, { numeric: true })

  const areaCompare = String(a.meta?.gardenZone ?? a.meta?.gardenArea ?? '').localeCompare(String(b.meta?.gardenZone ?? b.meta?.gardenArea ?? ''))
  if (areaCompare !== 0) return areaCompare

  const rowCompare = compareGardenRows(a.meta?.rowOrBed ?? a.meta?.gardenRow ?? '', b.meta?.rowOrBed ?? b.meta?.gardenRow ?? '')
  if (rowCompare !== 0) return rowCompare

  const aPosition = Number(a.meta?.position ?? a.meta?.gardenPosition)
  const bPosition = Number(b.meta?.position ?? b.meta?.gardenPosition)
  if (Number.isFinite(aPosition) && Number.isFinite(bPosition) && aPosition !== bPosition) return aPosition - bPosition

  return formatGardenLocation(a).localeCompare(formatGardenLocation(b), undefined, { numeric: true })
}

export function resolveRecordPhoto(record: DahliaRecordSummary) {
  if (record.defaultPhotoScope === 'cultivar') {
    return record.cultivarListThumbnailUrl || record.cultivarThumbnailUrl || record.cultivarImageUrl || record.listThumbnailUrl || record.thumbnailUrl || record.imageUrl
  }
  return record.listThumbnailUrl || record.thumbnailUrl || record.imageUrl || record.cultivarListThumbnailUrl || record.cultivarThumbnailUrl || record.cultivarImageUrl
}

export function formatGardenLocation(record: DahliaRecordSummary) {
  const plantingState = record.meta?.plantingState ?? 'purchased_container'
  if (plantingState === 'purchased_container') return 'Purchased Container'
  if (plantingState === 'garden_tray') return 'Garden Tray'
  if (plantingState === 'not_planted') return 'Not Planted'
  if (plantingState === 'not_viable') return 'Not Viable'
  if (plantingState === 'did_not_grow') return 'Did Not Grow'

  const gardenArea = record.meta?.gardenZone ?? record.meta?.gardenArea
  const gardenRow = record.meta?.rowOrBed ?? record.meta?.gardenRow
  const gardenPosition = record.meta?.position ?? record.meta?.gardenPosition
  const rowAndPosition = gardenRow && gardenPosition ? `${gardenRow}${gardenPosition}` : record.gardenLocation

  return [gardenArea, rowAndPosition].filter(Boolean).join(' - ')
}

function getInGardenRow(record: DahliaRecordSummary) {
  if (record.meta?.plantingState !== 'in_garden') return ''
  return record.meta?.rowOrBed ?? record.meta?.gardenRow ?? ''
}

const columnClassNames: Record<string, string> = {
  recordNumber: 'colRecordNumber',
  thumb: 'colThumbnail',
  flowerName: 'colFlowerName',
  cultivar: 'colCultivar',
  color: 'colColor',
  size: 'colSize',
  height: 'colHeight',
  gardenLocation: 'colGardenLocation',
  seasonYearStart: 'colSeasonYear',
  source: 'colSource',
  plantedDate: 'colPlantedDate',
}

type ColumnDefinition = {
  id: string
  label: string
  sortable?: boolean
}

const COLUMN_DEFINITIONS: ColumnDefinition[] = [
  { id: 'recordNumber', label: 'Record #' },
  { id: 'thumb', label: 'Photo', sortable: false },
  { id: 'flowerName', label: 'Flower Name' },
  { id: 'cultivar', label: 'Cultivar' },
  { id: 'color', label: 'Color' },
  { id: 'size', label: 'Bloom Width' },
  { id: 'height', label: 'Height' },
  { id: 'gardenLocation', label: 'Location' },
  { id: 'seasonYearStart', label: 'Season' },
  { id: 'source', label: 'Company' },
  { id: 'plantedDate', label: 'Planting Date' },
]

const ALPHABETICAL_COLUMN_DEFINITIONS = [...COLUMN_DEFINITIONS].sort((a, b) => a.label.localeCompare(b.label))
const SORTABLE_COLUMN_DEFINITIONS = ALPHABETICAL_COLUMN_DEFINITIONS.filter((column) => column.sortable !== false)

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

const COLUMN_CHECKLIST_READING_ORDER = [
  ...COLUMN_DEFINITIONS.filter((column) => column.id === 'recordNumber'),
  ...ALPHABETICAL_COLUMN_DEFINITIONS.filter((column) => column.id !== 'recordNumber'),
]
const COLUMN_CHECKLIST = toColumnMajorOrder(COLUMN_CHECKLIST_READING_ORDER, 2)

const SORTABLE_COLUMN_READING_ORDER = [
  ...SORTABLE_COLUMN_DEFINITIONS.filter((column) => column.id === 'recordNumber'),
  ...SORTABLE_COLUMN_DEFINITIONS.filter((column) => column.id !== 'recordNumber'),
]
const SORTABLE_COLUMN_CHECKLIST = toColumnMajorOrder(SORTABLE_COLUMN_READING_ORDER, 2)

const DEFAULT_COLUMN_VISIBILITY: VisibilityState = {
  recordNumber: false,
  thumb: true,
  flowerName: true,
  cultivar: false,
  color: true,
  size: true,
  height: true,
  gardenLocation: true,
  seasonYearStart: true,
  source: false,
  plantedDate: false,
}

const DEFAULT_SORTING: SortingState = [{ id: 'gardenLocation', desc: false }]

const DEFAULT_COLUMN_WIDTH_PX: Record<string, number> = {
  recordNumber: 60,
  thumb: 70,
  flowerName: 220,
  cultivar: 180,
  color: 160,
  size: 90,
  height: 90,
  gardenLocation: 200,
  seasonYearStart: 110,
  source: 150,
  plantedDate: 140,
}

const MIN_COLUMN_WIDTH_PX = 60

const pageSizeOptions = [10, 25, 50, 100]
const RECORD_THUMB_SIZE = 42

type SearchableRecordRow = {
  record: DahliaRecordSummary
  searchableText: string
}

function normalizeSearchValues(values: unknown[]) {
  return values.map((value) => String(value ?? '').toLowerCase()).join(' ')
}

export function RecordsTable({
  rows,
  orders = [],
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  onOpen,
}: {
  rows: DahliaRecordSummary[]
  orders?: Order[]
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore: () => void
  onOpen: (r: DahliaRecordSummary) => void
}) {
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING)
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 })
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(DEFAULT_COLUMN_VISIBILITY)
  const [columnSizes, setColumnSizes] = useState<Record<string, number>>({})
  const [tableOptionsOpen, setTableOptionsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [selectedSeasonYears, setSelectedSeasonYears] = useState<number[]>([])
  const [selectedGardenRows, setSelectedGardenRows] = useState<string[]>([])
  const [seasonFilterOpen, setSeasonFilterOpen] = useState(false)
  const [gardenRowFilterOpen, setGardenRowFilterOpen] = useState(false)
  const defaultSeasonAppliedRef = useRef(false)
  const seasonFilterRef = useRef<HTMLDetailsElement>(null)
  const gardenRowFilterRef = useRef<HTMLDetailsElement>(null)
  const tableWrapRef = useRef<HTMLDivElement>(null)

  const columns = useMemo<ColumnDef<DahliaRecordSummary>[]>(
    () => [
      {
        header: '#',
        id: 'recordNumber',
        accessorKey: 'recordNumber',
      },
      {
        header: 'Photo',
        id: 'thumb',
        cell: ({ row }) => {
          const url = resolveRecordPhoto(row.original)
          return url ? <img className="thumb" src={url} alt="" loading="lazy" decoding="async" width={RECORD_THUMB_SIZE} height={RECORD_THUMB_SIZE} /> : <div className="thumb ph" />
        },
        enableSorting: false,
      },
      {
        header: 'Flower Name',
        accessorKey: 'flowerName',
      },
      {
        header: 'Cultivar',
        id: 'cultivar',
        accessorFn: (record) => record.core.cultivar ?? '',
      },
      {
        header: 'Color',
        id: 'color',
        accessorFn: (record) => record.core.color ?? '',
      },
      {
        header: 'W (in.)',
        id: 'size',
        accessorFn: (record) => record.core.size ?? '',
      },
      {
        header: 'H (ft.)',
        id: 'height',
        accessorFn: (record) => record.growth.height ?? '',
      },
      {
        header: 'Location',
        id: 'gardenLocation',
        accessorFn: formatGardenLocation,
        sortingFn: (a, b) => compareGardenLocations(a.original, b.original),
      },
      {
        header: 'Season',
        accessorKey: 'seasonYearStart',
      },
      {
        header: 'Company',
        id: 'source',
        accessorFn: (record) => record.tuber.source ?? '',
      },
      {
        header: 'Planting Date',
        id: 'plantedDate',
        accessorFn: (record) => record.core.plantedDate ?? '',
      },
    ],
    [],
  )

  const seasonYears = useMemo(
    () =>
      Array.from(new Set(rows.map((record) => record.seasonYearStart).filter((year): year is number => year != null))).sort(
        (a, b) => b - a,
      ),
    [rows],
  )

  useEffect(() => {
    if (!defaultSeasonAppliedRef.current && selectedSeasonYears.length === 0 && seasonYears.length > 0) {
      defaultSeasonAppliedRef.current = true
      setSelectedSeasonYears([seasonYears[0]])
    }
  }, [seasonYears, selectedSeasonYears.length])

  const gardenRows = useMemo(
    () =>
      Array.from(new Set(rows.map(getInGardenRow).filter(Boolean))).sort(
        compareGardenRows,
      ),
    [rows],
  )

  const linkedOrderSearchValuesByItemId = useMemo(() => {
    const lookup = new Map<string, unknown[]>()
    for (const order of orders) {
      for (const item of order.items) {
        lookup.set(item.id, [
          order.invoiceNumber,
          order.company?.name,
          item.flowerName,
          item.cultivarName,
        ])
      }
    }
    return lookup
  }, [orders])

  const searchableRows = useMemo<SearchableRecordRow[]>(() => {
    return rows.map((record) => ({
      record,
      searchableText: normalizeSearchValues([
        record.recordNumber,
        record.flowerName,
        record.core?.cultivar,
        record.core.color,
        record.core.size,
        record.growth.height,
        formatGardenLocation(record),
        record.seasonYearStart,
        record.tuber.source,
        ...(record.tuber.linkedOrderItemIds ?? []).flatMap((id) => linkedOrderSearchValuesByItemId.get(id) ?? []),
      ]),
    }))
  }, [rows, linkedOrderSearchValuesByItemId])

  const filteredRows = useMemo(() => {
    const rawQuery = deferredSearch.trim()
    const isExactPhrase = rawQuery.length > 2 && rawQuery.startsWith('"') && rawQuery.endsWith('"')
    const query = isExactPhrase ? rawQuery.slice(1, -1).toLowerCase() : rawQuery.toLowerCase()
    const exactPhraseRegex = isExactPhrase && query
      ? new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      : null
    const selectedSeasonYearSet = new Set(selectedSeasonYears)
    const selectedGardenRowSet = new Set(selectedGardenRows)

    return searchableRows.filter(({ record, searchableText }) => {
      if (selectedSeasonYearSet.size > 0 && !selectedSeasonYearSet.has(record.seasonYearStart)) return false
      if (selectedGardenRowSet.size > 0 && !selectedGardenRowSet.has(getInGardenRow(record))) return false
      if (query) {
        if (exactPhraseRegex ? !exactPhraseRegex.test(searchableText) : !searchableText.includes(query)) return false
      }
      return true
    }).map(({ record }) => record)
  }, [searchableRows, deferredSearch, selectedSeasonYears, selectedGardenRows])

  const seasonFilterLabel = useMemo(() => {
    if (selectedSeasonYears.length === 0) return 'All seasons'
    if (selectedSeasonYears.length === 1) return String(selectedSeasonYears[0])
    return `${selectedSeasonYears.length} seasons`
  }, [selectedSeasonYears])

  const gardenRowFilterLabel = useMemo(() => {
    if (selectedGardenRows.length === 0) return 'All rows/beds'
    if (selectedGardenRows.length === 1) return `Row/Bed ${selectedGardenRows[0]}`
    return `${selectedGardenRows.length} rows/beds`
  }, [selectedGardenRows])

  function toggleSeasonYear(year: number, checked: boolean) {
    setSelectedSeasonYears((previous) => {
      const next = checked ? Array.from(new Set([...previous, year])) : previous.filter((selectedYear) => selectedYear !== year)
      return next.sort((a, b) => b - a)
    })
  }

  function toggleGardenRow(row: string, checked: boolean) {
    setSelectedGardenRows((previous) => {
      const next = checked ? Array.from(new Set([...previous, row])) : previous.filter((selectedRow) => selectedRow !== row)
      if (next.length > 0) {
        setSorting([
          { id: 'seasonYearStart', desc: true },
          { id: 'gardenLocation', desc: false },
        ])
      }
      return next.sort(compareGardenRows)
    })
  }

  useEffect(() => {
    if (!seasonFilterOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!seasonFilterRef.current?.contains(event.target as Node)) {
        setSeasonFilterOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [seasonFilterOpen])

  useEffect(() => {
    if (!gardenRowFilterOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!gardenRowFilterRef.current?.contains(event.target as Node)) {
        setGardenRowFilterOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [gardenRowFilterOpen])

  useEffect(() => {
    setPagination((previous) => ({ ...previous, pageIndex: 0 }))
  }, [search, selectedSeasonYears, selectedGardenRows])

  const isDefaultColumnSet = COLUMN_DEFINITIONS.every(
    (column) => Boolean(columnVisibility[column.id]) === Boolean(DEFAULT_COLUMN_VISIBILITY[column.id]),
  )

  useEffect(() => {
    if (isDefaultColumnSet) setColumnSizes({})
  }, [isDefaultColumnSet])

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting, pagination, columnVisibility },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  })

  const pageRows = table.getRowModel().rows
  const virtualizer = useVirtualizer({
    count: pageRows.length,
    getScrollElement: () => tableWrapRef.current,
    estimateSize: () => 63,
    overscan: 8,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const virtualPaddingTop = virtualRows[0]?.start ?? 0
  const virtualPaddingBottom = virtualRows.length > 0 ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0
  const pageCount = table.getPageCount()
  const pageStart = filteredRows.length === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1
  const pageEnd = Math.min(filteredRows.length, pageStart + pageRows.length - 1)
  const loadedEndReached = pageEnd >= filteredRows.length
  const visibleColumnCount = table.getVisibleLeafColumns().length
  const hasCustomColumnSizes = Object.keys(columnSizes).length > 0

  function columnWidthStyle(columnId: string): React.CSSProperties | undefined {
    if (!hasCustomColumnSizes) return undefined
    const width = columnSizes[columnId] ?? DEFAULT_COLUMN_WIDTH_PX[columnId]
    return width == null ? undefined : { width, minWidth: width }
  }

  function handleColumnResizeStart(columnId: string) {
    return (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const handle = event.currentTarget
      const th = handle.closest('th')
      const headerRow = th?.closest('tr')
      if (!th || !headerRow) return
      const startWidth = th.getBoundingClientRect().width
      const startX = event.clientX
      handle.setPointerCapture(event.pointerId)

      // Seed every currently-visible column from its live rendered width the
      // moment the table first switches into fixed-width mode, so nothing
      // jumps to a stale default the instant a drag starts.
      setColumnSizes((previous) => {
        if (Object.keys(previous).length > 0) return previous
        const seeded: Record<string, number> = {}
        headerRow.querySelectorAll<HTMLElement>('th[data-column-id]').forEach((cell) => {
          const id = cell.dataset.columnId
          if (id) seeded[id] = Math.round(cell.getBoundingClientRect().width)
        })
        return seeded
      })

      function onPointerMove(moveEvent: PointerEvent) {
        const nextWidth = Math.max(MIN_COLUMN_WIDTH_PX, Math.round(startWidth + (moveEvent.clientX - startX)))
        setColumnSizes((previous) => ({ ...previous, [columnId]: nextWidth }))
      }
      function onPointerUp() {
        handle.releasePointerCapture(event.pointerId)
        handle.removeEventListener('pointermove', onPointerMove)
        handle.removeEventListener('pointerup', onPointerUp)
      }
      handle.addEventListener('pointermove', onPointerMove)
      handle.addEventListener('pointerup', onPointerUp)
    }
  }

  function setSortColumn(id: string) {
    setSorting((previous) => [{ id, desc: previous[0]?.desc ?? false }])
  }

  function setSortDirection(desc: boolean) {
    setSorting((previous) => [{ id: previous[0]?.id ?? DEFAULT_SORTING[0].id, desc }])
  }

  return (
    <div className="recordsTableStack">
      <div className="tableToolbar">
        <label className="tableSearchField">
          <span className="srOnly">Search records</span>
          <input
            className="input tableSearchInput"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search records..."
            type="search"
          />
        </label>

        <details className="seasonFilter" ref={seasonFilterRef} open={seasonFilterOpen}>
          <summary
            className="input seasonFilterSummary"
            onClick={(event) => {
              event.preventDefault()
              setSeasonFilterOpen((open) => !open)
            }}
          >
            {seasonFilterLabel}
          </summary>
          <fieldset className="seasonFilterOptions">
            <legend className="srOnly">Filter by season year</legend>
            <label className="seasonFilterOption">
              <input type="checkbox" checked={selectedSeasonYears.length === 0} onChange={() => setSelectedSeasonYears([])} />
              All seasons
            </label>
            {seasonYears.map((year) => (
              <label key={year} className="seasonFilterOption">
                <input
                  type="checkbox"
                  value={year}
                  checked={selectedSeasonYears.includes(year)}
                  onChange={(event) => toggleSeasonYear(year, event.target.checked)}
                />
                {year}
              </label>
            ))}
          </fieldset>
        </details>

        <details className="seasonFilter gardenRowFilter" ref={gardenRowFilterRef} open={gardenRowFilterOpen}>
          <summary
            className="input seasonFilterSummary"
            onClick={(event) => {
              event.preventDefault()
              setGardenRowFilterOpen((open) => !open)
            }}
          >
            {gardenRowFilterLabel}
          </summary>
          <fieldset className="seasonFilterOptions">
            <legend className="srOnly">Filter by garden row</legend>
            <label className="seasonFilterOption">
              <input
                type="checkbox"
                checked={selectedGardenRows.length === 0}
                onChange={() => {
                  setSelectedGardenRows([])
                  setSorting(DEFAULT_SORTING)
                }}
              />
              All rows/beds
            </label>
            {gardenRows.map((row) => (
              <label key={row} className="seasonFilterOption">
                <input
                  type="checkbox"
                  value={row}
                  checked={selectedGardenRows.includes(row)}
                  onChange={(event) => toggleGardenRow(row, event.target.checked)}
                />
                Row/Bed {row}
              </label>
            ))}
          </fieldset>
        </details>

        <div className="tableToolbarRightControls">
          <button className="btn ghost tableOptionsButton" type="button" onClick={() => setTableOptionsOpen(true)}>
            Table Options
          </button>
        </div>
      </div>

      {tableOptionsOpen ? (
        <div
          className="modalOverlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="table-options-title"
          onMouseDown={() => setTableOptionsOpen(false)}
        >
          <div className="modal tableOptionsModal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <div className="modalTitle" id="table-options-title">Table Options</div>
                <div className="modalSub">Choose rows per page, visible columns, and sort order.</div>
              </div>
              <button className="btn ghost" type="button" onClick={() => setTableOptionsOpen(false)}>Close</button>
            </div>
            <div className="modalBody tableOptionsBody">
              <div className="tableOptionsControls">
                <DahliaPickerField
                  label="Rows per page"
                  required
                  clearable={false}
                  layout="list"
                  centerOptionText
                  modalWidth="min(320px, 100%)"
                  value={String(pagination.pageSize)}
                  options={pageSizeOptions.map((pageSize) => ({ value: String(pageSize), label: String(pageSize) }))}
                  onChange={(value) => table.setPageSize(Number(value))}
                />
                <DahliaPickerField
                  label="Sort by"
                  required
                  clearable={false}
                  layout="grid"
                  columns={2}
                  value={sorting[0]?.id ?? DEFAULT_SORTING[0].id}
                  options={SORTABLE_COLUMN_CHECKLIST.map((column) => ({ value: column.id, label: column.label }))}
                  onChange={(value) => setSortColumn(value as string)}
                />
                <DahliaPickerField
                  label="Direction"
                  required
                  clearable={false}
                  layout="list"
                  centerOptionText
                  modalWidth="min(320px, 100%)"
                  value={sorting[0]?.desc ? 'desc' : 'asc'}
                  options={[
                    { value: 'asc', label: 'Ascending' },
                    { value: 'desc', label: 'Descending' },
                  ]}
                  onChange={(value) => setSortDirection(value === 'desc')}
                />
              </div>

              <fieldset className="tableOptionsColumnsGroup">
                <legend>Columns</legend>
                <div className="tableOptionsColumnList">
                  {COLUMN_CHECKLIST.map((column) => (
                    <label key={column.id} className="seasonFilterOption">
                      <input
                        type="checkbox"
                        checked={table.getColumn(column.id)?.getIsVisible() ?? true}
                        onChange={(event) => table.getColumn(column.id)?.toggleVisibility(event.target.checked)}
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

      <div className="tableWrap" ref={tableWrapRef}>
        <table className="table" style={hasCustomColumnSizes ? { width: 'max-content', minWidth: '100%' } : undefined}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h, index) => (
                <th
                  key={h.id}
                  data-column-id={h.column.id}
                  onClick={h.column.getToggleSortingHandler()}
                  className={`${columnClassNames[h.column.id] ?? ''}${h.column.getCanSort() ? ' sortable' : ''}`.trim()}
                  style={columnWidthStyle(h.column.id)}
                >
                  <span className="thInner">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getIsSorted() === 'asc' ? ' ▲' : h.column.getIsSorted() === 'desc' ? ' ▼' : ''}
                  </span>
                  <div
                    className={`columnResizeHandle${index === hg.headers.length - 1 ? ' columnResizeHandleLast' : ''}`}
                    onPointerDown={handleColumnResizeStart(h.column.id)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={visibleColumnCount} className="empty">
                Loading records...
              </td>
            </tr>
          ) : pageRows.length > 0 ? (
            <>
              {virtualPaddingTop > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={visibleColumnCount} className="virtualTableSpacer" style={{ height: virtualPaddingTop }} />
                </tr>
              ) : null}
              {virtualRows.map((virtualRow) => {
                const r = pageRows[virtualRow.index]
                return (
              <tr key={r.id} className="row" onClick={() => onOpen(r.original)}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className={columnClassNames[c.column.id]} style={columnWidthStyle(c.column.id)}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
                )
              })}
              {virtualPaddingBottom > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={visibleColumnCount} className="virtualTableSpacer" style={{ height: virtualPaddingBottom }} />
                </tr>
              ) : null}
            </>
          ) : (
            <tr>
              <td colSpan={visibleColumnCount} className="empty">
                No available data.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>

      <div className="tablePagination">
        <span className="paginationStatus">
          Showing {pageStart}-{pageEnd} of {filteredRows.length}
        </span>
        <div className="paginationActions">
          <button className="btn paginationButton" type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </button>
          <span className="paginationPage">
            Page {filteredRows.length === 0 ? 0 : pagination.pageIndex + 1} of {pageCount}
          </span>
          <button className="btn paginationButton" type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </button>
          <button className="btn paginationButton" type="button" onClick={onLoadMore} disabled={!hasMore || loadingMore || !loadedEndReached}>
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      </div>
    </div>
  )
}
