import { lazy, Suspense, useState } from 'react'
import type { AgentReviewResult, AgentVisualization, MaintenanceReminderInput } from '../types'
import agentHelperCapabilities from '../agentHelperCapabilities.json'
import { apiHeaders } from '../firebase'

const AgentVisualizationView = lazy(async () => {
  const module = await import('./AgentVisualizationView')
  return { default: module.AgentVisualizationView }
})

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? ''

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(await apiHeaders(init?.headers)),
    },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Request failed: ${res.status}`)
  }
  return (await res.json()) as T
}

type AgentResult =
  | {
      status: 'needs_clarification'
      message: string
    }
  | {
      status: 'answer'
      message: string
      visualization?: AgentVisualization
      chart?: AgentVisualization
      caveats?: string[]
      sourcesUsed?: Array<'records' | 'orders' | 'companies'>
    }

type AgentHelperCapability = {
  name: string
  description: string
}

const LOCAL_CAPABILITIES = agentHelperCapabilities as AgentHelperCapability[]

function normalizeIntentText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isCapabilitiesQuestion(value: string) {
  const normalized = normalizeIntentText(value)
  if (!normalized) return false

  const asksWhat = /\b(what|which|how)\b/.test(normalized)
  const asksCapability = /\b(can|could|do|does|help|assist|support|capabilities|actions|features)\b/.test(normalized)
  const namesAgent = /\b(agent helper|agent)\b/.test(normalized)
  const helpWith = /\b(help me with|help with|assist me with|assist with|what can you do|what do you do|what are your capabilities|what actions)\b/.test(normalized)

  return helpWith || (asksWhat && asksCapability && namesAgent)
}

function localCapabilitiesMessage() {
  return LOCAL_CAPABILITIES.map((capability) => `- **${capability.name}**: ${capability.description}`).join('\n')
}

type FormattedBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }

function parseFormattedText(text: string): FormattedBlock[] {
  const blocks: FormattedBlock[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let quote: string[] = []

  function flushParagraph() {
    if (!paragraph.length) return
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }

  function flushList() {
    if (!list) return
    blocks.push({ type: 'list', ordered: list.ordered, items: list.items })
    list = null
  }

  function flushQuote() {
    if (!quote.length) return
    blocks.push({ type: 'quote', text: quote.join('\n') })
    quote = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      flushQuote()
      continue
    }

    const quoteMatch = trimmed.match(/^>\s*(.+)$/)
    if (quoteMatch) {
      flushParagraph()
      flushList()
      quote.push(quoteMatch[1])
      continue
    }

    const listMatch = trimmed.match(/^(?:[-*]\s+|(?:\d+|[A-Za-z])[.)]\s+)(.+)$/)
    if (listMatch) {
      flushParagraph()
      flushQuote()
      const ordered = !/^[-*]\s+/.test(trimmed)
      if (!list || list.ordered !== ordered) flushList()
      list = list ?? { ordered, items: [] }
      list.items.push(listMatch[1])
      continue
    }

    flushList()
    flushQuote()
    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()
  flushQuote()
  return blocks
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  )
}

function FormattedAgentMessage({ text }: { text: string }) {
  const blocks = parseFormattedText(text)
  return (
    <div className="agentFormattedMessage">
      {blocks.map((block, index) => {
        if (block.type === 'quote') return <blockquote key={index}>{renderInline(block.text)}</blockquote>
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul'
          return (
            <ListTag key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
            </ListTag>
          )
        }
        return <p key={index}>{renderInline(block.text)}</p>
      })}
    </div>
  )
}

export function AgentPanel({
  onReview,
  onCreateReminder,
}: {
  onReview: (review: AgentReviewResult | null) => void
  onCreateReminder?: (input: MaintenanceReminderInput) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [visualization, setVisualization] = useState<AgentVisualization | null>(null)
  const [clarify, setClarify] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reminderDueDate, setReminderDueDate] = useState('')
  const [reminderBusy, setReminderBusy] = useState(false)
  const [reminderMessage, setReminderMessage] = useState<string | null>(null)

  async function submit() {
    if (busy || text.trim().length === 0) return

    const prompt = text.trim()

    setError(null)
    setResult(null)
    setVisualization(null)
    setClarify(null)
    setReminderMessage(null)

    if (isCapabilitiesQuestion(prompt)) {
      setCapabilitiesOpen(true)
      setText('')
      onReview(null)
      return
    }

    setBusy(true)
    try {
      const out = await api<AgentResult>(
        '/api/agent/ingest',
        {
          method: 'POST',
          body: JSON.stringify({ text: prompt }),
        },
      )
      if (out.status === 'needs_clarification') {
        onReview(null)
        setClarify(out.message)
      } else {
        setResult(out.message)
        setVisualization(out.visualization ?? out.chart ?? null)
        setText('')
        onReview(null)
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveResponseAsReminder() {
    if (!result || !onCreateReminder || reminderBusy) return

    setReminderBusy(true)
    setReminderMessage(null)
    setError(null)
    try {
      const firstLine = result.split(/\r?\n/).map((line) => line.replace(/^(?:[-*]|\d+[.)]|[A-Za-z][.)])\s+/, '').trim()).find(Boolean)
      await onCreateReminder({
        title: firstLine?.slice(0, 120) || 'Agent Helper maintenance reminder',
        notes: result,
        dueDate: reminderDueDate || undefined,
        relatedRecordIds: [],
        source: 'agent',
      })
      setReminderDueDate('')
      setReminderMessage('Reminder saved.')
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setReminderBusy(false)
    }
  }

  return (
    <div className="agent">
      <details className="agentCapabilities" open={capabilitiesOpen} onToggle={(e) => setCapabilitiesOpen(e.currentTarget.open)}>
        <summary className="agentCapabilitiesSummary">What can Agent Helper do?</summary>
        <div className="callout ok">
          <FormattedAgentMessage text={localCapabilitiesMessage()} />
        </div>
      </details>
      <div className="agentInput">
        <textarea
          className="textarea"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder="Ask Agent Helper about saved records or dahlia care..."
          rows={7}
        />
        <div className="agentInputFooter">
          <button className="btn" disabled={busy || text.trim().length === 0} onClick={() => void submit()}>
            Send To Agent Helper
          </button>
          <div className="muted agentShortcut">Press Ctrl+Enter to send.</div>
        </div>
      </div>
      {clarify ? <div className="callout warn"><FormattedAgentMessage text={clarify} /></div> : null}
      {result ? <div className="callout ok"><FormattedAgentMessage text={result} /></div> : null}
      {result && onCreateReminder ? (
        <div className="agentReminderSave">
          <label className="field">
            <div className="label">Reminder due date</div>
            <input className="input" type="date" value={reminderDueDate} onChange={(e) => setReminderDueDate(e.target.value)} />
          </label>
          <button className="btn ghost compact" type="button" disabled={reminderBusy} onClick={() => void saveResponseAsReminder()}>
            {reminderBusy ? 'Saving...' : 'Save Response As Reminder'}
          </button>
          {reminderMessage ? <div className="settingHint success">{reminderMessage}</div> : null}
        </div>
      ) : null}
      {visualization ? (
        <Suspense fallback={<div className="callout ok">Loading visualization...</div>}>
          <AgentVisualizationView visualization={visualization} />
        </Suspense>
      ) : null}
      {error ? <div className="callout err">{error}</div> : null}
    </div>
  )
}
