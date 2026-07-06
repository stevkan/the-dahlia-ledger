import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import type { Asset, AssetFile, AssetInput, Company, CompanyInput, Order } from '../types'
import { DropdownField } from './DropdownField'

const CATEGORIES = ['Soil', 'Container', 'Tool', 'Support', 'Label', 'Fertilizer', 'Other']

const ASSET_FIELD_HINTS = {
  asset: 'Enter the supply, tool, container, or other non-flower asset you want to track.',
  category: 'Choose the type of asset so it is easier to browse and group later.',
  quantity: 'Enter how many of this asset were purchased or added.',
  totalCost: 'Enter the total cost for this asset purchase.',
  notes: 'Add optional details about condition, use, storage, or other asset notes.',
  invoiceItems: 'Link this asset to an existing invoice item when it was purchased as part of an invoice record.',
  company: 'Select an existing company for a custom asset purchase entry.',
  purchaseDate: 'Enter the purchase date for a custom asset entry.',
}

type AssetView = { mode: 'list' } | { mode: 'detail'; assetId: string } | { mode: 'form'; assetId?: string }
type ConfirmAction = { type: 'deleteFile'; fileId: string } | { type: 'deleteAsset'; assetId: string } | null

function Overlay({ children, onCancelConfirm }: { children: React.ReactNode; onCancelConfirm: () => void }) {
  return (
    <div className="modalOverlay" onPointerDown={onCancelConfirm}>
      <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
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
          {visible ? <span className="helpTooltip" role="tooltip">{hint}</span> : null}
        </button>
      ) : null}
    </div>
  )
}

function Field({ label, hint, value, onChange, type, onBlur }: { label: string; hint?: string; value: string; onChange: (v: string) => void; type?: 'text' | 'number' | 'date'; onBlur?: () => void }) {
  return (
    <label className="field">
      <FieldLabel label={label} hint={hint} />
      <input className="input" value={value} type={type ?? 'text'} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
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

function FileDeleteButton({ armed, disabled, onDelete }: { armed: boolean; disabled: boolean; onDelete: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!visible) return
    const timeout = window.setTimeout(() => setVisible(false), 3000)
    return () => window.clearTimeout(timeout)
  }, [visible])

  return (
    <button
      className={`fileDeleteButton${visible ? ' show' : ''}${armed ? ' armed' : ''}`}
      type="button"
      disabled={disabled}
      aria-label="Delete document"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onDelete}
    >
      <span className="fileDeleteIcon" aria-hidden="true" />
      {visible ? <span className="helpTooltip fileDeleteTooltip" role="tooltip">Delete document</span> : null}
    </button>
  )
}

function toNumber(value: string) {
  return value.trim() ? Number(value) : undefined
}

function toTitleCase(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/(^|[\s-])\w/g, (match) => match.toUpperCase())
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatUploadDate(iso?: string) {
  if (!iso) return 'Unknown date'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function formatMoney(value?: number) {
  return value === undefined ? '' : `$${value.toFixed(2)}`
}

function formatMoneyInput(value: string) {
  const numericValue = Number(value.replace(/[$,]/g, ''))
  return Number.isFinite(numericValue) ? `$${numericValue.toFixed(2)}` : value
}

function moneyInputValue(value: string) {
  const cleaned = value.replace(/[$,]/g, '')
  if (!/^\d*(\.\d*)?$/.test(cleaned)) return null
  return cleaned
}

function sortAssets(a: Asset, b: Asset) {
  return String(b.purchaseDate ?? b.createdAt ?? '').localeCompare(String(a.purchaseDate ?? a.createdAt ?? ''))
}

export function AssetsModal({
  assets,
  companies,
  orders,
  onClose,
  onCreateCompany,
  onCreateAsset,
  onUpdateAsset,
  onDeleteAsset,
  onUploadInvoice,
  onDeleteInvoiceFile,
}: {
  assets: Asset[]
  companies: Company[]
  orders: Order[]
  onClose: () => void
  onCreateCompany: (input: CompanyInput) => Promise<Company>
  onCreateAsset: (input: AssetInput) => Promise<Asset>
  onUpdateAsset: (id: string, input: AssetInput) => Promise<Asset>
  onDeleteAsset: (id: string) => Promise<void>
  onUploadInvoice: (assetId: string, file: File, sourceType: 'uploaded_pdf' | 'image_converted_to_pdf') => Promise<void>
  onDeleteInvoiceFile: (assetId: string, fileId: string) => Promise<void>
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const [view, setView] = useState<AssetView>({ mode: 'list' })
  const [asset, setAsset] = useState('')
  const [category, setCategory] = useState('')
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [notes, setNotes] = useState('')
  const [linkedOrderItemIds, setLinkedOrderItemIds] = useState<string[]>([])
  const [companyId, setCompanyId] = useState('')
  const [newCompanyName, setNewCompanyName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)

  const sortedAssets = useMemo(() => [...assets].sort(sortAssets), [assets])
  const assetById = useMemo(() => new Map(assets.map((row) => [row.id, row])), [assets])
  const selectedAsset = view.mode === 'detail' ? assetById.get(view.assetId) ?? null : null
  const formAsset = view.mode === 'form' && view.assetId ? assetById.get(view.assetId) ?? null : null
  const canSave = asset.trim()
  const linkedOrderRows = (view.mode === 'form' ? linkedOrderItemIds : selectedAsset?.linkedOrderItemIds ?? []).flatMap((itemId) => {
    for (const order of orders) {
      const item = order.items.find((candidate) => candidate.id === itemId)
      if (item) return [{ order, item }]
    }
    return []
  })

  useEffect(() => {
    if (!selectedAsset && view.mode === 'detail') setView({ mode: 'list' })
  }, [selectedAsset, view.mode])

  function cancelConfirm() {
    setConfirmAction(null)
  }

  function resetForm() {
    setAsset('')
    setCategory('')
    setQuantity('')
    setTotalCost('')
    setPurchaseDate('')
    setNotes('')
    setLinkedOrderItemIds([])
    setCompanyId('')
    setNewCompanyName('')
  }

  function openCreateForm() {
    cancelConfirm()
    setError(null)
    resetForm()
    setView({ mode: 'form' })
  }

  function openEditForm(row: Asset) {
    cancelConfirm()
    setError(null)
    setAsset(row.asset)
    setCategory(row.category ?? '')
    setQuantity(row.quantity === undefined ? '' : String(row.quantity))
    setTotalCost(row.totalCost === undefined ? '' : formatMoneyInput(String(row.totalCost)))
    setPurchaseDate(row.purchaseDate ?? '')
    setNotes(row.notes ?? '')
    setLinkedOrderItemIds(row.linkedOrderItemIds ?? [])
    setCompanyId(row.companyId ?? '')
    setNewCompanyName('')
    setView({ mode: 'form', assetId: row.id })
  }

  function returnFromForm(assetId?: string) {
    resetForm()
    setError(null)
    setView(assetId ? { mode: 'detail', assetId } : { mode: 'list' })
  }

  async function convertImageToPdf(file: File) {
    const imageUrl = URL.createObjectURL(file)
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = imageUrl
      })
      const canvas = document.createElement('canvas')
      const maxWidth = 1200
      const scale = Math.min(1, maxWidth / image.naturalWidth)
      canvas.width = Math.round(image.naturalWidth * scale)
      canvas.height = Math.round(image.naturalHeight * scale)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Unable to prepare invoice image.')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
      const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'landscape' : 'portrait', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height)
      return new File([pdf.output('blob')], `${file.name.replace(/\.[^.]+$/, '')}.pdf`, { type: 'application/pdf' })
    } finally {
      URL.revokeObjectURL(imageUrl)
    }
  }

  async function saveAsset() {
    setSaving(true)
    setError(null)
    cancelConfirm()
    try {
      let nextCompanyId = companyId
      if (!nextCompanyId && newCompanyName.trim()) {
        const company = await onCreateCompany({ name: toTitleCase(newCompanyName) })
        nextCompanyId = company.id
      }
      const input: AssetInput = {
        companyId: nextCompanyId || undefined,
        asset: toTitleCase(asset),
        category: category || undefined,
        quantity: toNumber(quantity),
        totalCost: toNumber(totalCost.replace(/[$,]/g, '')),
        purchaseDate: purchaseDate || undefined,
        notes: notes || undefined,
        linkedOrderItemIds: linkedOrderItemIds.length ? linkedOrderItemIds : undefined,
      }
      const saved = formAsset ? await onUpdateAsset(formAsset.id, input) : await onCreateAsset(input)
      resetForm()
      setView({ mode: 'detail', assetId: saved.id })
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || !selectedAsset) return
    setSaving(true)
    setError(null)
    cancelConfirm()
    try {
      for (const file of Array.from(files)) {
        if (file.type === 'application/pdf') await onUploadInvoice(selectedAsset.id, file, 'uploaded_pdf')
        else if (file.type.startsWith('image/')) await onUploadInvoice(selectedAsset.id, await convertImageToPdf(file), 'image_converted_to_pdf')
        else throw new Error('Only PDF and image invoice files are supported.')
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    }
  }

  async function deleteInvoiceFile(file: AssetFile) {
    if (!selectedAsset) return
    if (confirmAction?.type !== 'deleteFile' || confirmAction.fileId !== file.id) {
      setConfirmAction({ type: 'deleteFile', fileId: file.id })
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onDeleteInvoiceFile(selectedAsset.id, file.id)
      cancelConfirm()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteSelectedAsset() {
    if (!selectedAsset) return
    if (confirmAction?.type !== 'deleteAsset' || confirmAction.assetId !== selectedAsset.id) {
      setConfirmAction({ type: 'deleteAsset', assetId: selectedAsset.id })
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onDeleteAsset(selectedAsset.id)
      cancelConfirm()
      setView({ mode: 'list' })
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  function renderDocuments(row: Asset) {
    return (
      <>
        <div className="invoiceDropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void uploadFiles(e.dataTransfer.files) }}>
          <div>Drop invoice PDFs or images here.</div>
          <div className="rowActions">
            <button className="btn ghost" type="button" onClick={() => fileInputRef.current?.click()}>Upload File</button>
            <button className="btn ghost" type="button" onClick={() => cameraInputRef.current?.click()}>Take Photo</button>
          </div>
          <input ref={fileInputRef} className="fileInput" type="file" multiple accept="application/pdf,image/*" onChange={(e) => void uploadFiles(e.target.files)} />
          <input ref={cameraInputRef} className="fileInput" type="file" accept="image/*" capture="environment" onChange={(e) => void uploadFiles(e.target.files)} />
        </div>
        {confirmAction?.type === 'deleteFile' ? <div className="callout warn invoiceConfirmMessage">Click the highlighted action again to confirm.</div> : null}
        {row.files.length ? (
          <div className="fileList" aria-label="Uploaded asset invoice files">
            {[...row.files].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))).map((file) => (
              <div className="fileCard" key={file.id}>
                <a className="fileCardLink" href={file.fileUrl} target="_blank" rel="noreferrer">
                  <span className="fileBadge">PDF</span>
                  <span className="fileCardBody">
                    <span className="fileCardName">{file.originalFileName}</span>
                    <span className="fileCardMeta">{formatUploadDate(file.createdAt)} · {formatFileSize(file.fileSize)}</span>
                  </span>
                </a>
                <FileDeleteButton armed={confirmAction?.type === 'deleteFile' && confirmAction.fileId === file.id} disabled={saving} onDelete={() => void deleteInvoiceFile(file)} />
              </div>
            ))}
          </div>
        ) : <div className="muted">No documents attached to this asset invoice.</div>}
      </>
    )
  }

  function renderList() {
    return (
      <div className="sectionBody invoiceBrowser">
        {sortedAssets.length ? (
          <div className="tableWrap">
            <table className="table invoiceBrowseTable">
              <thead><tr><th>Asset</th><th>Category</th><th>Quantity</th><th>Total Cost</th><th>Purchase Date</th><th>Linked Items</th><th>Docs</th></tr></thead>
              <tbody>
                {sortedAssets.map((row) => (
                  <tr key={row.id} className="clickableRow" onClick={() => { cancelConfirm(); setView({ mode: 'detail', assetId: row.id }) }}>
                    <td>{row.asset}</td>
                    <td>{row.category ?? ''}</td>
                    <td>{row.quantity ?? ''}</td>
                    <td>{formatMoney(row.totalCost)}</td>
                    <td>{row.purchaseDate ?? ''}</td>
                    <td>{row.linkedOrderItemIds?.length ?? 0}</td>
                    <td>{row.files.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="muted">No assets saved yet.</div>}
      </div>
    )
  }

  function renderDetail() {
    if (!selectedAsset) return <div className="muted">Asset not found.</div>
    return (
      <div className="sectionBody invoiceDetail">
        <div className="selectedInvoiceSummary">
          <div>
            <div className="label">Asset</div>
            <div className="selectedInvoiceTitle">{selectedAsset.asset}</div>
          </div>
          <div className="selectedInvoiceMeta">
            {selectedAsset.category ? <span><span className="invoiceMetaLabel">Category</span> {selectedAsset.category}</span> : null}
            {selectedAsset.quantity === undefined ? null : <span><span className="invoiceMetaLabel">Qty</span> {selectedAsset.quantity}</span>}
            {selectedAsset.totalCost === undefined ? null : <span><span className="invoiceMetaLabel">Total</span> {formatMoney(selectedAsset.totalCost)}</span>}
            <span><span className="invoiceMetaLabel">Docs</span> {selectedAsset.files.length}</span>
          </div>
          <div className="rowActions">
            <button className="btn ghost compact" type="button" onClick={() => openEditForm(selectedAsset)}>Edit</button>
            <button className="btn danger compact" type="button" disabled={saving} onClick={() => void deleteSelectedAsset()}>
              {saving && confirmAction?.type === 'deleteAsset' ? 'Deleting...' : confirmAction?.type === 'deleteAsset' && confirmAction.assetId === selectedAsset.id ? 'Confirm Delete' : 'Delete'}
            </button>
          </div>
        </div>
        {confirmAction?.type === 'deleteAsset' ? <div className="callout warn invoiceConfirmMessage">Click Confirm Delete to permanently delete this asset and its invoice documents.</div> : null}
        {selectedAsset.notes ? <div className="invoiceNotes">{selectedAsset.notes}</div> : null}
        <div className="subTitle">Invoice</div>
        {linkedOrderRows.length ? (
          <div className="tableWrap miniTable">
            <table className="table">
              <thead><tr><th>Invoice</th><th>Company</th><th>Item</th><th>Cost</th><th>Files</th></tr></thead>
              <tbody>
                {linkedOrderRows.map(({ order, item }) => (
                  <tr key={item.id}>
                    <td>{order.invoiceNumber ?? ''}</td>
                    <td>{order.company?.name ?? ''}</td>
                    <td>{item.flowerName}</td>
                    <td>{item.itemCost === undefined ? '' : formatMoney(item.itemCost)}</td>
                    <td>{order.files.map((file) => <a key={file.id} href={file.fileUrl} target="_blank" rel="noreferrer">View</a>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {selectedAsset.company || selectedAsset.purchaseDate ? (
          <div className="tableWrap miniTable">
            <table className="table">
              <thead><tr><th>Custom Company</th><th>Purchase Date</th></tr></thead>
              <tbody><tr><td>{selectedAsset.company?.name ?? ''}</td><td>{selectedAsset.purchaseDate ?? ''}</td></tr></tbody>
            </table>
          </div>
        ) : null}
        <div className="subTitle">Documents</div>
        {renderDocuments(selectedAsset)}
      </div>
    )
  }

  function renderForm() {
    return (
      <div className="sectionBody orderForm">
        <div className="subTitle">{formAsset ? 'Edit Asset' : 'New Asset'}</div>
        <div className="grid2">
          <Field label="Asset" hint={ASSET_FIELD_HINTS.asset} value={asset} onChange={setAsset} />
          <label className="field">
            <FieldLabel label="Category" hint={ASSET_FIELD_HINTS.category} />
            <DropdownField label="Category" value={category} options={[{ value: '', label: 'Select...' }, ...CATEGORIES.map((option) => ({ value: option, label: option }))]} onChange={setCategory} />
          </label>
          <Field label="Quantity" hint={ASSET_FIELD_HINTS.quantity} type="number" value={quantity} onChange={setQuantity} />
          <Field
            label="Total Cost"
            hint={ASSET_FIELD_HINTS.totalCost}
            value={totalCost}
            onChange={(value) => {
              const next = moneyInputValue(value)
              if (next !== null) setTotalCost(next)
            }}
            onBlur={() => setTotalCost((current) => current.trim() ? formatMoneyInput(current) : '')}
          />
        </div>
        <TextArea label="Notes" hint={ASSET_FIELD_HINTS.notes} value={notes} onChange={setNotes} />
        <div className="subTitle">Invoice</div>
        <label className="field linkedOrderSelect">
          <FieldLabel label="Invoice Items" hint={ASSET_FIELD_HINTS.invoiceItems} />
          <DropdownField
            label="Invoice Items"
            value=""
            options={[
              { value: '', label: 'Select...' },
              ...orders.flatMap((order) => order.items.map((item) => ({
                value: item.id,
                label: `${order.company?.name ?? 'Company'} ${order.invoiceNumber ? `- ${order.invoiceNumber}` : ''} - ${item.flowerName}`,
              }))),
            ]}
            onChange={(value) => {
              if (!value) return
              setLinkedOrderItemIds((current) => Array.from(new Set([...current, value])))
            }}
          />
        </label>
        {linkedOrderRows.length ? (
          <div className="tableWrap miniTable">
            <table className="table">
              <thead><tr><th>Invoice</th><th>Company</th><th>Item</th><th>Cost</th><th>Files</th><th /></tr></thead>
              <tbody>
                {linkedOrderRows.map(({ order, item }) => (
                  <tr key={item.id}>
                    <td>{order.invoiceNumber ?? ''}</td>
                    <td>{order.company?.name ?? ''}</td>
                    <td>{item.flowerName}</td>
                    <td>{item.itemCost === undefined ? '' : formatMoney(item.itemCost)}</td>
                    <td>{order.files.map((file) => <a key={file.id} href={file.fileUrl} target="_blank" rel="noreferrer">View</a>)}</td>
                    <td><button className="btn ghost compact" type="button" onClick={() => setLinkedOrderItemIds((current) => current.filter((id) => id !== item.id))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="customEntryWrap">
          <div className="label">Custom Entry</div>
          <div className="customEntryBox">
        <div className="grid2">
          <label className="field">
            <FieldLabel label="Company" hint={ASSET_FIELD_HINTS.company} />
            <DropdownField label="Company" value={companyId} options={[{ value: '', label: 'Select...' }, ...companies.map((company) => ({ value: company.id, label: company.name }))]} onChange={setCompanyId} />
          </label>
          <Field label="Purchase Date" hint={ASSET_FIELD_HINTS.purchaseDate} type="date" value={purchaseDate} onChange={setPurchaseDate} />
        </div>
          </div>
        </div>
        <div className="rowActions">
          <button className="btn ghost" type="button" onClick={() => returnFromForm(formAsset?.id)}>Cancel</button>
          <button className="btn" type="button" disabled={!canSave || saving} onClick={() => void saveAsset()}>{saving ? 'Saving...' : formAsset ? 'Update Asset' : 'Save Asset'}</button>
        </div>
      </div>
    )
  }

  return (
    <Overlay onCancelConfirm={cancelConfirm}>
      <div className="modalHeader">
        <div>
          <div className="modalTitle">Assets</div>
          <div className="modalSub">Track non-flower garden supplies and their invoice documents.</div>
        </div>
        <div className="rowActions modalHeaderActions">
          {view.mode !== 'form' ? <button className="btn" type="button" onClick={openCreateForm}>Add Asset</button> : null}
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="modalBody invoiceModalBody">
        {view.mode !== 'list' ? (
          <div className="invoiceBreadcrumbs">
            <button className="invoiceCrumb" type="button" onClick={() => { cancelConfirm(); setView({ mode: 'list' }) }}>Assets</button>
            <button className="invoiceCrumb" type="button" disabled>{view.mode === 'form' ? (formAsset ? 'Edit Asset' : 'New Asset') : selectedAsset?.asset ?? 'Asset Detail'}</button>
          </div>
        ) : null}
        {error ? <div className="error inlineError">{error}</div> : null}
        {view.mode === 'list' ? renderList() : view.mode === 'detail' ? renderDetail() : renderForm()}
      </div>
    </Overlay>
  )
}
