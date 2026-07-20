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
          {visible ? <span className="helpTooltip recordFieldTooltip" role="tooltip">{hint}</span> : null}
        </button>
      ) : null}
    </div>
  )
}

type CommonProps = {
  label: string
  hint?: string
  title?: string
  options: PickerOption[]
  placeholder?: string
  layout?: 'grid' | 'list'
  columns?: number
  modalWidth?: number | string
  centerOptionText?: boolean
  wrapOptionText?: boolean
  labelAction?: React.ReactNode
  required?: boolean
  disabled?: boolean
}

type SingleSelectProps = CommonProps & {
  multiple?: false
  value: string | undefined
  onChange: (v: string | undefined) => void
  clearable?: boolean
}

type MultiSelectProps = CommonProps & {
  multiple: true
  values: string[]
  onChange: (values: string[]) => void
  summary?: string
  allLabel?: string
}

type Props = SingleSelectProps | MultiSelectProps

export function DahliaPickerField(props: Props) {
  const {
    label,
    hint,
    title,
    options,
    placeholder,
    layout = 'grid',
    columns,
    modalWidth,
    centerOptionText,
    wrapOptionText,
    labelAction,
    required,
    disabled,
  } = props
  const [open, setOpen] = useState(false)

  function optionStyle(): React.CSSProperties | undefined {
    const width = layout === 'list' && columns ? `${100 / columns}%` : undefined
    const textAlign = centerOptionText ? 'center' : wrapOptionText ? 'left' : undefined
    const whiteSpace = wrapOptionText ? 'normal' : undefined
    const wordBreak = wrapOptionText ? 'break-word' : undefined
    return width || textAlign || whiteSpace ? { width, textAlign, whiteSpace, wordBreak } : undefined
  }

  let displayValue: React.ReactNode
  let optionsBody: React.ReactNode

  if (props.multiple) {
    const { values, onChange, summary, allLabel = 'All' } = props

    function toggle(v: string) {
      onChange(values.includes(v) ? values.filter((item) => item !== v) : [...values, v])
    }

    function clearAll() {
      onChange([])
      setOpen(false)
    }

    displayValue = summary ?? (values.length === 0 ? undefined : values.length === 1 ? values[0] : `${values.length} selected`)

    optionsBody = (
      <>
        <button
          className={`dahliaFormOption dahliaFormOptionNone${values.length === 0 ? ' selected' : ''}`}
          type="button"
          style={optionStyle()}
          onClick={clearAll}
        >
          {allLabel}
        </button>
        {options.map((opt) => {
          const v = optionValue(opt)
          const l = optionLabel(opt)
          const optDisabled = optionDisabled(opt)
          return (
            <button
              key={v}
              className={`dahliaFormOption${values.includes(v) ? ' selected' : ''}`}
              type="button"
              disabled={optDisabled}
              style={optionStyle()}
              onClick={() => toggle(v)}
            >
              {l}
            </button>
          )
        })}
      </>
    )
  } else {
    const { value, onChange, clearable = true } = props
    const matched = value !== undefined ? options.find((opt) => optionValue(opt) === value) : undefined
    displayValue = value !== undefined ? (matched ? optionLabel(matched) : value) : undefined

    function select(v: string) {
      onChange(v)
      setOpen(false)
    }

    function clear() {
      onChange(undefined)
      setOpen(false)
    }

    optionsBody = (
      <>
        {clearable ? (
          <button
            className={`dahliaFormOption dahliaFormOptionNone${!value ? ' selected' : ''}`}
            type="button"
            style={optionStyle()}
            onClick={clear}
          >
            None
          </button>
        ) : null}
        {options.map((opt) => {
          const v = optionValue(opt)
          const l = optionLabel(opt)
          const optDisabled = optionDisabled(opt)
          return (
            <button
              key={v}
              className={`dahliaFormOption${value === v ? ' selected' : ''}`}
              type="button"
              disabled={optDisabled}
              style={optionStyle()}
              onClick={() => select(v)}
            >
              {l}
            </button>
          )
        })}
      </>
    )
  }

  const picker = (
    <div className="dahliaFormOverlay">
      <div className="dahliaFormPicker" style={modalWidth ? { width: typeof modalWidth === 'number' ? `${modalWidth}px` : modalWidth } : undefined}>
        <div className="dahliaFormPickerHeader">
          <span className="dahliaFormPickerTitle">{title ?? label}</span>
          <button className="btn ghost compact" type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
        <div
          className={layout === 'list' ? 'dahliaFormPickerList' : 'dahliaFormPickerGrid'}
          style={layout === 'grid' && columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}
        >
          {optionsBody}
        </div>
      </div>
    </div>
  )

  return (
    <div className="field">
      <FieldHintLabel label={label} hint={hint} required={required} action={labelAction} />
      <button
        className="input dahliaFormTrigger"
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {displayValue ?? <span className="dahliaFormPlaceholder">{placeholder ?? 'Select...'}</span>}
      </button>
      {open ? createPortal(picker, document.body) : null}
    </div>
  )
}
