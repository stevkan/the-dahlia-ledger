import { useRef, useState } from 'react'
import type { DahliaRecord, GardenMember, MaintenanceReminder, MaintenanceReminderInput } from '../types'

type Props = {
  reminders: MaintenanceReminder[]
  records: DahliaRecord[]
  members?: GardenMember[]
  currentUserId?: string
  onClose: () => void
  onCreate: (input: MaintenanceReminderInput) => Promise<void>
  onUpdate: (id: string, input: MaintenanceReminderInput) => Promise<void>
  onComplete: (id: string) => Promise<void>
  onReopen: (id: string) => Promise<void>
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

function sortActiveReminders(reminders: MaintenanceReminder[]) {
  return [...reminders].sort((a, b) => {
    const priority = Number(b.priority === 'high') - Number(a.priority === 'high')
    if (priority !== 0) return priority

    return reminderTimestamp(b) - reminderTimestamp(a)
  })
}

function canCurrentUserViewReminder(reminder: MaintenanceReminder, currentUserId?: string) {
  const visibility = reminder.visibility ?? 'garden'
  if (visibility === 'garden') return true

  return Boolean(currentUserId && reminder.assignedToUserId === currentUserId)
}

function assigneeLabel(reminder: MaintenanceReminder, members: GardenMember[]) {
  if (!reminder.assignedToUserId) return 'Unassigned'

  const member = members.find((member) => member.userId === reminder.assignedToUserId)
  return member?.displayName || member?.email || reminder.assignedToUserId
}

export function MaintenanceRemindersModal({ reminders, records, members = [], currentUserId, onClose, onCreate, onUpdate, onComplete, onReopen, onDelete }: Props) {
  const modalBodyRef = useRef<HTMLDivElement | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [relatedRecordId, setRelatedRecordId] = useState('')
  const [assignedToUserId, setAssignedToUserId] = useState('')
  const [visibility, setVisibility] = useState<MaintenanceReminder['visibility']>('garden')
  const [priority, setPriority] = useState<MaintenanceReminder['priority']>('normal')
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null)
  const [expandedReminderIds, setExpandedReminderIds] = useState<Set<string>>(() => new Set())
  const [collapsedReminderSections, setCollapsedReminderSections] = useState<Set<string>>(() => new Set(['Completed']))
  const [confirmingDeleteReminderId, setConfirmingDeleteReminderId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visibleReminders = reminders.filter((reminder) => canCurrentUserViewReminder(reminder, currentUserId))
  const dueReminders = sortActiveReminders(visibleReminders.filter((reminder) => isDue(reminder)))
  const todoReminders = sortActiveReminders(visibleReminders.filter((reminder) => !reminder.completedAt && !isDue(reminder)))
  const completedReminders = sortRemindersByTimestampDesc(visibleReminders.filter((reminder) => reminder.completedAt))
  const relatedRecordOptions = sortRelatedRecords(records)
  const canSaveReminder = Boolean(title.trim() && dueDate && visibility)

  function toggleExpanded(id: string) {
    setExpandedReminderIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSectionCollapsed(section: string) {
    setCollapsedReminderSections((current) => {
      const next = new Set(current)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  async function deleteReminder(id: string) {
    if (confirmingDeleteReminderId !== id) {
      setConfirmingDeleteReminderId(id)
      return
    }

    await onDelete(id)
    if (editingReminderId === id) resetForm()
    else setConfirmingDeleteReminderId(null)
  }

  function resetForm() {
    setTitle('')
    setNotes('')
    setDueDate('')
    setRelatedRecordId('')
    setAssignedToUserId('')
    setVisibility('garden')
    setPriority('normal')
    setEditingReminderId(null)
    setError(null)
  }

  function editReminder(reminder: MaintenanceReminder) {
    setConfirmingDeleteReminderId(null)
    setTitle(reminder.title)
    setNotes(reminder.notes ?? '')
    setDueDate(reminder.dueDate ?? '')
    setRelatedRecordId(reminder.relatedRecordIds?.[0] ?? '')
    setAssignedToUserId(reminder.assignedToUserId ?? '')
    setVisibility(reminder.visibility ?? 'garden')
    setPriority(reminder.priority ?? 'normal')
    setEditingReminderId(reminder.id)
    setError(null)
    modalBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function renderReminder(reminder: MaintenanceReminder) {
    const expanded = expandedReminderIds.has(reminder.id)
    const confirmingDelete = confirmingDeleteReminderId === reminder.id
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
              {reminder.priority === 'high' ? <span className="reminderBadge priority">High Priority</span> : null}
              {isDue(reminder) ? <span className="reminderBadge">Due</span> : null}
              {reminder.completedAt ? <span className="reminderBadge complete">Complete</span> : null}
            </span>
            <span className="reminderMeta">
              {reminder.dueDate ? <span>Due {reminder.dueDate}</span> : <span>No due date</span>}
              {reminder.source === 'agent' ? <span>Agent suggested</span> : null}
              <span>Assigned to {assigneeLabel(reminder, members)}</span>
              {reminder.visibility ? <span>{reminder.visibility === 'private' ? 'Private' : 'Garden'}</span> : null}
            </span>
          </span>
        </div>
        {expanded ? (
          <div className="reminderCardDetails">
            {reminder.notes ? <div className="reminderNotes">{reminder.notes}</div> : <div className="reminderNotes muted">No notes.</div>}
            {relatedRecords.length ? <div className="reminderRecords">Records: {relatedRecords.map(recordLabel).join(', ')}</div> : null}
            <div className="reminderActions">
              {reminder.completedAt ? <button className="btn ghost compact" type="button" onClick={() => void onReopen(reminder.id)}>Reopen</button> : <button className="btn ghost compact" type="button" onClick={() => void onComplete(reminder.id)}>Complete</button>}
              <button className="btn ghost compact" type="button" onClick={() => void deleteReminder(reminder.id)}>{confirmingDelete ? 'Confirm Delete' : 'Delete'}</button>
              {confirmingDelete ? <button className="btn ghost compact" type="button" onClick={() => setConfirmingDeleteReminderId(null)}>Cancel</button> : null}
            </div>
          </div>
        ) : null}
      </article>
    )
  }

  function renderReminderSection(title: string, sectionReminders: MaintenanceReminder[], emptyText: string, collapsible = false) {
    const collapsed = collapsible && (sectionReminders.length === 0 || collapsedReminderSections.has(title))

    return (
      <div className="reminderSectionGroup">
        <div className="reminderSectionHeader">
          <div className="subTitle">{`${title} (${sectionReminders.length})`}</div>
          {collapsible ? (
            <button className="btn ghost compact" type="button" disabled={sectionReminders.length === 0} aria-expanded={!collapsed} onClick={() => toggleSectionCollapsed(title)}>
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
          ) : null}
        </div>
        {collapsed ? null : (
          <>
            {sectionReminders.length === 0 ? <div className="muted emptyReminders">{emptyText}</div> : null}
            <div className="remindersList">
              {sectionReminders.map(renderReminder)}
            </div>
          </>
        )}
      </div>
    )
  }

  async function submit() {
    if (!canSaveReminder || busy) return

    setBusy(true)
    setError(null)
    try {
      const input: MaintenanceReminderInput = {
        title: title.trim(),
        notes: notes.trim() || undefined,
        dueDate: dueDate || undefined,
        relatedRecordIds: relatedRecordId ? [relatedRecordId] : [],
        assignedToUserId: assignedToUserId.trim() || undefined,
        visibility: visibility ?? 'garden',
        priority: priority ?? 'normal',
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
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="maintenance-reminders-title">
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
                <div className="label">Assigned user ID</div>
                {members.length ? (
                  <select className="select" value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)}>
                    <option value="">Unassigned</option>
                    {members.map((member) => <option key={member.id} value={member.userId}>{member.displayName || member.email || member.userId}</option>)}
                  </select>
                ) : (
                  <input className="input" value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)} placeholder="Optional user ID" />
                )}
              </label>
              <label className="field">
                <div className="label">Due date</div>
                <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
              <label className="field">
                <div className="label">Visibility</div>
                <select className="select" value={visibility ?? 'garden'} onChange={(e) => setVisibility(e.target.value as MaintenanceReminder['visibility'])}>
                  <option value="private">Private</option>
                  <option value="garden">Garden</option>
                </select>
              </label>
              <label className="field">
                <div className="label">Related record</div>
                <select className="select" value={relatedRecordId} onChange={(e) => setRelatedRecordId(e.target.value)}>
                  <option value="">None</option>
                  {relatedRecordOptions.map((record) => <option key={record.id} value={record.id}>{recordLabel(record)}</option>)}
                </select>
              </label>
              <label className="radioOption reminderPriorityOption">
                <input type="checkbox" checked={priority === 'high'} onChange={(e) => setPriority(e.target.checked ? 'high' : 'normal')} />
                <span>High priority</span>
              </label>
              <label className="field gridSpanFull">
                <div className="label">Notes</div>
                <textarea className="textarea" value={notes} rows={3} onChange={(e) => setNotes(e.target.value)} placeholder="Optional reminder details" />
              </label>
            </div>
            <div className="rowActions reminderComposerActions">
              <button className="btn" type="button" disabled={busy || !canSaveReminder} onClick={() => void submit()}>{busy ? 'Saving...' : editingReminderId ? 'Update Reminder' : 'Save Reminder'}</button>
              {editingReminderId ? <button className="btn ghost" type="button" disabled={busy} onClick={resetForm}>Cancel Edit</button> : null}
              {error ? <div className="error inlineError">{error}</div> : null}
            </div>
          </section>

          <section className="remindersListSection">
            <div className="remindersListHeader">
              <div className="subTitle">Saved Reminders</div>
            </div>
            {visibleReminders.length === 0 ? <div className="muted emptyReminders">No reminders yet.</div> : null}
            {renderReminderSection('Due', dueReminders, 'No due reminders.', true)}
            {renderReminderSection('To Do', todoReminders, 'No to-do reminders.', true)}
            {renderReminderSection('Completed', completedReminders, 'No completed reminders.', true)}
          </section>
        </div>
      </div>
    </div>
  )
}
