import { useEffect, useMemo, useRef } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table'
import { useState } from 'react'
import type { DahliaRecord, Order } from '../types'

function compareGardenRows(a: string, b: string) {
  if (a.length !== b.length) return a.length - b.length
  return a.localeCompare(b)
}

function compareGardenLocations(a: DahliaRecord, b: DahliaRecord) {
  const areaCompare = String(a.meta?.gardenZone ?? a.meta?.gardenArea ?? '').localeCompare(String(b.meta?.gardenZone ?? b.meta?.gardenArea ?? ''))
  if (areaCompare !== 0) return areaCompare

  const rowCompare = compareGardenRows(a.meta?.rowOrBed ?? a.meta?.gardenRow ?? '', b.meta?.rowOrBed ?? b.meta?.gardenRow ?? '')
  if (rowCompare !== 0) return rowCompare

  const aPosition = Number(a.meta?.position ?? a.meta?.gardenPosition)
  const bPosition = Number(b.meta?.position ?? b.meta?.gardenPosition)
  if (Number.isFinite(aPosition) && Number.isFinite(bPosition) && aPosition !== bPosition) return aPosition - bPosition

  return formatGardenLocation(a).localeCompare(formatGardenLocation(b), undefined, { numeric: true })
}

function resolveRecordPhoto(record: DahliaRecord) {
  const recordDefault = record.recordPhotos?.find((photo) => photo.id === record.defaultRecordPhotoId)
  const cultivarDefault = record.cultivarPhotos?.find((photo) => photo.id === record.defaultCultivarPhotoId)
  if (record.defaultPhotoScope === 'cultivar') {
    return cultivarDefault?.thumbnailUrl || cultivarDefault?.imageUrl || record.cultivarThumbnailUrl || record.cultivarImageUrl || recordDefault?.thumbnailUrl || recordDefault?.imageUrl || record.thumbnailUrl || record.imageUrl
  }
  return recordDefault?.thumbnailUrl || recordDefault?.imageUrl || cultivarDefault?.thumbnailUrl || cultivarDefault?.imageUrl || record.thumbnailUrl || record.imageUrl || record.cultivarThumbnailUrl || record.cultivarImageUrl
}

function formatGardenLocation(record: DahliaRecord) {
  const plantingState = record.meta?.plantingState ?? 'purchased_container'
  if (plantingState === 'purchased_container') return 'Purchased Container'
  if (plantingState === 'garden_tray') return 'Garden Tray'
  if (plantingState === 'not_planted') return 'Not Planted'
  if (plantingState === 'not_viable') return 'Not Viable'

  const gardenArea = record.meta?.gardenZone ?? record.meta?.gardenArea
  const gardenRow = record.meta?.rowOrBed ?? record.meta?.gardenRow
  const gardenPosition = record.meta?.position ?? record.meta?.gardenPosition
  const rowAndPosition = gardenRow && gardenPosition ? `${gardenRow}${gardenPosition}` : record.gardenLocation

  return [gardenArea, rowAndPosition].filter(Boolean).join(' - ')
}

const columnClassNames: Record<string, string> = {
  recordNumber: 'colRecordNumber',
  thumb: 'colThumbnail',
  flowerName: 'colFlowerName',
  color: 'colColor',
  size: 'colSize',
  height: 'colHeight',
  gardenLocation: 'colGardenLocation',
  seasonYearStart: 'colSeasonYear',
}

const pageSizeOptions = [10, 25, 50, 100]

function refreshIntervalLabel(intervalMs: number) {
  if (intervalMs === 0) return 'Off'
  if (intervalMs < 60_000) return `${intervalMs / 1000} sec`
  return `${intervalMs / 60_000} min`
}

export function RecordsTable({
  rows,
  orders = [],
  loading = false,
  refreshIntervalMs,
  refreshIntervalOptions,
  onRefreshIntervalChange,
  onOpen,
}: {
  rows: DahliaRecord[]
  orders?: Order[]
  loading?: boolean
  refreshIntervalMs: number
  refreshIntervalOptions: number[]
  onRefreshIntervalChange: (intervalMs: number) => void
  onOpen: (r: DahliaRecord) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 })
  const [search, setSearch] = useState('')
  const [selectedSeasonYears, setSelectedSeasonYears] = useState<number[]>([])
  const [selectedGardenRows, setSelectedGardenRows] = useState<string[]>([])
  const [seasonFilterOpen, setSeasonFilterOpen] = useState(false)
  const [gardenRowFilterOpen, setGardenRowFilterOpen] = useState(false)
  const [pageSizeFilterOpen, setPageSizeFilterOpen] = useState(false)
  const seasonFilterRef = useRef<HTMLDetailsElement>(null)
  const gardenRowFilterRef = useRef<HTMLDetailsElement>(null)
  const pageSizeFilterRef = useRef<HTMLDetailsElement>(null)

  const columns = useMemo<ColumnDef<DahliaRecord>[]>(
    () => [
      {
        header: '#',
        accessorKey: 'recordNumber',
      },
      {
        header: 'Thumbnail',
        id: 'thumb',
        cell: ({ row }) => {
          const url = resolveRecordPhoto(row.original)
          return url ? <img className="thumb" src={url} alt="" loading="lazy" decoding="async" /> : <div className="thumb ph" />
        },
        enableSorting: false,
      },
      {
        header: 'Flower Name',
        accessorKey: 'flowerName',
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
    if (selectedSeasonYears.length === 0 && seasonYears.length > 0) {
      setSelectedSeasonYears([seasonYears[0]])
    }
  }, [seasonYears, selectedSeasonYears.length])

  const gardenRows = useMemo(
    () =>
      Array.from(new Set(rows.map((record) => record.meta?.rowOrBed ?? record.meta?.gardenRow).filter((row): row is string => Boolean(row)))).sort(
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

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const selectedSeasonYearSet = new Set(selectedSeasonYears)
    const selectedGardenRowSet = new Set(selectedGardenRows)

    return rows.filter((record) => {
      if (selectedSeasonYearSet.size > 0 && !selectedSeasonYearSet.has(record.seasonYearStart)) return false
      if (selectedGardenRowSet.size > 0 && !selectedGardenRowSet.has(record.meta?.rowOrBed ?? record.meta?.gardenRow ?? '')) return false
      if (!query) return true

      const searchableValues = [
        record.recordNumber,
        record.flowerName,
        record.core.color,
        record.core.size,
        record.growth.height,
        formatGardenLocation(record),
        record.seasonYearStart,
        record.tuber.source,
        ...(record.tuber.linkedOrderItemIds ?? []).flatMap((id) => linkedOrderSearchValuesByItemId.get(id) ?? []),
      ]

      return searchableValues.some((value) => String(value ?? '').toLowerCase().includes(query))
    })
  }, [rows, search, selectedSeasonYears, selectedGardenRows, linkedOrderSearchValuesByItemId])

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
    if (!pageSizeFilterOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!pageSizeFilterRef.current?.contains(event.target as Node)) {
        setPageSizeFilterOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [pageSizeFilterOpen])

  useEffect(() => {
    setPagination((previous) => ({ ...previous, pageIndex: 0 }))
  }, [search, selectedSeasonYears, selectedGardenRows])

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  const pageRows = table.getRowModel().rows
  const pageCount = table.getPageCount()
  const pageStart = filteredRows.length === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1
  const pageEnd = Math.min(filteredRows.length, pageStart + pageRows.length - 1)

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
                  setSorting([{ id: 'recordNumber', desc: false }])
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
          <div className="pageSizeControl">
            <span className="pageSizeLabel">Rows</span>
            <details className="seasonFilter pageSizeFilter" ref={pageSizeFilterRef} open={pageSizeFilterOpen}>
              <summary
                className="input seasonFilterSummary"
                onClick={(event) => {
                  event.preventDefault()
                  setPageSizeFilterOpen((open) => !open)
                }}
              >
                {pagination.pageSize}
              </summary>
              <fieldset className="seasonFilterOptions pageSizeOptions">
                <legend className="srOnly">Rows per page</legend>
                {pageSizeOptions.map((pageSize) => (
                  <label key={pageSize} className="seasonFilterOption">
                    <input
                      type="radio"
                      name="recordsPageSize"
                      value={pageSize}
                      checked={pagination.pageSize === pageSize}
                      onChange={() => {
                        table.setPageSize(pageSize)
                        setPageSizeFilterOpen(false)
                      }}
                    />
                    {pageSize}
                  </label>
                ))}
              </fieldset>
            </details>
          </div>

          <label className="pageSizeControl">
            <span className="pageSizeLabel">Refresh</span>
            <select className="select" value={refreshIntervalMs} onChange={(event) => onRefreshIntervalChange(Number(event.target.value))}>
              {refreshIntervalOptions.map((intervalMs) => (
                <option key={intervalMs} value={intervalMs}>{refreshIntervalLabel(intervalMs)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="tableWrap">
        <table className="table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} onClick={h.column.getToggleSortingHandler()} className={`${columnClassNames[h.column.id] ?? ''}${h.column.getCanSort() ? ' sortable' : ''}`.trim()}>
                  <span className="thInner">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getIsSorted() === 'asc' ? ' ▲' : h.column.getIsSorted() === 'desc' ? ' ▼' : ''}
                  </span>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={8} className="empty">
                Loading records...
              </td>
            </tr>
          ) : pageRows.length > 0 ? (
            pageRows.map((r) => (
              <tr key={r.id} className="row" onClick={() => onOpen(r.original)}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className={columnClassNames[c.column.id]}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="empty">
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
        </div>
      </div>
    </div>
  )
}
