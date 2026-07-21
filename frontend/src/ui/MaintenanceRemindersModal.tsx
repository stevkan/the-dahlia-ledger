import { useEffect, useRef, useState } from 'react'
import type { DahliaRecord, GardenMember, MaintenanceReminder, MaintenanceReminderInput } from '../types'

type RelatedRecordSeasonFilter = 'current' | 'all'
type ReminderView = 'list' | 'form'

type ReminderDropdownOption = {
  value: string
  label: string
}

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

const REMINDER_FIELD_HINTS = {
  title: 'Short reminder name shown in the reminder list.',
  assignedUser: 'Choose who should handle this reminder, or leave it unassigned.',
  dueDate: 'Date when this reminder should become due.',
  visibility: 'Private reminders show only to the assignee; garden reminders are shared.',
  relatedRecord: 'Optionally link this reminder to a specific dahlia record.',
  highPriority: 'Mark important reminders so they appear ahead of normal reminders.',
  notes: 'Optional details, instructions, or context for the reminder.',
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
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

  function hideHint() {
    setVisible(false)
  }

  return (
    <div className="label fieldLabel">
      <span>{label}</span>
      {hint ? (
        <button
          className={`helpIcon${visible ? ' show' : ''}`}
          type="button"
          aria-label={`${label} hint`}
          onMouseEnter={showHint}
          onMouseLeave={hideHint}
          onFocus={showHint}
          onBlur={hideHint}
          onClick={showHint}
        >
          ?
          {visible ? <span className="helpTooltip" role="tooltip">{hint}</span> : null}
        </button>
      ) : null}
    </div>
  )
}

function ReminderDropdown({ label, value, options, onChange }: { label: string; value: string; options: ReminderDropdownOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  function selectOption(optionValue: string) {
    onChange(optionValue)
    setOpen(false)
  }

  return (
    <div className="reminderDropdown" onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
    }}>
      <button
        className="reminderDropdownButton select"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >
        {selectedOption?.label ?? ''}
      </button>
      {open ? (
        <div className="reminderDropdownOptions" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              className="reminderDropdownOption"
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectOption(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
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

function currentSeasonYear(records: DahliaRecord[]) {
  return records.reduce((latest, record) => Math.max(latest, record.seasonYearStart || 0), 0)
}

function recordMatchesSearch(record: DahliaRecord, search: string) {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  if (!normalizedSearch) return true

  return [record.flowerName, record.gardenLocation, String(record.seasonYearStart)]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase().includes(normalizedSearch))
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
  const [relatedRecordSearch, setRelatedRecordSearch] = useState('')
  const [relatedRecordSeasonFilter, setRelatedRecordSeasonFilter] = useState<RelatedRecordSeasonFilter>('current')
  const [relatedRecordSearchFocused, setRelatedRecordSearchFocused] = useState(false)
  const [assignedToUserId, setAssignedToUserId] = useState('')
  const [visibility, setVisibility] = useState<MaintenanceReminder['visibility']>('garden')
  const [priority, setPriority] = useState<MaintenanceReminder['priority']>('normal')
  const [view, setView] = useState<ReminderView>('list')
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null)
  const [expandedReminderIds, setExpandedReminderIds] = useState<Set<string>>(() => new Set())
  const [collapsedReminderSections, setCollapsedReminderSections] = useState<Set<string>>(() => new Set(['Completed']))
  const [confirmingDeleteReminderId, setConfirmingDeleteReminderId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formSnapshot, setFormSnapshot] = useState('')

  const visibleReminders = reminders.filter((reminder) => canCurrentUserViewReminder(reminder, currentUserId))
  const dueReminders = sortActiveReminders(visibleReminders.filter((reminder) => isDue(reminder)))
  const todoReminders = sortActiveReminders(visibleReminders.filter((reminder) => !reminder.completedAt && !isDue(reminder)))
  const completedReminders = sortRemindersByTimestampDesc(visibleReminders.filter((reminder) => reminder.completedAt))
  const selectedRelatedRecord = records.find((record) => record.id === relatedRecordId)
  const currentSeason = currentSeasonYear(records)
  const relatedRecordOptions = sortRelatedRecords(records.filter((record) => {
    if (relatedRecordSeasonFilter === 'current' && currentSeason && record.seasonYearStart !== currentSeason) return false
    return recordMatchesSearch(record, relatedRecordSearch)
  })).slice(0, 8)
  const assigneeOptions = [{ value: '', label: 'Unassigned' }, ...members.map((member) => ({ value: member.userId, label: member.displayName || member.email || member.userId }))]
  const showRelatedRecordOptions = relatedRecordSearchFocused && relatedRecordOptions.length > 0
  const canSaveReminder = Boolean(title.trim() && dueDate && visibility)
  const formHasChanges = view === 'form' && JSON.stringify({ title, notes, dueDate, relatedRecordId, relatedRecordSearch, assignedToUserId, visibility, priority }) !== formSnapshot

  function selectRelatedRecord(record: DahliaRecord) {
    setRelatedRecordId(record.id)
    setRelatedRecordSearch(recordLabel(record))
    setRelatedRecordSearchFocused(false)
  }

  function clearRelatedRecord() {
    setRelatedRecordId('')
    setRelatedRecordSearch('')
    setRelatedRecordSearchFocused(true)
  }

  function updateRelatedRecordSearch(value: string) {
    setRelatedRecordSearch(value)
    setRelatedRecordSearchFocused(true)
    if (!selectedRelatedRecord || value !== recordLabel(selectedRelatedRecord)) setRelatedRecordId('')
  }

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
    if (editingReminderId === id) returnToList()
    else setConfirmingDeleteReminderId(null)
  }

  function resetForm() {
    setTitle('')
    setNotes('')
    setDueDate('')
    setRelatedRecordId('')
    setRelatedRecordSearch('')
    setAssignedToUserId('')
    setVisibility('garden')
    setPriority('normal')
    setEditingReminderId(null)
    setError(null)
  }

  function openCreateForm() {
    setConfirmingDeleteReminderId(null)
    resetForm()
    setFormSnapshot(JSON.stringify({ title: '', notes: '', dueDate: '', relatedRecordId: '', relatedRecordSearch: '', assignedToUserId: '', visibility: 'garden', priority: 'normal' }))
    setView('form')
  }

  function returnToList() {
    resetForm()
    setConfirmingDeleteReminderId(null)
    setView('list')
  }

  function editReminder(reminder: MaintenanceReminder) {
    const relatedRecord = records.find((record) => record.id === reminder.relatedRecordIds?.[0])
    setConfirmingDeleteReminderId(null)
    const next = {
      title: reminder.title,
      notes: reminder.notes ?? '',
      dueDate: reminder.dueDate ?? '',
      relatedRecordId: relatedRecord?.id ?? '',
      relatedRecordSearch: relatedRecord ? recordLabel(relatedRecord) : '',
      assignedToUserId: reminder.assignedToUserId ?? '',
      visibility: reminder.visibility ?? 'garden',
      priority: reminder.priority ?? 'normal',
    }
    setTitle(next.title)
    setNotes(next.notes)
    setDueDate(next.dueDate)
    setRelatedRecordId(next.relatedRecordId)
    setRelatedRecordSearch(next.relatedRecordSearch)
    setAssignedToUserId(next.assignedToUserId)
    setVisibility(next.visibility)
    setPriority(next.priority)
    setEditingReminderId(reminder.id)
    setFormSnapshot(JSON.stringify(next))
    setView('form')
    setError(null)
    modalBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelFormEdits() {
    if (!formHasChanges) return
    const editingReminder = editingReminderId ? reminders.find((reminder) => reminder.id === editingReminderId) : null
    if (editingReminder) editReminder(editingReminder)
    else openCreateForm()
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
      setConfirmingDeleteReminderId(null)
      setView('list')
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
          <div className="rowActions modalHeaderActions">
            {view === 'list' ? <button className="btn" type="button" onClick={openCreateForm}>Add Reminder</button> : null}
            <button className="btn ghost compact" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="modalBody remindersBody" ref={modalBodyRef}>
          {view === 'form' ? (
            <section className="reminderComposer">
              <div className="subTitle">{editingReminderId ? 'Edit Reminder' : 'New Reminder'}</div>
              <div className="grid2">
                <label className="field gridSpanFull">
                  <FieldLabel label="Title" hint={REMINDER_FIELD_HINTS.title} />
                  <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Check storage notes for overwintered tubers" />
                </label>
                <label className="field">
                  <FieldLabel label="Assigned user ID" hint={REMINDER_FIELD_HINTS.assignedUser} />
                  {members.length ? (
                    <ReminderDropdown label="Assigned user ID" value={assignedToUserId} options={assigneeOptions} onChange={setAssignedToUserId} />
                  ) : (
                    <input className="input" value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)} placeholder="Optional user ID" />
                  )}
                </label>
                <label className="field">
                  <FieldLabel label="Due date" hint={REMINDER_FIELD_HINTS.dueDate} />
                  <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </label>
                <label className="field">
                  <FieldLabel label="Visibility" hint={REMINDER_FIELD_HINTS.visibility} />
                  <ReminderDropdown label="Visibility" value={visibility ?? 'garden'} options={[{ value: 'private', label: 'Private' }, { value: 'garden', label: 'Garden' }]} onChange={(value) => setVisibility(value as MaintenanceReminder['visibility'])} />
                </label>
                <div className="field relatedRecordField">
                  <div className="relatedRecordHeader">
                    <FieldLabel label="Related record" hint={REMINDER_FIELD_HINTS.relatedRecord} />
                    <div className="seasonFilterControl" aria-label="Season filter">
                      <span className="seasonFilterLabel">Season</span>
                      <button
                        className={`switchToggle seasonFilterSwitch${relatedRecordSeasonFilter === 'all' ? ' on' : ''}`}
                        type="button"
                        role="switch"
                        aria-checked={relatedRecordSeasonFilter === 'all'}
                        aria-label={`Season filter: ${relatedRecordSeasonFilter === 'current' ? 'Current' : 'All'}`}
                        onClick={() => setRelatedRecordSeasonFilter((current) => current === 'current' ? 'all' : 'current')}
                      >
                        <span className="switchTrack">
                          <span className="switchLabel">{relatedRecordSeasonFilter === 'current' ? 'Current' : 'All'}</span>
                          <span className="switchThumb" />
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="relatedRecordSearchWrap">
                    <input
                      className="input"
                      value={relatedRecordSearch}
                      onChange={(e) => updateRelatedRecordSearch(e.target.value)}
                      onFocus={() => setRelatedRecordSearchFocused(true)}
                      onBlur={() => window.setTimeout(() => setRelatedRecordSearchFocused(false), 120)}
                      placeholder={currentSeason ? `Search ${currentSeason} records` : 'Search records'}
                      role="combobox"
                      aria-expanded={showRelatedRecordOptions}
                      aria-autocomplete="list"
                    />
                    {relatedRecordId ? <button className="relatedRecordClear" type="button" aria-label="Clear related record" onMouseDown={(e) => e.preventDefault()} onClick={clearRelatedRecord}>×</button> : null}
                    {showRelatedRecordOptions ? (
                      <div className="relatedRecordOptions" role="listbox">
                        {relatedRecordOptions.map((record) => (
                          <button className="relatedRecordOption" key={record.id} type="button" role="option" aria-selected={record.id === relatedRecordId} onMouseDown={(e) => e.preventDefault()} onClick={() => selectRelatedRecord(record)}>
                            <span className="relatedRecordOptionName">{record.flowerName}</span>
                            <span className="relatedRecordOptionMeta">{record.seasonYearStart}{record.gardenLocation ? ` - ${record.gardenLocation}` : ''}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="field reminderPriorityOption">
                  <FieldLabel label="Priority" hint={REMINDER_FIELD_HINTS.highPriority} />
                  <label className="radioOption">
                    <input type="checkbox" checked={priority === 'high'} onChange={(e) => setPriority(e.target.checked ? 'high' : 'normal')} />
                    <span>High priority</span>
                  </label>
                </div>
                <label className="field gridSpanFull">
                  <FieldLabel label="Notes" hint={REMINDER_FIELD_HINTS.notes} />
                  <textarea className="textarea" value={notes} rows={3} onChange={(e) => setNotes(e.target.value)} placeholder="Optional reminder details" />
                </label>
              </div>
              <div className="rowActions reminderComposerActions">
                <button className="btn" type="button" disabled={busy || !canSaveReminder} onClick={() => void submit()}>{busy ? 'Saving...' : editingReminderId ? 'Update Reminder' : 'Save Reminder'}</button>
                <button className="btn ghost" type="button" disabled={busy || !formHasChanges} onClick={cancelFormEdits}>Cancel</button>
                {error ? <div className="error inlineError">{error}</div> : null}
              </div>
            </section>
          ) : (
          <section className="remindersListSection">
            <div className="remindersListHeader">
              <div className="subTitle">Saved Reminders</div>
            </div>
            {visibleReminders.length === 0 ? <div className="muted emptyReminders">No reminders yet.</div> : null}
            {renderReminderSection('Due', dueReminders, 'No due reminders.', true)}
            {renderReminderSection('To Do', todoReminders, 'No to-do reminders.', true)}
            {renderReminderSection('Completed', completedReminders, 'No completed reminders.', true)}
          </section>
          )}
        </div>
      </div>
    </div>
  )
}
