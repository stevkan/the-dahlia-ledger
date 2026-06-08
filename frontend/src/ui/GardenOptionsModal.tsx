import { useEffect, useMemo, useRef, useState } from 'react'
import type { GardenOptionKey, GardenOptions } from '../types'

const OPTION_GROUPS: { key: GardenOptionKey; title: string; description: string }[] = [
  { key: 'gardenAreas', title: 'Garden Areas', description: 'Physical garden sections available for planted records.' },
  { key: 'gardenRows', title: 'Garden Rows', description: 'Row labels available inside a garden area.' },
  { key: 'gardenPositions', title: 'Garden Positions', description: 'Position labels available inside each row.' },
]

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="modalOverlay">
      <div className="modal">
        {children}
      </div>
    </div>
  )
}

function normalizeOption(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function GardenOptionsModal({
  options,
  initialGroup = 'gardenAreas',
  onClose,
  onChange,
}: {
  options: GardenOptions
  initialGroup?: GardenOptionKey
  onClose: () => void
  onChange: (options: GardenOptions) => void
}) {
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null)
  const [activeGroup, setActiveGroup] = useState<GardenOptionKey>(initialGroup)
  const [selectedValue, setSelectedValue] = useState('')
  const [formValue, setFormValue] = useState('')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedGroup = useMemo(() => OPTION_GROUPS.find((group) => group.key === activeGroup) ?? OPTION_GROUPS[0], [activeGroup])
  const values = options[activeGroup]
  const canSave = formValue.trim().length > 0

  useEffect(() => {
    if (!deleteArmed) return

    function clearOnOutsidePointer(event: PointerEvent) {
      if (!deleteButtonRef.current?.contains(event.target as Node)) {
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
    setError(null)
  }

  function selectGroup(key: GardenOptionKey) {
    setActiveGroup(key)
    clearForm()
  }

  function editValue(value: string) {
    setSelectedValue(value)
    setFormValue(value)
    setDeleteArmed(false)
    setError(null)
  }

  function saveValue() {
    const nextValue = normalizeOption(formValue)
    const duplicate = values.some((value) => value.toLowerCase() === nextValue.toLowerCase() && value !== selectedValue)
    if (duplicate) {
      setError(`${nextValue} already exists.`)
      return
    }

    const nextValues = selectedValue
      ? values.map((value) => (value === selectedValue ? nextValue : value))
      : [...values, nextValue]
    onChange({ ...options, [activeGroup]: nextValues })
    clearForm()
  }

  function deleteSelectedValue() {
    if (!selectedValue) return
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }

    onChange({ ...options, [activeGroup]: values.filter((value) => value !== selectedValue) })
    clearForm()
  }

  return (
    <Overlay>
      <div className="modalHeader">
        <div>
          <div className="modalTitle">Garden Options</div>
          <div className="modalSub">Manage garden areas, rows, and positions used by record location fields.</div>
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
          <div className="subTitle">{selectedGroup.title}</div>
          <div className="modalSub gardenOptionsDescription">{selectedGroup.description}</div>
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
            <div className="label">{selectedValue ? 'Edit Value' : 'New Value'}</div>
            <input className="input" value={formValue} onChange={(event) => setFormValue(event.target.value)} />
          </label>
          {error ? <div className="error inlineError companyError">{error}</div> : null}
          <div className="rowActions companyActions">
            {selectedValue ? <button className="btn ghost" type="button" onClick={clearForm}>Cancel Edit</button> : null}
            {selectedValue ? (
              <button ref={deleteButtonRef} className="btn danger" type="button" onClick={deleteSelectedValue}>
                {deleteArmed ? 'Confirm Delete' : 'Delete Value'}
              </button>
            ) : null}
            <button className="btn" type="button" disabled={!canSave} onClick={saveValue}>
              {selectedValue ? 'Update Value' : 'Save Value'}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
