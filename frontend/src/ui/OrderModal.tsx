import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import type { Company, CompanyInput, Garden, Order, OrderFile, OrderInput } from '../types'
import { DropdownField } from './DropdownField'
import { FlowerNameField } from './FlowerNameField'

type OrderItemForm = {
  id?: string
  orderId?: string
  gardenId?: string
  itemNo?: string
  flowerName: string
  cultivarName?: string
  itemCost?: string
  quantity?: number
  notes?: string
  createdAt?: string
  updatedAt?: string
}

type InvoiceView =
  | { mode: 'companies' }
  | { mode: 'invoices'; companyId: string }
  | { mode: 'detail'; orderId: string }
  | { mode: 'form'; orderId?: string }

type ConfirmAction = { type: 'deleteFile'; fileId: string } | { type: 'deleteOrder'; orderId: string } | null

const EMPTY_ITEM: OrderItemForm = { flowerName: '', cultivarName: '', quantity: 1 }
const UNKNOWN_YEAR = 'No Date'
const CURRENT_YEAR = String(new Date().getFullYear())

const ORDER_FIELD_HINTS = {
  company: 'Select the company associated with this invoice record.',
  newCompany: 'Enter a company name when the invoice is from a company that is not already listed.',
  invoiceNumber: 'Enter the invoice, receipt, or order number from the vendor.',
  orderDate: 'Enter the date shown on the invoice or the date the order was placed.',
  totalCost: 'Enter the total invoice cost across all items.',
  orderNotes: 'Add optional notes about this invoice, shipment, or order.',
  itemNo: 'Enter the line item number as shown on the invoice.',
  flowerName: 'Enter the flower or item name from the invoice line item.',
  quantity: 'Enter the number of units for this invoice item.',
  itemCost: 'Enter the cost for this individual invoice item.',
  gardenAssignment: 'Assign this invoice item to a garden, or leave it unassigned for later placement.',
}

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

function Field({ label, hint, value, onChange, type, onBlur, disabled }: { label: string; hint?: string; value: string; onChange: (v: string) => void; type?: 'text' | 'number' | 'date'; onBlur?: () => void; disabled?: boolean }) {
  return (
    <label className="field">
      <FieldLabel label={label} hint={hint} />
      <input className="input" value={value} type={type ?? 'text'} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} disabled={disabled} />
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

  function showHint() {
    setVisible(false)
    window.requestAnimationFrame(() => setVisible(true))
  }

  function hideHint() {
    setVisible(false)
  }

  return (
    <button
      className={`fileDeleteButton${visible ? ' show' : ''}${armed ? ' armed' : ''}`}
      type="button"
      disabled={disabled}
      aria-label="Delete document"
      onMouseEnter={showHint}
      onMouseLeave={hideHint}
      onFocus={showHint}
      onBlur={hideHint}
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

function invoiceYear(order: Order) {
  return order.orderDate?.slice(0, 4) || UNKNOWN_YEAR
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

function sortInvoices(a: Order, b: Order) {
  const invoiceCompare = String(a.invoiceNumber ?? '').localeCompare(String(b.invoiceNumber ?? ''), undefined, { numeric: true })
  if (invoiceCompare !== 0) return invoiceCompare
  return String(b.orderDate ?? '').localeCompare(String(a.orderDate ?? ''))
}

export function OrderModal({
  companies,
  gardens = [],
  orders,
  flowerNames = [],
  initialOrderId,
  onClose,
  onCreateCompany,
  onCreateOrder,
  onUpdateOrder,
  onDeleteOrder,
  onUploadInvoice,
  onDeleteInvoiceFile,
  onOpenFlowerNames,
  flowerNameRename,
}: {
  companies: Company[]
  gardens?: Garden[]
  orders: Order[]
  flowerNames?: string[]
  initialOrderId?: string | null
  onClose: () => void
  onCreateCompany: (input: CompanyInput) => Promise<Company>
  onCreateOrder: (input: OrderInput) => Promise<Order>
  onUpdateOrder: (id: string, input: OrderInput) => Promise<Order>
  onDeleteOrder: (id: string) => Promise<void>
  onUploadInvoice: (orderId: string, file: File, sourceType: 'uploaded_pdf' | 'image_converted_to_pdf') => Promise<void>
  onDeleteInvoiceFile: (orderId: string, fileId: string) => Promise<void>
  onOpenFlowerNames?: () => void
  flowerNameRename?: { oldName: string; newName: string } | null
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const confirmAreaRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<InvoiceView>(() => initialOrderId ? { mode: 'detail', orderId: initialOrderId } : { mode: 'companies' })
  const [companyId, setCompanyId] = useState('')
  const [newCompanyName, setNewCompanyName] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [totalCost, setTotalCost] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<OrderItemForm[]>([EMPTY_ITEM])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [selectedFilterCompanyId, setSelectedFilterCompanyId] = useState('')
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)

  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders])
  const knownFlowerNames = useMemo(() => {
    const fromOrders = orders.flatMap((order) => order.items.map((item) => item.flowerName))
    const merged = new Set([...flowerNames, ...fromOrders].filter(Boolean))
    return [...merged].sort((a, b) => a.localeCompare(b))
  }, [flowerNames, orders])
  const selectedOrder = view.mode === 'detail' ? orderById.get(view.orderId) ?? null : null
  const formOrder = view.mode === 'form' && view.orderId ? orderById.get(view.orderId) ?? null : null
  const canSave = (companyId || newCompanyName.trim()) && invoiceNumber.trim() && totalCost.trim() && orderDate.trim()

  const companySummaries = useMemo(() => {
    return companies
      .map((company) => {
        const companyOrders = orders.filter((order) => order.companyId === company.id)
        const years = new Set(companyOrders.map(invoiceYear))
        return {
          company,
          count: companyOrders.length,
          years: Array.from(years).sort((a, b) => b.localeCompare(a)),
          total: companyOrders.reduce((sum, order) => sum + (order.totalCost ?? 0), 0),
          docs: companyOrders.reduce((sum, order) => sum + order.files.length, 0),
          updatedAt: companyOrders.map((order) => order.updatedAt ?? order.createdAt ?? '').sort().at(-1) ?? '',
        }
      })
      .filter((summary) => summary.count > 0)
      .sort((a, b) => a.company.name.localeCompare(b.company.name))
  }, [companies, orders])

  const currentCompany = view.mode === 'invoices'
    ? companies.find((company) => company.id === view.companyId) ?? null
    : selectedOrder?.company ?? formOrder?.company ?? null

  const invoiceList = useMemo(() => {
    if (view.mode !== 'invoices') return []
    return orders
      .filter((order) => order.companyId === view.companyId)
      .sort(sortInvoices)
  }, [orders, view])

  const availableYears = useMemo(() => {
    return Array.from(new Set(invoiceList.map(invoiceYear))).sort((a, b) => b.localeCompare(a))
  }, [invoiceList])

  const filteredInvoiceList = useMemo(() => {
    if (selectedYear === 'All') return invoiceList
    return invoiceList.filter((order) => invoiceYear(order) === selectedYear)
  }, [invoiceList, selectedYear])

  useEffect(() => {
    if (!selectedOrder && view.mode === 'detail') setView({ mode: 'companies' })
  }, [selectedOrder, view.mode])

  useEffect(() => {
    if (initialOrderId && orderById.has(initialOrderId)) setView({ mode: 'detail', orderId: initialOrderId })
  }, [initialOrderId, orderById])

  useEffect(() => {
    if (!flowerNameRename) return
    const { oldName, newName } = flowerNameRename
    setItems((prev) => prev.map((item) => {
      if (item.flowerName !== oldName) return item
      return {
        ...item,
        flowerName: newName,
        cultivarName: item.cultivarName === oldName ? newName : item.cultivarName,
      }
    }))
  }, [flowerNameRename])

  function cancelConfirm() {
    setConfirmAction(null)
  }

  function openInvoices(companyId: string, year?: string) {
    cancelConfirm()
    setSelectedYear(year ?? CURRENT_YEAR)
    setView({ mode: 'invoices', companyId })
  }

  function resetForm() {
    setCompanyId('')
    setNewCompanyName('')
    setInvoiceNumber('')
    setOrderDate('')
    setTotalCost('')
    setNotes('')
    setItems([EMPTY_ITEM])
  }

  function openCreateForm() {
    cancelConfirm()
    setError(null)
    resetForm()
    setView({ mode: 'form' })
  }

  function openEditForm(order: Order) {
    cancelConfirm()
    setError(null)
    setCompanyId(order.companyId)
    setNewCompanyName('')
    setInvoiceNumber(order.invoiceNumber ?? '')
    setOrderDate(order.orderDate ?? '')
    setTotalCost(order.totalCost === undefined ? '' : formatMoneyInput(String(order.totalCost)))
    setNotes(order.notes ?? '')
    setItems(
      order.items.length
        ? order.items.map((item) => ({
            id: item.id,
            orderId: item.orderId,
            gardenId: item.gardenId,
            itemNo: item.itemNo,
            flowerName: item.flowerName,
            cultivarName: item.cultivarName,
            itemCost: item.itemCost === undefined ? '' : formatMoneyInput(String(item.itemCost)),
            quantity: item.quantity,
            notes: item.notes,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          }))
        : [EMPTY_ITEM],
    )
    setView({ mode: 'form', orderId: order.id })
  }

  function returnFromForm(orderId?: string) {
    resetForm()
    setError(null)
    setView(orderId ? { mode: 'detail', orderId } : { mode: 'companies' })
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
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvas.width, canvas.height],
      })
      pdf.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height)
      const blob = pdf.output('blob')
      return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.pdf`, { type: 'application/pdf' })
    } finally {
      URL.revokeObjectURL(imageUrl)
    }
  }

  async function saveOrder() {
    setSaving(true)
    setError(null)
    cancelConfirm()
    try {
      let nextCompanyId = companyId
      if (!nextCompanyId) {
        const company = await onCreateCompany({ name: toTitleCase(newCompanyName) })
        nextCompanyId = company.id
        setCompanyId(company.id)
        setNewCompanyName('')
      }
      const input = {
        companyId: nextCompanyId,
        invoiceNumber: invoiceNumber || undefined,
        orderDate: orderDate || undefined,
        totalCost: toNumber(totalCost.replace(/[$,]/g, '')),
        notes: notes || undefined,
        items: items.filter((item) => item.flowerName.trim()).map((item) => ({ ...item, itemNo: item.itemNo?.trim() || undefined, gardenId: item.gardenId || undefined, flowerName: item.flowerName.trim(), cultivarName: (item.cultivarName || item.flowerName).trim(), itemCost: item.itemCost === undefined ? undefined : toNumber(item.itemCost.replace(/[$,]/g, '')), quantity: item.quantity ?? undefined })),
      }
      const order = formOrder ? await onUpdateOrder(formOrder.id, input) : await onCreateOrder(input)
      resetForm()
      setView({ mode: 'detail', orderId: order.id })
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || !selectedOrder) return
    setSaving(true)
    setError(null)
    cancelConfirm()
    try {
      for (const file of Array.from(files)) {
        if (file.type === 'application/pdf') {
          await onUploadInvoice(selectedOrder.id, file, 'uploaded_pdf')
        } else if (file.type.startsWith('image/')) {
          const pdf = await convertImageToPdf(file)
          await onUploadInvoice(selectedOrder.id, pdf, 'image_converted_to_pdf')
        } else {
          throw new Error('Only PDF and image invoice files are supported.')
        }
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    }
  }

  async function deleteInvoiceFile(file: OrderFile) {
    if (!selectedOrder) return
    if (confirmAction?.type !== 'deleteFile' || confirmAction.fileId !== file.id) {
      setConfirmAction({ type: 'deleteFile', fileId: file.id })
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onDeleteInvoiceFile(selectedOrder.id, file.id)
      cancelConfirm()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteSelectedOrder() {
    if (!selectedOrder) return
    if (confirmAction?.type !== 'deleteOrder' || confirmAction.orderId !== selectedOrder.id) {
      setConfirmAction({ type: 'deleteOrder', orderId: selectedOrder.id })
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onDeleteOrder(selectedOrder.id)
      openInvoices(selectedOrder.companyId, invoiceYear(selectedOrder))
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  function renderBreadcrumb() {
    if (view.mode === 'companies') return null

    const crumbs = [{ label: 'Companies', onClick: () => setView({ mode: 'companies' }) }]
    if (currentCompany && (view.mode === 'invoices' || view.mode === 'detail')) {
      crumbs.push({ label: currentCompany.name, onClick: () => openInvoices(currentCompany.id, selectedOrder ? invoiceYear(selectedOrder) : CURRENT_YEAR) })
    }
    if (view.mode === 'detail' && selectedOrder) crumbs.push({ label: selectedOrder.invoiceNumber ? `Invoice #${selectedOrder.invoiceNumber}` : 'Invoice Detail', onClick: () => undefined })
    if (view.mode === 'form') crumbs.push({ label: formOrder ? 'Edit Invoice' : 'New Invoice', onClick: () => undefined })

    return (
      <div className="invoiceBreadcrumbs">
        {crumbs.map((crumb, index) => (
          <button key={`${crumb.label}-${index}`} className="invoiceCrumb" type="button" onClick={() => { cancelConfirm(); crumb.onClick() }} disabled={index === crumbs.length - 1}>
            {crumb.label}
          </button>
        ))}
      </div>
    )
  }

  function renderCompanies() {
    const companyInvoices = selectedFilterCompanyId
      ? orders.filter((order) => order.companyId === selectedFilterCompanyId).sort(sortInvoices)
      : []

    return (
      <div className="sectionBody invoiceBrowser">
        <div className="invoiceSearchWrap">
          <DropdownField
            label="Company"
            value={selectedFilterCompanyId}
            options={[{ value: '', label: 'Select...' }, ...companySummaries.map((s) => ({ value: s.company.id, label: s.company.name }))]}
            onChange={setSelectedFilterCompanyId}
          />
        </div>
        {selectedFilterCompanyId ? (
          <div className="tableWrap">
            <table className="table invoiceBrowseTable">
              <thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Items</th><th>Docs</th></tr></thead>
              <tbody>
                {companyInvoices.length ? companyInvoices.map((order) => (
                  <tr key={order.id} className="clickableRow" onClick={() => { cancelConfirm(); setView({ mode: 'detail', orderId: order.id }) }}>
                    <td>{order.invoiceNumber ? `#${order.invoiceNumber}` : 'No invoice number'}</td>
                    <td>{order.orderDate || ''}</td>
                    <td>{formatMoney(order.totalCost)}</td>
                    <td>{order.items.length}</td>
                    <td>{order.files.length}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="muted">No invoices for this company.</td></tr>}
              </tbody>
            </table>
          </div>
        ) : <div className="muted">{companySummaries.length ? 'Select a company to view its invoices.' : 'No invoice records saved yet.'}</div>}
      </div>
    )
  }

  function renderInvoices() {
    const activeYear = availableYears.includes(selectedYear) ? selectedYear : 'All'
    return (
      <div className="sectionBody invoiceBrowser">
        <div className="subTitle">{currentCompany?.name ?? 'Company'} Invoices</div>
        <div className="invoiceYearPills" role="group" aria-label="Filter by year">
          <button className={`invoiceYearPill${activeYear === 'All' ? ' active' : ''}`} type="button" onClick={() => setSelectedYear('All')}>All</button>
          {availableYears.map((year) => (
            <button key={year} className={`invoiceYearPill${activeYear === year ? ' active' : ''}`} type="button" onClick={() => setSelectedYear(year)}>{year}</button>
          ))}
        </div>
        <div className="tableWrap">
          <table className="table invoiceBrowseTable">
            <thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Items</th><th>Docs</th></tr></thead>
            <tbody>
              {filteredInvoiceList.length ? filteredInvoiceList.map((order) => (
                <tr key={order.id} className="clickableRow" onClick={() => { cancelConfirm(); setView({ mode: 'detail', orderId: order.id }) }}>
                  <td>{order.invoiceNumber ? `#${order.invoiceNumber}` : 'No invoice number'}</td>
                  <td>{order.orderDate || ''}</td>
                  <td>{formatMoney(order.totalCost)}</td>
                  <td>{order.items.length}</td>
                  <td>{order.files.length}</td>
                </tr>
              )) : <tr><td colSpan={5} className="muted">No invoices for {activeYear === 'All' ? 'this company' : activeYear}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  function renderDocuments(order: Order) {
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
        {order.files.length ? (
          <div ref={confirmAreaRef} className="fileList" aria-label="Uploaded invoice files">
            {[...order.files].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))).map((file) => (
              <div className="fileCard" key={file.id}>
                <a className="fileCardLink" href={file.fileUrl} target="_blank" rel="noreferrer">
                  <span className="fileBadge">PDF</span>
                  <span className="fileCardBody">
                    <span className="fileCardName">{file.originalFileName}</span>
                    <span className="fileCardMeta">
                      {formatUploadDate(file.createdAt)} · {formatFileSize(file.fileSize)}
                    </span>
                  </span>
                </a>
                <FileDeleteButton armed={confirmAction?.type === 'deleteFile' && confirmAction.fileId === file.id} disabled={saving} onDelete={() => void deleteInvoiceFile(file)} />
              </div>
            ))}
          </div>
        ) : <div className="muted">No documents attached to this invoice.</div>}
      </>
    )
  }

  function renderDetail() {
    if (!selectedOrder) return <div className="muted">Invoice record not found.</div>
    return (
      <div className="sectionBody invoiceDetail">
        <div className="selectedInvoiceSummary">
          <div>
            <div className="label">Invoice Record</div>
            <div className="selectedInvoiceTitle">{selectedOrder.company?.name ?? 'Company'} {selectedOrder.invoiceNumber ? `- ${selectedOrder.invoiceNumber}` : ''}</div>
          </div>
          <div className="selectedInvoiceMeta">
            {selectedOrder.orderDate ? <span><span className="invoiceMetaLabel">Date</span> {selectedOrder.orderDate}</span> : null}
            {selectedOrder.totalCost === undefined ? null : <span><span className="invoiceMetaLabel">Total</span> {formatMoney(selectedOrder.totalCost)}</span>}
            <span><span className="invoiceMetaLabel">Items</span> {selectedOrder.items.length}</span>
            <span><span className="invoiceMetaLabel">Docs</span> {selectedOrder.files.length}</span>
          </div>
          <div className="rowActions">
            <button className="btn ghost compact" type="button" onClick={() => openEditForm(selectedOrder)}>Edit</button>
            <button className="btn danger compact" type="button" disabled={saving} onClick={() => void deleteSelectedOrder()}>
              {saving && confirmAction?.type === 'deleteOrder' ? 'Deleting...' : confirmAction?.type === 'deleteOrder' && confirmAction.orderId === selectedOrder.id ? 'Confirm Delete' : 'Delete'}
            </button>
          </div>
        </div>
        {confirmAction?.type === 'deleteOrder' ? <div className="callout warn invoiceConfirmMessage">Click Confirm Delete to permanently delete this invoice, its items, and its documents.</div> : null}
        {selectedOrder.notes ? <div className="invoiceNotes">{selectedOrder.notes}</div> : null}
        <div className="subTitle">Order Items</div>
        <div className="tableWrap miniTable">
          <table className="table">
            <thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Cost</th><th>Garden</th></tr></thead>
            <tbody>
              {selectedOrder.items.length ? [...selectedOrder.items].sort((a, b) => {
                const aNo = a.itemNo?.trim()
                const bNo = b.itemNo?.trim()
                if (aNo && bNo) return aNo.localeCompare(bNo, undefined, { numeric: true })
                if (aNo) return -1
                if (bNo) return 1
                return a.flowerName.localeCompare(b.flowerName)
              }).map((item) => (
                <tr key={item.id}>
                  <td>{item.itemNo ?? ''}</td>
                  <td>{item.flowerName}</td>
                  <td>{item.quantity ?? ''}</td>
                  <td>{formatMoney(item.itemCost)}</td>
                  <td>{gardens.find((garden) => garden.id === item.gardenId)?.name ?? 'Unassigned'}</td>
                </tr>
              )) : <tr><td colSpan={5}>No items entered.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="subTitle">Documents</div>
        {renderDocuments(selectedOrder)}
      </div>
    )
  }

  function renderForm() {
    return (
      <div className="sectionBody orderForm">
        <div className="grid2">
          <label className="field">
            <FieldLabel label="Company" hint={ORDER_FIELD_HINTS.company} />
            <DropdownField label="Company" value={companyId} options={[{ value: '', label: 'Use new company...' }, ...companies.map((company) => ({ value: company.id, label: company.name }))]} onChange={(value) => { setCompanyId(value); if (value) setNewCompanyName('') }} />
          </label>
        </div>
        <div className="subTitle">{formOrder ? 'Edit Invoice Record' : 'Invoice Details'}</div>
        <div className="grid2">
          <Field label="New Company" hint={ORDER_FIELD_HINTS.newCompany} value={newCompanyName} onChange={setNewCompanyName} disabled={Boolean(companyId)} />
          <Field label="Invoice No." hint={ORDER_FIELD_HINTS.invoiceNumber} value={invoiceNumber} onChange={setInvoiceNumber} />
          <Field
            label="Total Cost"
            hint={ORDER_FIELD_HINTS.totalCost}
            value={totalCost}
            onChange={(value) => {
              const next = moneyInputValue(value)
              if (next !== null) setTotalCost(next)
            }}
            onBlur={() => setTotalCost((current) => current.trim() ? formatMoneyInput(current) : '')}
          />
          <Field label="Order Date" hint={ORDER_FIELD_HINTS.orderDate} type="date" value={orderDate} onChange={setOrderDate} />
        </div>
        <TextArea label="Order Notes" hint={ORDER_FIELD_HINTS.orderNotes} value={notes} onChange={setNotes} />
        <div className="subTitle orderItemsTitle">Order Items</div>
        <div className="orderItems">
          {items.map((item, index) => (
            <div className="orderItemRow" key={index}>
              <FlowerNameField
                label="Flower Name"
                hint={ORDER_FIELD_HINTS.flowerName}
                value={item.flowerName}
                knownFlowerNames={knownFlowerNames}
                onChange={(v) => setItems((p) => p.map((row, i) => (i === index ? { ...row, flowerName: v, cultivarName: v } : row)))}
                labelAction={onOpenFlowerNames ? <button className="labelLink" type="button" onClick={onOpenFlowerNames}>Flower Name</button> : undefined}
              />
              <Field label="Item No." hint={ORDER_FIELD_HINTS.itemNo} value={item.itemNo ?? ''} onChange={(v) => setItems((p) => p.map((row, i) => (i === index ? { ...row, itemNo: v } : row)))} />
              <Field
                label="Qty"
                hint={ORDER_FIELD_HINTS.quantity}
                type="number"
                value={item.quantity === undefined ? '' : String(item.quantity)}
                onChange={(v) => setItems((p) => p.map((row, i) => (i === index ? { ...row, quantity: v.trim() ? Math.max(1, parseInt(v, 10) || 1) : undefined } : row)))}
              />
              <Field
                label="Item Cost"
                hint={ORDER_FIELD_HINTS.itemCost}
                value={item.itemCost ?? ''}
                onChange={(value) => {
                  const next = moneyInputValue(value)
                  if (next !== null) setItems((p) => p.map((row, i) => (i === index ? { ...row, itemCost: next } : row)))
                }}
                onBlur={() => setItems((p) => p.map((row, i) => (i === index ? { ...row, itemCost: row.itemCost?.trim() ? formatMoneyInput(row.itemCost) : '' } : row)))}
              />
              <label className="field">
                <FieldLabel label="Garden" hint={ORDER_FIELD_HINTS.gardenAssignment} />
                <DropdownField label="Garden" value={item.gardenId ?? ''} options={[{ value: '', label: 'Unassigned' }, ...gardens.map((garden) => ({ value: garden.id, label: garden.name }))]} onChange={(value) => setItems((p) => p.map((row, i) => (i === index ? { ...row, gardenId: value || undefined } : row)))} />
              </label>
            </div>
          ))}
        </div>
        <div className="rowActions">
          <button className="btn ghost" type="button" onClick={() => setItems((p) => [...p, { ...EMPTY_ITEM }])}>Add Item</button>
          <button className="btn ghost" type="button" onClick={() => returnFromForm(formOrder?.id)}>Cancel</button>
          <button className="btn" type="button" disabled={!canSave || saving} onClick={() => void saveOrder()}>{saving ? 'Saving...' : formOrder ? 'Update Invoice Record' : 'Save Invoice Record'}</button>
        </div>
      </div>
    )
  }

  function renderBody() {
    switch (view.mode) {
      case 'companies':
        return renderCompanies()
      case 'invoices':
        return renderInvoices()
      case 'detail':
        return renderDetail()
      case 'form':
        return renderForm()
    }
  }

  return (
    <Overlay onCancelConfirm={cancelConfirm}>
      <div className="modalHeader">
        <div>
          <div className="modalTitle">Invoice Records</div>
          <div className="modalSub">Browse invoice records by company and year, then manage invoice details and documents.</div>
        </div>
        <div className="rowActions modalHeaderActions">
          {view.mode !== 'form' ? <button className="btn" type="button" onClick={openCreateForm}>Add Invoice Record</button> : null}
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="modalBody invoiceModalBody">
        {renderBreadcrumb()}
        {error ? <div className="error inlineError">{error}</div> : null}
        {renderBody()}
      </div>
    </Overlay>
  )
}
