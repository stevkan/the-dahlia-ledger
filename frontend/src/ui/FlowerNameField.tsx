import { useEffect, useState } from 'react'

function FieldHintLabel({ label, hint, required, action }: { label: string; hint?: string; required?: boolean; action?: React.ReactNode }) {
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
          onMouseLeave={() => setVisible(false)}
          onFocus={showHint}
          onBlur={() => setVisible(false)}
          onClick={showHint}
        >
          ?
          {visible ? <span className="helpTooltip" role="tooltip">{hint}</span> : null}
        </button>
      ) : null}
    </div>
  )
}

export function FlowerNameField({
  label = 'Flower Name',
  hint,
  required,
  placeholder,
  value,
  knownFlowerNames,
  onChange,
  labelAction,
  disabled,
}: {
  label?: string
  hint?: string
  required?: boolean
  placeholder?: string
  value: string
  knownFlowerNames: string[]
  onChange: (v: string) => void
  labelAction?: React.ReactNode
  disabled?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const [selectedFromList, setSelectedFromList] = useState(false)

  const normalizedValue = value.trim().toLowerCase()
  const filteredNames = knownFlowerNames
    .filter((name) => !normalizedValue || name.toLowerCase().includes(normalizedValue))
    .slice(0, 8)
  const showOptions = !disabled && focused && !selectedFromList && filteredNames.length > 0

  function select(name: string) {
    onChange(name)
    setSelectedFromList(true)
    setFocused(false)
  }

  function clear() {
    onChange('')
    setSelectedFromList(false)
    setFocused(true)
  }

  function handleChange(v: string) {
    onChange(v)
    setSelectedFromList(false)
  }

  return (
    <div className="field relatedRecordField">
      <FieldHintLabel label={label} hint={hint} required={required} action={labelAction} />
      <div className="relatedRecordSearchWrap">
        <input
          className="input"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          role="combobox"
          aria-expanded={showOptions}
          aria-autocomplete="list"
        />
        {selectedFromList && !disabled ? (
          <button
            className="relatedRecordClear"
            type="button"
            aria-label="Clear flower name"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
          >
            ×
          </button>
        ) : null}
        {showOptions ? (
          <div className="relatedRecordOptions" role="listbox">
            {filteredNames.map((name) => (
              <button
                className="relatedRecordOption"
                key={name}
                type="button"
                role="option"
                aria-selected={name === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(name)}
              >
                <span className="relatedRecordOptionName">{name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
