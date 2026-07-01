import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type PickerOption = string | { value: string; label: string; disabled?: boolean }

function optionValue(opt: PickerOption): string {
  return typeof opt === 'string' ? opt : opt.value
}

function optionLabel(opt: PickerOption): string {
  return typeof opt === 'string' ? opt : opt.label
}

function optionDisabled(opt: PickerOption): boolean {
  return typeof opt === 'string' ? false : (opt.disabled ?? false)
}

function FieldHintLabel({ label, hint, action }: { label: string; hint?: string; action?: React.ReactNode }) {
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
          {visible ? <span className="helpTooltip recordFieldTooltip" role="tooltip">{hint}</span> : null}
        </button>
      ) : null}
    </div>
  )
}

export function DahliaPickerField({
  label,
  hint,
  title,
  options,
  value,
  placeholder,
  onChange,
  layout = 'grid',
  clearable = true,
  labelAction,
}: {
  label: string
  hint?: string
  title?: string
  options: PickerOption[]
  value: string | undefined
  placeholder?: string
  onChange: (v: string | undefined) => void
  layout?: 'grid' | 'list'
  clearable?: boolean
  labelAction?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  const matched = value !== undefined ? options.find((opt) => optionValue(opt) === value) : undefined
  const displayValue = value !== undefined ? (matched ? optionLabel(matched) : value) : undefined

  function select(v: string) {
    onChange(v)
    setOpen(false)
  }

  function clear() {
    onChange(undefined)
    setOpen(false)
  }

  const picker = (
    <div className="dahliaFormOverlay">
      <div className="dahliaFormPicker">
        <div className="dahliaFormPickerHeader">
          <span className="dahliaFormPickerTitle">{title ?? label}</span>
          <button className="btn ghost compact" type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
        <div className={layout === 'list' ? 'dahliaFormPickerList' : 'dahliaFormPickerGrid'}>
          {clearable ? (
            <button
              className={`dahliaFormOption dahliaFormOptionNone${!value ? ' selected' : ''}`}
              type="button"
              onClick={clear}
            >
              None
            </button>
          ) : null}
          {options.map((opt) => {
            const v = optionValue(opt)
            const l = optionLabel(opt)
            const disabled = optionDisabled(opt)
            return (
              <button
                key={v}
                className={`dahliaFormOption${value === v ? ' selected' : ''}`}
                type="button"
                disabled={disabled}
                onClick={() => select(v)}
              >
                {l}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <div className="field">
      <FieldHintLabel label={label} hint={hint} action={labelAction} />
      <button
        className="input dahliaFormTrigger"
        type="button"
        onClick={() => setOpen(true)}
      >
        {displayValue ?? <span className="dahliaFormPlaceholder">{placeholder ?? 'Select...'}</span>}
      </button>
      {open ? createPortal(picker, document.body) : null}
    </div>
  )
}
