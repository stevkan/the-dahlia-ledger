import { useRef, useState } from 'react'
import type { DahliaRecord, MaintenanceReminder, MaintenanceReminderInput } from '../types'

type Props = {
  reminders: MaintenanceReminder[]
  records: DahliaRecord[]
  onClose: () => void
  onCreate: (input: MaintenanceReminderInput) => Promise<void>
  onUpdate: (id: string, input: MaintenanceReminderInput) => Promise<void>
  onComplete: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function isDue(reminder: MaintenanceReminder) {
  return !reminder.completedAt && reminder.dueDate && reminder.dueDate <= todayDate()
}

function recordLabel(record: DahliaRecord) {
  const location = record.gardenLocation ? ` - ${record.gardenLocation}` : ''
  return `${record.flowerName} (${record.seasonYearStart})${location}`
}

function sortRelatedRecords(records: DahliaRecord[]) {
  return [...records].sort((a, b) => {
    const flowerName = a.flowerName.localeCompare(b.flowerName)
    if (flowerName !== 0) return flowerName

    const season = b.seasonYearStart - a.seasonYearStart
    if (season !== 0) return season

    return String(a.gardenLocation ?? '').localeCompare(String(b.gardenLocation ?? ''), undefined, { numeric: true })
  })
}

function reminderTimestamp(reminder: MaintenanceReminder) {
  return Date.parse(reminder.createdAt ?? '') || 0
}

function sortRemindersByTimestampDesc(reminders: MaintenanceReminder[]) {
  return [...reminders].sort((a, b) => reminderTimestamp(b) - reminderTimestamp(a))
}

export function MaintenanceRemindersModal({ reminders, records, onClose, onCreate, onUpdate, onComplete, onDelete }: Props) {
  const modalBodyRef = useRef<HTMLDivElement | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [relatedRecordId, setRelatedRecordId] = useState('')
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null)
  const [expandedReminderIds, setExpandedReminderIds] = useState<Set<string>>(() => new Set())
  const [showCompleted, setShowCompleted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dueReminders = sortRemindersByTimestampDesc(reminders.filter((reminder) => isDue(reminder)))
  const todoReminders = sortRemindersByTimestampDesc(reminders.filter((reminder) => !reminder.completedAt && !isDue(reminder)))
  const completedReminders = sortRemindersByTimestampDesc(reminders.filter((reminder) => reminder.completedAt))
  const relatedRecordOptions = sortRelatedRecords(records)

  function toggleExpanded(id: string) {
    setExpandedReminderIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function resetForm() {
    setTitle('')
    setNotes('')
    setDueDate('')
    setRelatedRecordId('')
    setEditingReminderId(null)
    setError(null)
  }

  function editReminder(reminder: MaintenanceReminder) {
    setTitle(reminder.title)
    setNotes(reminder.notes ?? '')
    setDueDate(reminder.dueDate ?? '')
    setRelatedRecordId(reminder.relatedRecordIds?.[0] ?? '')
    setEditingReminderId(reminder.id)
    setError(null)
    modalBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function renderReminder(reminder: MaintenanceReminder) {
    const expanded = expandedReminderIds.has(reminder.id)
    const relatedRecords = (reminder.relatedRecordIds ?? []).map((id) => records.find((record) => record.id === id)).filter(Boolean) as DahliaRecord[]
    return (
      <article key={reminder.id} className={`reminderCard ${reminder.completedAt ? 'completed' : ''} ${isDue(reminder) ? 'due' : ''} ${editingReminderId === reminder.id ? 'editing' : ''}`}>
        <div className="reminderCardSummary" role="button" tabIndex={0} onClick={() => editReminder(reminder)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            editReminder(reminder)
          }
        }}>
          <button className="reminderExpandIcon" type="button" aria-label={expanded ? 'Collapse reminder details' : 'Expand reminder details'} aria-expanded={expanded} onClick={(e) => {
            e.stopPropagation()
            toggleExpanded(reminder.id)
          }}>{expanded ? '−' : '+'}</button>
          <span className="reminderSummaryText">
            <span className="reminderTitleRow">
              <span className="reminderTitle">{reminder.title}</span>
              {isDue(reminder) ? <span className="reminderBadge">Due</span> : null}
              {reminder.completedAt ? <span className="reminderBadge complete">Complete</span> : null}
            </span>
            <span className="reminderMeta">
              {reminder.dueDate ? <span>Due {reminder.dueDate}</span> : <span>No due date</span>}
              {reminder.source === 'agent' ? <span>Agent suggested</span> : <span>User created</span>}
            </span>
          </span>
        </div>
        {expanded ? (
          <div className="reminderCardDetails">
            {reminder.notes ? <div className="reminderNotes">{reminder.notes}</div> : <div className="reminderNotes muted">No notes.</div>}
            {relatedRecords.length ? <div className="reminderRecords">Records: {relatedRecords.map(recordLabel).join(', ')}</div> : null}
            <div className="reminderActions">
              {!reminder.completedAt ? <button className="btn ghost compact" type="button" onClick={() => void onComplete(reminder.id)}>Complete</button> : null}
              <button className="btn ghost compact" type="button" onClick={() => void onDelete(reminder.id)}>Delete</button>
            </div>
          </div>
        ) : null}
      </article>
    )
  }

  function renderReminderSection(title: string, sectionReminders: MaintenanceReminder[], emptyText: string) {
    return (
      <div className="reminderSectionGroup">
        <div className="reminderSectionHeader">
          <div className="subTitle">{title}</div>
          <span className="reminderCount">{sectionReminders.length}</span>
        </div>
        {sectionReminders.length === 0 ? <div className="muted emptyReminders">{emptyText}</div> : null}
        <div className="remindersList">
          {sectionReminders.map(renderReminder)}
        </div>
      </div>
    )
  }

  async function submit() {
    if (!title.trim() || busy) return

    setBusy(true)
    setError(null)
    try {
      const input: MaintenanceReminderInput = {
        title: title.trim(),
        notes: notes.trim() || undefined,
        dueDate: dueDate || undefined,
        relatedRecordIds: relatedRecordId ? [relatedRecordId] : [],
        source: 'user',
      }
      if (editingReminderId) await onUpdate(editingReminderId, input)
      else await onCreate(input)
      resetForm()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="maintenance-reminders-title" onMouseDown={onClose}>
      <div className="modal remindersModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <div className="modalTitle" id="maintenance-reminders-title">Maintenance Reminders</div>
            <div className="modalSub">Create in-app reminders for garden and record maintenance.</div>
          </div>
          <button className="btn ghost compact" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="modalBody remindersBody" ref={modalBodyRef}>
          <section className="reminderComposer">
            <div className="subTitle">{editingReminderId ? 'Edit Reminder' : 'New Reminder'}</div>
            <div className="grid2">
              <label className="field gridSpanFull">
                <div className="label">Title</div>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Check storage notes for overwintered tubers" />
              </label>
              <label className="field">
                <div className="label">Due date</div>
                <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
              <label className="field">
                <div className="label">Related record</div>
                <select className="select" value={relatedRecordId} onChange={(e) => setRelatedRecordId(e.target.value)}>
                  <option value="">None</option>
                  {relatedRecordOptions.map((record) => <option key={record.id} value={record.id}>{recordLabel(record)}</option>)}
                </select>
              </label>
              <label className="field gridSpanFull">
                <div className="label">Notes</div>
                <textarea className="textarea" value={notes} rows={3} onChange={(e) => setNotes(e.target.value)} placeholder="Optional reminder details" />
              </label>
            </div>
            <div className="rowActions reminderComposerActions">
              <button className="btn" type="button" disabled={busy || !title.trim()} onClick={() => void submit()}>{busy ? 'Saving...' : editingReminderId ? 'Update Reminder' : 'Save Reminder'}</button>
              {editingReminderId ? <button className="btn ghost" type="button" disabled={busy} onClick={resetForm}>Cancel Edit</button> : null}
              {error ? <div className="error inlineError">{error}</div> : null}
            </div>
          </section>

          <section className="remindersListSection">
            <div className="remindersListHeader">
              <div className="subTitle">Saved Reminders</div>
              <button className="btn ghost compact" type="button" onClick={() => setShowCompleted((show) => !show)}>
                {showCompleted ? 'Hide Completed' : `Show Completed (${completedReminders.length})`}
              </button>
            </div>
            {reminders.length === 0 ? <div className="muted emptyReminders">No reminders yet.</div> : null}
            {renderReminderSection('Due', dueReminders, 'No due reminders.')}
            {renderReminderSection('To Do', todoReminders, 'No to-do reminders.')}
            {showCompleted ? renderReminderSection('Completed', completedReminders, 'No completed reminders.') : null}
          </section>
        </div>
      </div>
    </div>
  )
}
