import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type DropdownOption = {
  value: string
  label: string
  disabled?: boolean
  separator?: boolean
}

type Props = {
  label: string
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  onOpenChange?: (open: boolean, optionCount: number) => void
  disabled?: boolean
  portal?: boolean
}

export function DropdownField({ label, value, options, onChange, onOpenChange, disabled = false, portal = false }: Props) {
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const selectedOption = options.find((option) => !option.separator && option.value === value) ?? options.find((option) => !option.separator)

  function setDropdownOpen(nextOpen: boolean) {
    if (disabled && nextOpen) return
    if (nextOpen && portal && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPanelStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      })
    }
    setOpen(nextOpen)
    onOpenChange?.(nextOpen, options.filter((option) => !option.separator).length)
  }

  function selectOption(option: DropdownOption) {
    if (option.disabled) return
    onChange(option.value)
    setDropdownOpen(false)
  }

  useEffect(() => {
    if (!open || !portal) return
    function onScroll(event: Event) {
      if (panelRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', onScroll, { capture: true })
  }, [open, portal])

  const panel = (
    <div
      ref={panelRef}
      className="dropdownOptions"
      role="listbox"
      aria-label={label}
      style={portal ? panelStyle : undefined}
    >
      {options.map((option, index) =>
        option.separator ? (
          <hr key={`sep-${index}`} className="dropdownSeparator" role="separator" />
        ) : (
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
        )
      )}
    </div>
  )

  return (
    <div className="dropdownField" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setDropdownOpen(false)
    }}>
      <div className="dropdownSizer" aria-hidden="true">
        {options.filter((option) => !option.separator).map((option) => (
          <div className="dropdownSizerOption" key={option.value}>{option.label}</div>
        ))}
      </div>
      <button
        ref={buttonRef}
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
      {open ? (portal ? createPortal(panel, document.body) : panel) : null}
    </div>
  )
}
