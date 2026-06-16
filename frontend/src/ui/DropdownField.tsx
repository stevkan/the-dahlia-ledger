import { useState } from 'react'

export type DropdownOption = {
  value: string
  label: string
  disabled?: boolean
}

type Props = {
  label: string
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  onOpenChange?: (open: boolean, optionCount: number) => void
  disabled?: boolean
}

export function DropdownField({ label, value, options, onChange, onOpenChange, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  function setDropdownOpen(nextOpen: boolean) {
    if (disabled && nextOpen) return
    setOpen(nextOpen)
    onOpenChange?.(nextOpen, options.length)
  }

  function selectOption(option: DropdownOption) {
    if (option.disabled) return
    onChange(option.value)
    setDropdownOpen(false)
  }

  return (
    <div className="dropdownField" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setDropdownOpen(false)
    }}>
      <button
        className="dropdownButton select"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setDropdownOpen(!open)}
      >
        {selectedOption?.label ?? ''}
      </button>
      {open ? (
        <div className="dropdownOptions" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              className="dropdownOption"
              key={`${option.value}-${option.label}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
