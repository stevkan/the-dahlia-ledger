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

export function ColorField({
  label = 'Color',
  hint,
  placeholder,
  value,
  knownColors,
  onChange,
  labelAction,
}: {
  label?: string
  hint?: string
  placeholder?: string
  value: string
  knownColors: string[]
  onChange: (v: string) => void
  labelAction?: React.ReactNode
}) {
  const [focused, setFocused] = useState(false)
  const [selectedFromList, setSelectedFromList] = useState(false)

  const normalizedValue = value.trim().toLowerCase()
  const filteredColors = knownColors
    .filter((color) => !normalizedValue || color.toLowerCase().includes(normalizedValue))
    .slice(0, 8)
  const showOptions = focused && !selectedFromList && filteredColors.length > 0

  function select(color: string) {
    onChange(color)
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
      <FieldHintLabel label={label} hint={hint} action={labelAction} />
      <div className="relatedRecordSearchWrap">
        <input
          className="input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          role="combobox"
          aria-expanded={showOptions}
          aria-autocomplete="list"
        />
        {selectedFromList ? (
          <button
            className="relatedRecordClear"
            type="button"
            aria-label="Clear color"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
          >
            ×
          </button>
        ) : null}
        {showOptions ? (
          <div className="relatedRecordOptions" role="listbox">
            {filteredColors.map((color) => (
              <button
                className="relatedRecordOption"
                key={color}
                type="button"
                role="option"
                aria-selected={color === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(color)}
              >
                <span className="relatedRecordOptionName">{color}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
