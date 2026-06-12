import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import type { Company, CompanyInput, Garden, Order, OrderFile, OrderInput } from '../types'

type OrderItemForm = {
  id?: string
  orderId?: string
  gardenId?: string
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
  | { mode: 'years'; companyId: string }
  | { mode: 'invoices'; companyId: string; year: string }
  | { mode: 'detail'; orderId: string }
  | { mode: 'form'; orderId?: string }

type ConfirmAction = { type: 'deleteFile'; fileId: string } | { type: 'deleteOrder'; orderId: string } | null

const EMPTY_ITEM: OrderItemForm = { flowerName: '', cultivarName: '', quantity: 1 }
const UNKNOWN_YEAR = 'No Date'

function Overlay({ children, onCancelConfirm }: { children: React.ReactNode; onCancelConfirm: () => void }) {
  return (
    <div className="modalOverlay" onPointerDown={onCancelConfirm}>
      <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type, onBlur }: { label: string; value: string; onChange: (v: string) => void; type?: 'text' | 'number' | 'date'; onBlur?: () => void }) {
  return (
    <label className="field">
      <div className="label">{label}</div>
      <input className="input" value={value} type={type ?? 'text'} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
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
  initialOrderId,
  onClose,
  onCreateCompany,
  onCreateOrder,
  onUpdateOrder,
  onDeleteOrder,
  onUploadInvoice,
  onDeleteInvoiceFile,
}: {
  companies: Company[]
  gardens?: Garden[]
  orders: Order[]
  initialOrderId?: string | null
  onClose: () => void
  onCreateCompany: (input: CompanyInput) => Promise<Company>
  onCreateOrder: (input: OrderInput) => Promise<Order>
  onUpdateOrder: (id: string, input: OrderInput) => Promise<Order>
  onDeleteOrder: (id: string) => Promise<void>
  onUploadInvoice: (orderId: string, file: File, sourceType: 'uploaded_pdf' | 'image_converted_to_pdf') => Promise<void>
  onDeleteInvoiceFile: (orderId: string, fileId: string) => Promise<void>
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

  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders])
  const selectedOrder = view.mode === 'detail' ? orderById.get(view.orderId) ?? null : null
  const formOrder = view.mode === 'form' && view.orderId ? orderById.get(view.orderId) ?? null : null
  const canSave = companyId || newCompanyName.trim()

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

  const currentCompany = view.mode === 'years' || view.mode === 'invoices'
    ? companies.find((company) => company.id === view.companyId) ?? null
    : selectedOrder?.company ?? formOrder?.company ?? null

  const yearSummaries = useMemo(() => {
    if (view.mode !== 'years') return []
    const byYear = new Map<string, Order[]>()
    for (const order of orders.filter((order) => order.companyId === view.companyId)) {
      const year = invoiceYear(order)
      byYear.set(year, [...(byYear.get(year) ?? []), order])
    }
    return Array.from(byYear.entries())
      .map(([year, yearOrders]) => ({
        year,
        count: yearOrders.length,
        total: yearOrders.reduce((sum, order) => sum + (order.totalCost ?? 0), 0),
        docs: yearOrders.reduce((sum, order) => sum + order.files.length, 0),
      }))
      .sort((a, b) => b.year.localeCompare(a.year))
  }, [orders, view])

  const invoiceList = useMemo(() => {
    if (view.mode !== 'invoices') return []
    return orders
      .filter((order) => order.companyId === view.companyId && invoiceYear(order) === view.year)
      .sort(sortInvoices)
  }, [orders, view])

  useEffect(() => {
    if (!selectedOrder && view.mode === 'detail') setView({ mode: 'companies' })
  }, [selectedOrder, view.mode])

  useEffect(() => {
    if (initialOrderId && orderById.has(initialOrderId)) setView({ mode: 'detail', orderId: initialOrderId })
  }, [initialOrderId, orderById])

  function cancelConfirm() {
    setConfirmAction(null)
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
        items: items.filter((item) => item.flowerName.trim()).map((item) => ({ ...item, gardenId: item.gardenId || undefined, flowerName: toTitleCase(item.flowerName), cultivarName: toTitleCase(item.cultivarName || item.flowerName), itemCost: item.itemCost === undefined ? undefined : toNumber(item.itemCost.replace(/[$,]/g, '')), quantity: item.quantity ?? undefined })),
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
      cancelConfirm()
      setView({ mode: 'invoices', companyId: selectedOrder.companyId, year: invoiceYear(selectedOrder) })
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  function renderBreadcrumb() {
    if (view.mode === 'companies') return null

    const crumbs = [{ label: 'Companies', onClick: () => setView({ mode: 'companies' }) }]
    if (currentCompany && (view.mode === 'years' || view.mode === 'invoices' || view.mode === 'detail')) {
      crumbs.push({ label: currentCompany.name, onClick: () => setView({ mode: 'years', companyId: currentCompany.id }) })
    }
    if (view.mode === 'invoices' || view.mode === 'detail') {
      const year = view.mode === 'invoices' ? view.year : selectedOrder ? invoiceYear(selectedOrder) : ''
      if (currentCompany && year) crumbs.push({ label: year, onClick: () => setView({ mode: 'invoices', companyId: currentCompany.id, year }) })
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
    return (
      <div className="sectionBody invoiceBrowser">
        {companySummaries.length ? (
          <div className="tableWrap">
            <table className="table invoiceBrowseTable">
              <thead><tr><th>Company</th><th>Records</th><th>Years</th><th>Total Spend</th><th>Docs</th><th>Last Updated</th></tr></thead>
              <tbody>
                {companySummaries.map((summary) => (
                  <tr key={summary.company.id} className="clickableRow" onClick={() => { cancelConfirm(); setView({ mode: 'years', companyId: summary.company.id }) }}>
                    <td>{summary.company.name}</td>
                    <td>{summary.count}</td>
                    <td>{summary.years.join(', ')}</td>
                    <td>{formatMoney(summary.total)}</td>
                    <td>{summary.docs}</td>
                    <td>{summary.updatedAt ? summary.updatedAt.slice(0, 10) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="muted">No invoice records saved yet.</div>}
      </div>
    )
  }

  function renderYears() {
    return (
      <div className="sectionBody invoiceBrowser">
        <div className="subTitle">{currentCompany?.name ?? 'Company'} Purchase Years</div>
        <div className="tableWrap">
          <table className="table invoiceBrowseTable">
            <thead><tr><th>Year</th><th>Invoices</th><th>Total Spend</th><th>Docs</th></tr></thead>
            <tbody>
              {yearSummaries.map((summary) => (
                <tr key={summary.year} className="clickableRow" onClick={() => { cancelConfirm(); setView({ mode: 'invoices', companyId: view.mode === 'years' ? view.companyId : '', year: summary.year }) }}>
                  <td>{summary.year}</td>
                  <td>{summary.count}</td>
                  <td>{formatMoney(summary.total)}</td>
                  <td>{summary.docs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  function renderInvoices() {
    return (
      <div className="sectionBody invoiceBrowser">
        <div className="subTitle">{currentCompany?.name ?? 'Company'} Invoices - {view.mode === 'invoices' ? view.year : ''}</div>
        <div className="tableWrap">
          <table className="table invoiceBrowseTable">
            <thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Items</th><th>Docs</th></tr></thead>
            <tbody>
              {invoiceList.map((order) => (
                <tr key={order.id} className="clickableRow" onClick={() => { cancelConfirm(); setView({ mode: 'detail', orderId: order.id }) }}>
                  <td>{order.invoiceNumber ? `#${order.invoiceNumber}` : 'No invoice number'}</td>
                  <td>{order.orderDate || ''}</td>
                  <td>{formatMoney(order.totalCost)}</td>
                  <td>{order.items.length}</td>
                  <td>{order.files.length}</td>
                </tr>
              ))}
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
            {order.files.map((file) => (
              <div className="fileCard" key={file.id}>
                <a className="fileCardLink" href={file.fileUrl} target="_blank" rel="noreferrer">
                  <span className="fileBadge">PDF</span>
                  <span className="fileCardBody">
                    <span className="fileCardName">{file.originalFileName}</span>
                    <span className="fileCardMeta">
                      {file.sourceType === 'image_converted_to_pdf' ? 'Photo converted to PDF' : 'Uploaded PDF'} · {formatFileSize(file.fileSize)}
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
            <thead><tr><th>Item</th><th>Garden</th><th>Cost</th></tr></thead>
            <tbody>
              {selectedOrder.items.length ? selectedOrder.items.map((item) => <tr key={item.id}><td>{item.flowerName}</td><td>{gardens.find((garden) => garden.id === item.gardenId)?.name ?? 'Unassigned'}</td><td>{formatMoney(item.itemCost)}</td></tr>) : <tr><td colSpan={3}>No items entered.</td></tr>}
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
        <div className="subTitle">{formOrder ? 'Edit Invoice Record' : 'New Invoice Record'}</div>
        <div className="grid2">
          <label className="field">
            <div className="label">Company</div>
            <select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Select...</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
          <Field label="New Company" value={newCompanyName} onChange={setNewCompanyName} />
          <Field label="Invoice Number" value={invoiceNumber} onChange={setInvoiceNumber} />
          <Field label="Order Date" type="date" value={orderDate} onChange={setOrderDate} />
          <Field
            label="Total Cost"
            value={totalCost}
            onChange={(value) => {
              const next = moneyInputValue(value)
              if (next !== null) setTotalCost(next)
            }}
            onBlur={() => setTotalCost((current) => current.trim() ? formatMoneyInput(current) : '')}
          />
        </div>
        <TextArea label="Order Notes" value={notes} onChange={setNotes} />
        <div className="subTitle">Order Items</div>
        <div className="orderItems">
          {items.map((item, index) => (
            <div className="grid2" key={index}>
              <Field label="Flower Name" value={item.flowerName} onChange={(v) => setItems((p) => p.map((row, i) => (i === index ? { ...row, flowerName: v, cultivarName: v } : row)))} />
              <Field
                label="Item Cost"
                value={item.itemCost ?? ''}
                onChange={(value) => {
                  const next = moneyInputValue(value)
                  if (next !== null) setItems((p) => p.map((row, i) => (i === index ? { ...row, itemCost: next } : row)))
                }}
                onBlur={() => setItems((p) => p.map((row, i) => (i === index ? { ...row, itemCost: row.itemCost?.trim() ? formatMoneyInput(row.itemCost) : '' } : row)))}
              />
              <label className="field gridSpanFull">
                <div className="label">Garden Assignment</div>
                <select className="select" value={item.gardenId ?? ''} onChange={(event) => setItems((p) => p.map((row, i) => (i === index ? { ...row, gardenId: event.target.value || undefined } : row)))}>
                  <option value="">Unassigned</option>
                  {gardens.map((garden) => <option key={garden.id} value={garden.id}>{garden.name}</option>)}
                </select>
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
      case 'years':
        return renderYears()
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
