import { useEffect, useMemo, useRef, useState } from 'react'
import type { Company, CompanyInput, DahliaRecord, KnownUser } from '../types'

type CompanyDeleteConflict = {
  error?: string
  message?: string
  usage?: Company['usage']
}

const COMPANY_FIELD_HINTS = {
  name: 'Name used for this vendor in invoices and records.',
  website: 'Website for ordering or reference.',
  email: 'Contact email for orders or follow-up.',
  phone: 'Contact phone number for this company.',
  notes: 'Optional account, ordering, or contact notes.',
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="modalOverlay">
      <div className="modal">
        {children}
      </div>
    </div>
  )
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
          {visible ? <span className="helpTooltip companyFieldTooltip" role="tooltip">{hint}</span> : null}
        </button>
      ) : null}
    </div>
  )
}

function Field({ label, hint, value, onChange, type = 'text', inputMode, pattern, placeholder }: { label: string; hint?: string; value: string; onChange: (v: string) => void; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; pattern?: string; placeholder?: string }) {
  return (
    <label className="field">
      <FieldLabel label={label} hint={hint} />
      <input className="input" type={type} inputMode={inputMode} pattern={pattern} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function TextArea({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <FieldLabel label={label} hint={hint} />
      <textarea className="textarea" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

const EMPTY_FORM = {
  name: '',
  website: '',
  email: '',
  phone: '',
  notes: '',
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function toInput(form: typeof EMPTY_FORM): CompanyInput {
  return {
    name: form.name,
    website: form.website || undefined,
    email: form.email.trim() || undefined,
    phone: form.phone || undefined,
    notes: form.notes || undefined,
  }
}

export function CompaniesModal({
  companies,
  knownUsers,
  isGlobalAdmin,
  usageRefreshing,
  onClose,
  onCreateCompany,
  onUpdateCompany,
  onDeleteCompany,
  onReassignCompanies,
  onOpenRecord,
  onOpenOrder,
}: {
  companies: Company[]
  knownUsers: KnownUser[]
  isGlobalAdmin: boolean
  usageRefreshing: boolean
  onClose: () => void
  onCreateCompany: (input: CompanyInput) => Promise<Company>
  onUpdateCompany: (id: string, input: CompanyInput) => Promise<Company>
  onDeleteCompany: (id: string) => Promise<void>
  onReassignCompanies: (companyIds: string[], ownerUserId: string) => Promise<void>
  onOpenRecord: (record: Pick<DahliaRecord, 'id'>) => void
  onOpenOrder: (orderId: string) => void
}) {
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([])
  const [reassignOwnerUserId, setReassignOwnerUserId] = useState('')
  const [reassigning, setReassigning] = useState(false)
  const [reassignMessage, setReassignMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteConflict, setDeleteConflict] = useState<CompanyDeleteConflict | null>(null)

  const selectedCompany = useMemo(() => companies.find((company) => company.id === selectedCompanyId) ?? null, [companies, selectedCompanyId])
  const hasValidEmail = !form.email.trim() || EMAIL_PATTERN.test(form.email.trim())
  const canSave = form.name.trim().length > 0 && hasValidEmail
  const selectedCompanyUsage = selectedCompany?.usage
  const canDeleteSelectedCompany = selectedCompany?.canDelete !== false
  const canReassign = selectedCompanyIds.length > 0 && reassignOwnerUserId && !reassigning

  useEffect(() => {
    if (!deleteArmed) return

    function clearOnOutsidePointer(event: PointerEvent) {
      if (!deleteButtonRef.current?.contains(event.target as Node)) {
        setDeleteArmed(false)
      }
    }

    document.addEventListener('pointerdown', clearOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', clearOnOutsidePointer)
  }, [deleteArmed])

  function clearForm() {
    setSelectedCompanyId('')
    setForm(EMPTY_FORM)
    setDeleteArmed(false)
    setDeleteConflict(null)
  }

  function editCompany(company: Company) {
    setSelectedCompanyId(company.id)
    setDeleteArmed(false)
    setDeleteConflict(null)
    setError(null)
    setForm({
      name: company.name ?? '',
      website: company.website ?? '',
      email: company.email ?? '',
      phone: formatPhone(company.phone ?? ''),
      notes: company.notes ?? '',
    })
  }

  function toggleSelectedCompany(id: string) {
    setReassignMessage(null)
    setSelectedCompanyIds((current) => current.includes(id) ? current.filter((companyId) => companyId !== id) : [...current, id])
  }

  function toggleAllCompanies() {
    setReassignMessage(null)
    setSelectedCompanyIds((current) => current.length === companies.length ? [] : companies.map((company) => company.id))
  }

  async function reassignSelectedCompanies() {
    if (!canReassign) return

    setReassigning(true)
    setError(null)
    setReassignMessage(null)
    try {
      await onReassignCompanies(selectedCompanyIds, reassignOwnerUserId)
      setReassignMessage(`Reassigned ${selectedCompanyIds.length} compan${selectedCompanyIds.length === 1 ? 'y' : 'ies'}.`)
      setSelectedCompanyIds([])
      setReassignOwnerUserId('')
      clearForm()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setReassigning(false)
    }
  }

  async function saveCompany() {
    setSaving(true)
    setError(null)
    try {
      if (selectedCompanyId) {
        const company = await onUpdateCompany(selectedCompanyId, toInput(form))
        setForm({
          name: company.name ?? '',
          website: company.website ?? '',
          email: company.email ?? '',
          phone: formatPhone(company.phone ?? ''),
          notes: company.notes ?? '',
        })
        setDeleteArmed(false)
        setDeleteConflict(null)
      } else {
        await onCreateCompany(toInput(form))
        clearForm()
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteSelectedCompany() {
    if (!selectedCompanyId) return
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }

    setDeleting(true)
    setError(null)
    setDeleteConflict(null)
    try {
      await onDeleteCompany(selectedCompanyId)
      clearForm()
    } catch (e: any) {
      if (e?.details?.error === 'company_in_use') {
        setDeleteConflict(e.details)
        setError(null)
        return
      }
      setError(e?.message ?? String(e))
    } finally {
      setDeleting(false)
    }
  }

  function renderCompanyUsage() {
    if (usageRefreshing && selectedCompanyId) {
      return <div className="error inlineError companyError companyDeleteConflict">Updating list...</div>
    }

    const usage = selectedCompanyUsage ?? deleteConflict?.usage
    if (!usage) return null

    const orders = usage.orders ?? []
    const flowerRecords = [...(usage.flowerRecords ?? [])].sort((a, b) => (a.recordNumber ?? Number.MAX_SAFE_INTEGER) - (b.recordNumber ?? Number.MAX_SAFE_INTEGER))
    if (!orders.length && !flowerRecords.length) return null

    return (
      <div className="error inlineError companyError companyDeleteConflict">
        <div>{deleteConflict?.message ?? 'This company is still in use by the following records.'}</div>
        {orders.length ? (
          <div>
            <div className="companyDependencyTitle">Invoice records</div>
            <ul className="companyDependencyList">
              {orders.map((order) => (
                <li key={order.id}>
                  <button className="labelLink" type="button" onClick={() => onOpenOrder(order.id)}>
                    {order.invoiceNumber ? `#${order.invoiceNumber}` : 'Invoice without number'}
                  </button>
                  {order.orderDate ? ` - ${order.orderDate}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {flowerRecords.length ? (
          <div>
            <div className="companyDependencyTitle">Flower records</div>
            <ul className="companyDependencyList">
              {flowerRecords.map((record) => (
                <li key={record.id}>
                  <button className="labelLink" type="button" onClick={() => onOpenRecord({ id: record.id })}>
                    #{record.recordNumber ?? record.id}
                  </button>
                  {` - ${record.flowerName || 'Unnamed flower'}${record.seasonYearStart ? ` (${record.seasonYearStart})` : ''}`}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    )
  }

  function renderAdminReassignment() {
    if (!isGlobalAdmin) return null

    return (
      <div className="companyAdminPanel">
        <div>
          <div className="subTitle">Admin Ownership</div>
          <div className="muted">Select one or more companies and assign them to a known user.</div>
        </div>
        <label className="field">
          <div className="label">Assign selected companies to</div>
          <select className="select" value={reassignOwnerUserId} onChange={(event) => setReassignOwnerUserId(event.target.value)}>
            <option value="">Choose known user...</option>
            {knownUsers.map((knownUser) => (
              <option key={knownUser.userId} value={knownUser.userId}>{knownUser.displayName || knownUser.email || knownUser.userId}</option>
            ))}
          </select>
        </label>
        <div className="rowActions companyActions">
          <button className="btn ghost" type="button" disabled={!companies.length || reassigning} onClick={toggleAllCompanies}>{selectedCompanyIds.length === companies.length ? 'Clear Selection' : 'Select All'}</button>
          <button className="btn" type="button" disabled={!canReassign} onClick={() => void reassignSelectedCompanies()}>{reassigning ? 'Assigning...' : `Assign ${selectedCompanyIds.length || ''}`.trim()}</button>
        </div>
        {reassignMessage ? <div className="success inlineSuccess companyError">{reassignMessage}</div> : null}
      </div>
    )
  }

  return (
    <Overlay>
      <div className="modalHeader">
        <div>
          <div className="modalTitle">Companies</div>
          <div className="modalSub">Manage company names and contact details used by invoice records.</div>
        </div>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
      <div className="modalBody companiesLayout">
        <div className="companyList">
          <div className="subTitle">Saved Companies</div>
          {renderAdminReassignment()}
          {companies.length ? companies.map((company) => (
            <div key={company.id} className="companyCardRow">
              {isGlobalAdmin ? <input className="companySelectCheckbox" type="checkbox" checked={selectedCompanyIds.includes(company.id)} onChange={() => toggleSelectedCompany(company.id)} aria-label={`Select ${company.name}`} /> : null}
              <button
                className={`companyCard${selectedCompany?.id === company.id ? ' selected' : ''}`}
                type="button"
                onClick={() => editCompany(company)}
              >
                <span>{company.name}</span>
                <span>{company.email || company.website || company.phone || 'No contact details'}</span>
              </button>
            </div>
          )) : <div className="muted">No companies saved yet.</div>}
        </div>

        <div className="companyForm">
          <div className="subTitle">{selectedCompanyId ? 'Edit Company' : 'New Company'}</div>
          <div className="grid2">
            <Field label="Company Name" hint={COMPANY_FIELD_HINTS.name} value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
            <Field label="Website" hint={COMPANY_FIELD_HINTS.website} value={form.website} onChange={(v) => setForm((p) => ({ ...p, website: v }))} />
            <Field label="Email" hint={COMPANY_FIELD_HINTS.email} type="email" value={form.email} onChange={(v) => setForm((p) => ({ ...p, email: v }))} />
            <Field label="Phone" hint={COMPANY_FIELD_HINTS.phone} type="tel" inputMode="numeric" pattern="\(\d{3}\) \d{3}-\d{4}" placeholder="(000) 000-0000" value={form.phone} onChange={(v) => setForm((p) => ({ ...p, phone: formatPhone(v) }))} />
          </div>
          <TextArea label="Notes" hint={COMPANY_FIELD_HINTS.notes} value={form.notes} onChange={(v) => setForm((p) => ({ ...p, notes: v }))} />
          {!hasValidEmail ? <div className="error inlineError companyError">Enter a valid email address.</div> : null}
          {error ? <div className="error inlineError companyError">{error}</div> : null}
          {selectedCompanyId && !canDeleteSelectedCompany ? <div className="muted companyError">Shared company entries can be edited here, but only the company owner or a joint garden owner can delete them.</div> : null}
          {renderCompanyUsage()}
          <div className="rowActions companyActions">
            {selectedCompanyId ? <button className="btn ghost" type="button" onClick={clearForm}>Cancel Edit</button> : null}
            <button className="btn" type="button" disabled={!canSave || saving} onClick={() => void saveCompany()}>
              {saving ? 'Saving...' : selectedCompanyId ? 'Update Company' : 'Save Company'}
            </button>
            {selectedCompanyId && canDeleteSelectedCompany ? (
              <button ref={deleteButtonRef} className="btn danger companyDeleteButton" type="button" disabled={deleting || saving} onClick={() => void deleteSelectedCompany()}>
                {deleting ? 'Deleting...' : deleteArmed ? 'Confirm Delete' : 'Delete Company'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
