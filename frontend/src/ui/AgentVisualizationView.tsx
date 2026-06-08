import { interpolateMagma, scaleLinear, scalePoint, scaleSequential } from 'd3'
import type { AgentVisualization } from '../types'

const CHART_COLORS = ['#a855f7', '#ec4899', '#f97316', '#22c55e', '#06b6d4', '#eab308', '#64748b']

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function numericValue(row: Record<string, unknown>, key?: string) {
  const value = key ? row[key] : undefined
  if (isFiniteNumber(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function textValue(row: Record<string, unknown>, key?: string, fallback = '') {
  const value = key ? row[key] : undefined
  return value == null || value === '' ? fallback : String(value)
}

function labelFromKey(key?: string, unit?: string) {
  const label = String(key ?? 'value')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
  return unit ? `${label} (${unit})` : label
}

type VisualizationRowClick = (row: Record<string, unknown>) => void

function MetricTable({ visualization, onRowClick }: { visualization: AgentVisualization; onRowClick?: VisualizationRowClick }) {
  const data = visualization.data ?? []
  if (data.length === 0) return null

  const columns = Array.from(new Set(data.flatMap((row) => Object.keys(row))))

  return (
    <div className="agentChartTableWrap">
      <table className="table agentChartTable">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={index} className={onRowClick ? 'clickableRow' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StandardMetricChart({ visualization, onRowClick }: { visualization: AgentVisualization; onRowClick?: VisualizationRowClick }) {
  const xKey = visualization.xKey ?? visualization.labelKey ?? 'label'
  const yKey = visualization.yKey ?? visualization.valueKey ?? 'value'
  const xAxisLabel = labelFromKey(xKey)
  const yAxisLabel = labelFromKey(yKey, visualization.unit)
  const data = (visualization.data ?? []).map((row, index) => ({ row, label: textValue(row, xKey, `Item ${index + 1}`), value: numericValue(row, yKey) ?? 0 }))
  const width = 760
  const usesCompanyXAxis = xKey.toLowerCase().includes('company')
  const xLabelAngle = typeof visualization.xLabelAngle === 'number' ? visualization.xLabelAngle : usesCompanyXAxis ? -90 : 0
  const hasRotatedLabels = xLabelAngle !== 0
  const usesNumericXAxis = visualization.type === 'scatter' && data.every((row) => Number.isFinite(Number(row.label)))
  const xTickLabelSpace = hasRotatedLabels ? 118 : usesNumericXAxis ? 22 : 34
  const xAxisLabelSpace = 34
  const height = 300 + xTickLabelSpace + xAxisLabelSpace
  const margin = { top: 24, right: 28, bottom: xTickLabelSpace + xAxisLabelSpace, left: 64 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const maxValue = Math.max(...data.map((row) => row.value), 1)
  const xScale = scalePoint(data.map((row) => row.label), [margin.left + 18, margin.left + plotWidth - 18]).padding(0.5)
  const yScale = scaleLinear([0, maxValue], [margin.top + plotHeight, margin.top])

  if (data.length === 0) return null

  if (visualization.type === 'pie') {
    const total = data.reduce((sum, row) => sum + row.value, 0) || 1
    let startAngle = -Math.PI / 2
    const centerX = width / 2
    const centerY = height / 2 - 8
    const radius = 112

    return (
      <svg className="agentChartSvg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={visualization.title ?? 'Metric pie chart'}>
        {data.map((row, index) => {
          const angle = (row.value / total) * Math.PI * 2
          const endAngle = startAngle + angle
          const largeArc = angle > Math.PI ? 1 : 0
          const x1 = centerX + Math.cos(startAngle) * radius
          const y1 = centerY + Math.sin(startAngle) * radius
          const x2 = centerX + Math.cos(endAngle) * radius
          const y2 = centerY + Math.sin(endAngle) * radius
          const labelAngle = startAngle + angle / 2
          const labelX = centerX + Math.cos(labelAngle) * (radius + 48)
          const labelY = centerY + Math.sin(labelAngle) * (radius + 48)
          startAngle = endAngle
          return (
            <g key={row.label} className={onRowClick ? 'agentChartClickable' : undefined} onClick={onRowClick ? () => onRowClick(row.row) : undefined}>
              <path d={`M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`} fill={CHART_COLORS[index % CHART_COLORS.length]}>
                <title>{`${row.label}: ${row.value}`}</title>
              </path>
              <text className="agentChartTick" x={labelX} y={labelY} textAnchor="middle">{`${row.label}: ${row.value}`}</text>
            </g>
          )
        })}
      </svg>
    )
  }

  const points = data.map((row) => ({ ...row, x: xScale(row.label) ?? margin.left, y: yScale(row.value) }))
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

  return (
    <svg className="agentChartSvg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={visualization.title ?? 'Metric chart'}>
      <line className="agentChartAxis" x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotHeight} />
      <line className="agentChartAxis" x1={margin.left} x2={margin.left + plotWidth} y1={margin.top + plotHeight} y2={margin.top + plotHeight} />
      {[0, 0.5, 1].map((tick) => {
        const value = maxValue * tick
        const y = yScale(value)
        return (
          <g key={tick}>
            <line className="agentChartGrid" x1={margin.left} x2={margin.left + plotWidth} y1={y} y2={y} />
            <text className="agentChartTick" x={margin.left - 10} y={y + 4} textAnchor="end">{value.toFixed(value % 1 === 0 ? 0 : 1)}</text>
          </g>
        )
      })}
      {visualization.type === 'line' ? <path className="agentChartLine" d={linePath} /> : null}
      {points.map((point) => {
        const barWidth = Math.max(14, Math.min(52, plotWidth / points.length - 10))
        return (
          <g key={point.label} className={onRowClick ? 'agentChartClickable' : undefined} onClick={onRowClick ? () => onRowClick(point.row) : undefined}>
            {visualization.type === 'bar' || !visualization.type ? <rect className="agentChartBar" x={point.x - barWidth / 2} y={point.y} width={barWidth} height={margin.top + plotHeight - point.y} rx="5" /> : null}
            {visualization.type === 'line' || visualization.type === 'scatter' ? <circle className="agentChartPoint" cx={point.x} cy={point.y} r="5" /> : null}
            <text className="agentChartValue" x={point.x} y={point.y - 8} textAnchor="middle">{point.value}</text>
            <text
              className="agentChartTick"
              x={point.x}
              y={margin.top + plotHeight + (usesNumericXAxis ? 20 : 22)}
              textAnchor={hasRotatedLabels ? 'end' : 'middle'}
              transform={hasRotatedLabels ? `rotate(${xLabelAngle} ${point.x} ${margin.top + plotHeight + 22})` : undefined}
            >
              {hasRotatedLabels ? point.label : usesNumericXAxis ? point.label : point.label.length > 12 ? `${point.label.slice(0, 11)}...` : point.label}
            </text>
          </g>
        )
      })}
      <text className="agentChartAxisLabel" x={margin.left + plotWidth / 2} y={margin.top + plotHeight + xTickLabelSpace + 12} textAnchor="middle">{xAxisLabel}</text>
      <text className="agentChartAxisLabel" x={16} y={margin.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 16 ${margin.top + plotHeight / 2})`}>{yAxisLabel}</text>
    </svg>
  )
}

function D3GardenMap({ visualization }: { visualization: AgentVisualization }) {
  const data = visualization.data ?? []
  const areaKey = visualization.seriesKey ?? 'gardenArea'
  const rowKey = visualization.yKey ?? 'gardenRow'
  const positionKey = visualization.xKey ?? 'gardenPosition'
  const labelKey = visualization.labelKey ?? 'flowerName'
  const valueKey = visualization.valueKey ?? 'value'
  const width = 760
  const height = 340
  const margin = { top: 28, right: 24, bottom: 34, left: 78 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const rows = Array.from(new Set(data.map((row) => textValue(row, rowKey, 'Unassigned'))))
  const positions = data.map((row, index) => numericValue(row, positionKey) ?? index + 1)
  const maxPosition = Math.max(...positions, 1)
  const xScale = scaleLinear([1, maxPosition], [margin.left + 18, margin.left + plotWidth - 18])
  const yScale = scalePoint(rows, [margin.top + 18, margin.top + plotHeight - 18]).padding(0.5)
  const values = data.map((row) => numericValue(row, valueKey) ?? 1)
  const colorScale = scaleSequential(interpolateMagma).domain([Math.max(...values, 1), 0])

  if (data.length === 0) return null

  return (
    <svg className="agentChartSvg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={visualization.title ?? 'Garden metric map'}>
      {rows.map((row) => {
        const y = yScale(row) ?? margin.top
        return (
          <g key={row}>
            <line className="agentChartGrid" x1={margin.left} x2={margin.left + plotWidth} y1={y} y2={y} />
            <text className="agentChartTick" x={margin.left - 10} y={y + 4} textAnchor="end">{row}</text>
          </g>
        )
      })}
      {data.map((row, index) => {
        const x = xScale(numericValue(row, positionKey) ?? index + 1)
        const y = yScale(textValue(row, rowKey, 'Unassigned')) ?? margin.top
        const value = numericValue(row, valueKey) ?? 1
        const area = textValue(row, areaKey)
        const label = textValue(row, labelKey, `Plant ${index + 1}`)
        return (
          <g key={`${label}-${index}`}>
            <circle className="agentGardenPoint" cx={x} cy={y} r={Math.max(8, Math.min(20, 8 + value))} fill={colorScale(value)}>
              <title>{[area, label, `${valueKey}: ${value}`].filter(Boolean).join(' - ')}</title>
            </circle>
            <text className="agentChartTick" x={x} y={y + 32} textAnchor="middle">{label.length > 10 ? `${label.slice(0, 9)}...` : label}</text>
          </g>
        )
      })}
      <text className="agentChartAxisLabel" x={margin.left + plotWidth / 2} y={height - 8} textAnchor="middle">{labelFromKey(positionKey)}</text>
      <text className="agentChartAxisLabel" x={16} y={margin.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 16 ${margin.top + plotHeight / 2})`}>{labelFromKey(rowKey)}</text>
    </svg>
  )
}

export function AgentVisualizationView({ visualization, onRowClick }: { visualization: AgentVisualization; onRowClick?: VisualizationRowClick }) {
  const type = visualization.type ?? 'table'
  const renderer = visualization.renderer ?? (type === 'garden-map' ? 'd3' : type === 'table' ? 'table' : 'd3')

  return (
    <div className="agentChart">
      {visualization.title ? <div className="agentChartTitle">{visualization.title}</div> : null}
      {visualization.description ? <div className="muted agentChartDescription">{visualization.description}</div> : null}
      {renderer === 'table' || type === 'table' ? <MetricTable visualization={visualization} onRowClick={onRowClick} /> : null}
      {renderer === 'd3' && type === 'garden-map' ? <D3GardenMap visualization={visualization} /> : null}
      {(renderer === 'recharts' || renderer === 'd3') && type !== 'table' && type !== 'garden-map' ? <StandardMetricChart visualization={visualization} onRowClick={onRowClick} /> : null}
    </div>
  )
}
