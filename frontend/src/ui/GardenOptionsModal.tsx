import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_GARDEN_OPTIONS } from '../gardenOptions'
import type { DahliaRecord, Garden, GardenOptionKey, GardenOptions } from '../types'

type GardenOptionUsageRecord = Pick<DahliaRecord, 'id' | 'gardenId' | 'recordNumber' | 'flowerName' | 'seasonYearStart' | 'meta'>

const OPTION_GROUPS: { key: GardenOptionKey; title: string; description: string }[] = [
  { key: 'gardenAreas', title: 'Zones', description: 'Flexible zones or sections available for planted records.' },
  { key: 'gardenRows', title: 'Rows/Beds', description: 'Row or bed labels available inside a zone.' },
  { key: 'gardenPositions', title: 'Positions', description: 'Position labels available inside each row or bed.' },
]
const OPTION_VALUE_HINTS: Record<GardenOptionKey, string> = {
  gardenAreas: 'Enter one zone value at a time. Commas and ranges are saved as part of the zone name.',
  gardenRows: 'Enter multiple rows separated by commas, or ranges like A-D. Wrap a value in quotes to save it literally.',
  gardenPositions: 'Enter multiple positions separated by commas, or ranges like 1-25. Wrap a value in quotes to save it literally.',
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="modalOverlay stackedModalOverlay">
      <div className="modal">
        {children}
      </div>
    </div>
  )
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
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
      <span>{label}</span>
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
          {visible ? <span className="helpTooltip" role="tooltip">{hint}</span> : null}
        </button>
      ) : null}
    </div>
  )
}

function normalizeOption(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function nextGardenRow(row: string) {
  const chars = row.split('')

  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (chars[index] !== 'Z') {
      chars[index] = String.fromCharCode(chars[index].charCodeAt(0) + 1)
      return chars.join('')
    }
    chars[index] = 'A'
  }

  return `A${chars.join('')}`
}

function buildGardenRowRange(start: string, end: string) {
  const rows: string[] = []
  let current = start

  while (true) {
    rows.push(current)
    if (current === end) return rows
    current = nextGardenRow(current)
    if (rows.length > 1000) return [start, end]
  }
}

function splitOptionTokens(value: string) {
  const tokens: { value: string; quoted: boolean }[] = []
  let current = ''
  let quoted = false
  let tokenQuoted = false

  for (const char of value.trim()) {
    if (char === '"') {
      quoted = !quoted
      tokenQuoted = true
      continue
    }

    if (char === ',' && !quoted) {
      const token = normalizeOption(current)
      if (token) tokens.push({ value: token, quoted: tokenQuoted })
      current = ''
      tokenQuoted = false
      continue
    }

    current += char
  }

  const token = normalizeOption(current)
  if (token) tokens.push({ value: token, quoted: tokenQuoted })
  return tokens
}

function parseDelimitedOptions(key: GardenOptionKey, value: string) {
  return splitOptionTokens(value).flatMap(({ value: part, quoted }) => {
    if (quoted) return [part]

    const compactPart = part.replace(/\s*-\s*/g, '-')
    const compactRangeMatch = compactPart.match(/^(\d+)-(\d+)$/)
    if (compactRangeMatch) {
      const start = Number(compactRangeMatch[1])
      const end = Number(compactRangeMatch[2])
      const step = start <= end ? 1 : -1
      const length = Math.abs(end - start) + 1
      return Array.from({ length }, (_, index) => String(start + index * step))
    }

    const rowRangeMatch = key === 'gardenRows' ? compactPart.match(/^([A-Za-z]+)-([A-Za-z]+)$/) : null
    if (!rowRangeMatch) return part ? [part] : []

    const start = rowRangeMatch[1].toUpperCase()
    const end = rowRangeMatch[2].toUpperCase()
    if (start > end) return [start, end]

    return buildGardenRowRange(start, end)
  })
}

function parseNewOptionValues(key: GardenOptionKey, value: string) {
  if (key === 'gardenAreas') return [normalizeOption(value)]

  return parseDelimitedOptions(key, value).map(normalizeOption)
}

function recordGardenOptionValue(record: DahliaRecord, key: GardenOptionKey) {
  if (key === 'gardenAreas') return record.meta?.gardenZone ?? record.meta?.gardenArea ?? ''
  if (key === 'gardenRows') return record.meta?.rowOrBed ?? record.meta?.gardenRow ?? ''

  const position = record.meta?.position ?? record.meta?.gardenPosition
  return position ? String(position) : ''
}

function sortUsageRecords(records: GardenOptionUsageRecord[]) {
  return [...records].sort((a, b) => (a.recordNumber ?? Number.MAX_SAFE_INTEGER) - (b.recordNumber ?? Number.MAX_SAFE_INTEGER))
}

function buildGardenOptionUsage(records: DahliaRecord[], key: GardenOptionKey) {
  const usageByValue = new Map<string, GardenOptionUsageRecord[]>()

  for (const record of records) {
    if (record.meta?.plantingState !== 'in_garden') continue

    const value = recordGardenOptionValue(record, key)
    if (!value) continue

    const normalizedValue = value.toLowerCase()
    const usageRecords = usageByValue.get(normalizedValue) ?? []
    usageRecords.push(record)
    usageByValue.set(normalizedValue, usageRecords)
  }

  for (const [value, usageRecords] of usageByValue) {
    usageByValue.set(value, sortUsageRecords(usageRecords))
  }

  return usageByValue
}

function formatGardenOptionUsageDetails(record: GardenOptionUsageRecord, gardens: Garden[]) {
  const gardenZone = record.meta?.gardenZone ?? record.meta?.gardenArea
  const gardenName = gardens.find((garden) => garden.id === record.gardenId)?.name
  return [record.flowerName || 'Unnamed flower', gardenZone ? `${gardenZone} zone` : null, gardenName, record.seasonYearStart].filter(Boolean).join(', ')
}

export function GardenOptionsModal({
  options,
  gardens,
  records,
  initialGroup = 'gardenAreas',
  onClose,
  onChange,
  onRename,
  onOpenRecord,
}: {
  options: GardenOptions
  gardens: Garden[]
  records: DahliaRecord[]
  initialGroup?: GardenOptionKey
  onClose: () => void
  onChange: (options: GardenOptions) => void
  onRename?: (key: GardenOptionKey, previousValue: string, nextValue: string) => void
  onOpenRecord?: (record: Pick<DahliaRecord, 'id'>) => void
}) {
  const deleteControlsRef = useRef<HTMLDivElement | null>(null)
  const [activeGroup, setActiveGroup] = useState<GardenOptionKey>(initialGroup)
  const [selectedValue, setSelectedValue] = useState('')
  const [formValue, setFormValue] = useState('')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [deleteAllValues, setDeleteAllValues] = useState(false)
  const [renameArmed, setRenameArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedGroup = useMemo(() => OPTION_GROUPS.find((group) => group.key === activeGroup) ?? OPTION_GROUPS[0], [activeGroup])
  const values = options[activeGroup]
  const activeUsageByValue = useMemo(() => buildGardenOptionUsage(records, activeGroup), [activeGroup, records])
  const selectedUsageRecords = selectedValue ? activeUsageByValue.get(selectedValue.toLowerCase()) ?? [] : []
  const allUsageRecords = useMemo(() => {
    const uniqueRecords = new Map<string, GardenOptionUsageRecord>()
    for (const usageRecords of activeUsageByValue.values()) {
      for (const record of usageRecords) uniqueRecords.set(record.id, record)
    }
    return sortUsageRecords([...uniqueRecords.values()])
  }, [activeUsageByValue])
  const canSave = formValue.trim().length > 0
  const normalizedFormValue = normalizeOption(formValue)
  const isRename = Boolean(selectedValue && normalizedFormValue && selectedValue !== normalizedFormValue)

  useEffect(() => {
    if (!deleteArmed) return

    function clearOnOutsidePointer(event: PointerEvent) {
      if (!deleteControlsRef.current?.contains(event.target as Node)) {
        setDeleteArmed(false)
      }
    }

    document.addEventListener('pointerdown', clearOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', clearOnOutsidePointer)
  }, [deleteArmed])

  function clearForm() {
    setSelectedValue('')
    setFormValue('')
    setDeleteArmed(false)
    setDeleteAllValues(false)
    setRenameArmed(false)
    setError(null)
  }

  function selectGroup(key: GardenOptionKey) {
    setActiveGroup(key)
    clearForm()
  }

  function editValue(value: string) {
    if (selectedValue === value) {
      clearForm()
      return
    }

    setSelectedValue(value)
    setFormValue(value)
    setDeleteArmed(false)
    setDeleteAllValues(false)
    setRenameArmed(false)
    setError(null)
  }

  function cancelEdit() {
    if (renameArmed) {
      setSelectedValue('')
      setFormValue(normalizedFormValue)
      setDeleteArmed(false)
      setDeleteAllValues(false)
      setRenameArmed(false)
      setError(null)
      return
    }

    clearForm()
  }

  function saveValue() {
    const nextValue = normalizedFormValue
    const nextNewValues = selectedValue ? [nextValue] : parseNewOptionValues(activeGroup, formValue)
    if (!nextNewValues.length) {
      setError('Enter at least one value.')
      return
    }

    const uniqueNewValues = nextNewValues.filter((value, index) => nextNewValues.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index)
    const duplicate = uniqueNewValues.find((newValue) => values.some((value) => value.toLowerCase() === newValue.toLowerCase() && value !== selectedValue))
    if (duplicate) {
      setError(`${duplicate} already exists.`)
      return
    }

    if (isRename && !renameArmed) {
      setRenameArmed(true)
      setError('Renaming this value will also update stored records that use it. Click Confirm Rename to continue, or Cancel Edit and save it as a new value instead.')
      return
    }

    const nextValues = selectedValue
      ? values.map((value) => (value === selectedValue ? nextValue : value))
      : [...values, ...uniqueNewValues]
    onChange({ ...options, [activeGroup]: nextValues })
    if (selectedValue && selectedValue !== nextValue) onRename?.(activeGroup, selectedValue, nextValue)
    clearForm()
  }

  function deleteSelectedValue() {
    if (!selectedValue) return
    const usageRecords = deleteAllValues ? allUsageRecords : selectedUsageRecords
    if (usageRecords.length) {
      setDeleteArmed(false)
      setError(`${deleteAllValues ? 'One or more values are' : `${selectedValue} is`} in use by other records. Open the listed records and change their placement before deleting.`)
      return
    }

    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }

    onChange({ ...options, [activeGroup]: deleteAllValues ? [] : values.filter((value) => value !== selectedValue) })
    clearForm()
  }

  function restoreDefaultValues() {
    onChange({ ...options, [activeGroup]: DEFAULT_GARDEN_OPTIONS[activeGroup] })
    clearForm()
  }

  function moveSelectedValue(direction: -1 | 1) {
    if (!selectedValue) return

    const currentIndex = values.findIndex((value) => value === selectedValue)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= values.length) return

    const nextValues = [...values]
    const [movedValue] = nextValues.splice(currentIndex, 1)
    nextValues.splice(nextIndex, 0, movedValue)
    onChange({ ...options, [activeGroup]: nextValues })
  }

  function renderOptionUsage() {
    const usageRecords = deleteAllValues ? allUsageRecords : selectedUsageRecords
    if (!usageRecords.length) return null

    return (
      <div className="error inlineError companyError companyDeleteConflict">
        <div>{deleteAllValues ? 'These options are still in use by the following records.' : `${selectedValue} is still in use by the following records.`}</div>
        <div className="companyDependencyTitle">Flower records</div>
        <ul className="companyDependencyList">
          {usageRecords.map((record) => (
            <li key={record.id}>
              <button className="labelLink" type="button" onClick={() => onOpenRecord?.({ id: record.id })}>
                #{record.recordNumber ?? record.id}
              </button>
              {` - ${formatGardenOptionUsageDetails(record, gardens)}`}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <Overlay>
      <div className="modalHeader">
        <div>
          <div className="modalTitle">Placement Options</div>
          <div className="modalSub">Manage zones, rows/beds, and positions used by record placement fields.</div>
        </div>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
      <div className="modalBody companiesLayout gardenOptionsLayout">
        <div className="companyList">
          <div className="subTitle">Option Groups</div>
          {OPTION_GROUPS.map((group) => (
            <button
              key={group.key}
              className={`companyCard${activeGroup === group.key ? ' selected' : ''}`}
              type="button"
              onClick={() => selectGroup(group.key)}
            >
              <span>{group.title}</span>
              <span>{options[group.key].length} saved</span>
            </button>
          ))}
        </div>

        <div className="companyForm">
          <div className="gardenOptionsDescriptionRow">
            <div className="gardenOptionsDescriptionContent">
              <div className="subTitle">{selectedGroup.title}</div>
              <div className="modalSub gardenOptionsDescription">{selectedGroup.description}</div>
            </div>
            {selectedValue ? (
              <div className="rowActions gardenOptionMoveActions">
                <button className="btn ghost" type="button" onClick={() => moveSelectedValue(-1)}>Move up</button>
                <button className="btn ghost" type="button" onClick={() => moveSelectedValue(1)}>Move down</button>
              </div>
            ) : null}
          </div>
          <div className="gardenOptionValueList">
            {values.length ? values.map((value) => (
              <button
                key={value}
                className={`gardenOptionValue${selectedValue === value ? ' selected' : ''}`}
                type="button"
                onClick={() => editValue(value)}
              >
                {value}
              </button>
            )) : <div className="muted">No values saved yet.</div>}
          </div>
          <label className="field gardenOptionField">
            <FieldLabel label={selectedValue ? 'Edit Value' : 'New Value'} hint={OPTION_VALUE_HINTS[activeGroup]} />
            <input className="input" value={formValue} onChange={(event) => {
              setFormValue(event.target.value)
              setRenameArmed(false)
              setError(null)
            }} />
          </label>
          {error ? <div className="error inlineError companyError">{error}</div> : null}
          {renderOptionUsage()}
          <div className="rowActions companyActions">
            {selectedValue ? <button className="btn ghost" type="button" onClick={cancelEdit}>Cancel Edit</button> : null}
            <button className="btn" type="button" disabled={!canSave} onClick={saveValue}>
              {renameArmed ? 'Confirm Rename' : selectedValue ? 'Update Value' : 'Save Value'}
            </button>
            {!values.length ? (
              <button className="btn ghost gardenOptionRestoreDefaults" type="button" onClick={restoreDefaultValues}>
                Use Default Values
              </button>
            ) : null}
            {selectedValue ? (
              <div ref={deleteControlsRef} className="gardenOptionDeleteControls">
                <label className="gardenOptionDeleteAll">
                  <input
                    type="checkbox"
                    checked={deleteAllValues}
                    onChange={(event) => {
                      setDeleteAllValues(event.target.checked)
                      setDeleteArmed(false)
                    }}
                  />
                  Delete all values
                </label>
                <button className="btn danger" type="button" onClick={deleteSelectedValue}>
                  {deleteArmed ? 'Confirm Delete' : 'Delete Value'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
