import { useEffect, useMemo, useRef, useState } from 'react'
import type { Company, CompanyInput, DahliaRecord } from '../types'

type CompanyDeleteConflict = {
  error?: string
  message?: string
  usage?: Company['usage']
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

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <div className="label">{label}</div>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <div className="label">{label}</div>
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

function toInput(form: typeof EMPTY_FORM): CompanyInput {
  return {
    name: form.name,
    website: form.website || undefined,
    email: form.email || undefined,
    phone: form.phone || undefined,
    notes: form.notes || undefined,
  }
}

export function CompaniesModal({
  companies,
  usageRefreshing,
  onClose,
  onCreateCompany,
  onUpdateCompany,
  onDeleteCompany,
  onOpenRecord,
  onOpenOrder,
}: {
  companies: Company[]
  usageRefreshing: boolean
  onClose: () => void
  onCreateCompany: (input: CompanyInput) => Promise<Company>
  onUpdateCompany: (id: string, input: CompanyInput) => Promise<Company>
  onDeleteCompany: (id: string) => Promise<void>
  onOpenRecord: (record: Pick<DahliaRecord, 'id'>) => void
  onOpenOrder: (orderId: string) => void
}) {
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConflict, setDeleteConflict] = useState<CompanyDeleteConflict | null>(null)

  const selectedCompany = useMemo(() => companies.find((company) => company.id === selectedCompanyId) ?? null, [companies, selectedCompanyId])
  const canSave = form.name.trim().length > 0
  const selectedCompanyUsage = selectedCompany?.usage

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
      phone: company.phone ?? '',
      notes: company.notes ?? '',
    })
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
          phone: company.phone ?? '',
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
          {companies.length ? companies.map((company) => (
            <button
              key={company.id}
              className={`companyCard${selectedCompany?.id === company.id ? ' selected' : ''}`}
              type="button"
              onClick={() => editCompany(company)}
            >
              <span>{company.name}</span>
              <span>{company.email || company.website || company.phone || 'No contact details'}</span>
            </button>
          )) : <div className="muted">No companies saved yet.</div>}
        </div>

        <div className="companyForm">
          <div className="subTitle">{selectedCompanyId ? 'Edit Company' : 'New Company'}</div>
          <div className="grid2">
            <Field label="Company Name" value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
            <Field label="Website" value={form.website} onChange={(v) => setForm((p) => ({ ...p, website: v }))} />
            <Field label="Email" value={form.email} onChange={(v) => setForm((p) => ({ ...p, email: v }))} />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm((p) => ({ ...p, phone: v }))} />
          </div>
          <TextArea label="Notes" value={form.notes} onChange={(v) => setForm((p) => ({ ...p, notes: v }))} />
          {error ? <div className="error inlineError companyError">{error}</div> : null}
          {renderCompanyUsage()}
          <div className="rowActions companyActions">
            {selectedCompanyId ? <button className="btn ghost" type="button" onClick={clearForm}>Cancel Edit</button> : null}
            <button className="btn" type="button" disabled={!canSave || saving} onClick={() => void saveCompany()}>
              {saving ? 'Saving...' : selectedCompanyId ? 'Update Company' : 'Save Company'}
            </button>
            {selectedCompanyId ? (
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
