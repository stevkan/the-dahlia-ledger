import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const DAHLIA_FORM_OPTIONS = [
  'Anemone',
  'Ball',
  'Cactus',
  'Collarette',
  'Formal Decorative',
  'Incurved Cactus',
  'Informal Decorative',
  'Mignon Single',
  'Orchid',
  'Peony',
  'Pom Pon',
  'Semi Cactus',
  'Semi-Double',
  'Single',
  'Stellar',
  'Waterlily',
]

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

export function DahliaFormField({
  label = 'Form',
  hint,
  value,
  onChange,
}: {
  label?: string
  hint?: string
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)

  function select(form: string) {
    onChange(form)
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
          <span className="dahliaFormPickerTitle">Bloom Form</span>
          <button className="btn ghost compact" type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
        <div className="dahliaFormPickerGrid">
          <button
            className={`dahliaFormOption dahliaFormOptionNone${!value ? ' selected' : ''}`}
            type="button"
            onClick={clear}
          >
            None
          </button>
          {DAHLIA_FORM_OPTIONS.map((form) => (
            <button
              key={form}
              className={`dahliaFormOption${value === form ? ' selected' : ''}`}
              type="button"
              onClick={() => select(form)}
            >
              {form}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className="field">
      <FieldHintLabel label={label} hint={hint} />
      <button
        className="input dahliaFormTrigger"
        type="button"
        onClick={() => setOpen(true)}
      >
        {value ? value : <span className="dahliaFormPlaceholder">Select...</span>}
      </button>
      {open ? createPortal(picker, document.body) : null}
    </div>
  )
}
