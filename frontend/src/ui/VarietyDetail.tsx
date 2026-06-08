import type { DahliaRecord } from '../types'

function varietyKey(record: DahliaRecord) {
  return (record.core?.cultivar || record.flowerName).trim().toLowerCase()
}

function varietyName(record: DahliaRecord) {
  return (record.core?.cultivar || record.flowerName).trim() || 'Unnamed Variety'
}

function formatLocation(record: DahliaRecord) {
  const state = record.meta?.plantingState ?? 'purchased_container'
  if (state === 'purchased_container') return 'Purchased Container'
  if (state === 'garden_tray') return 'Garden Tray'
  if (state === 'not_planted') return 'Not Planted'
  if (state === 'not_viable') return 'Not Viable'

  const rowAndPosition = record.meta?.gardenRow && record.meta?.gardenPosition ? `${record.meta.gardenRow}${record.meta.gardenPosition}` : record.gardenLocation
  return [record.meta?.gardenArea, rowAndPosition].filter(Boolean).join(' - ') || 'In Garden'
}

export function VarietyDetail({
  records,
  selectedKey,
  onSelectKey,
  onOpenRecord,
}: {
  records: DahliaRecord[]
  selectedKey: string | null
  onSelectKey: (key: string) => void
  onOpenRecord: (record: DahliaRecord) => void
}) {
  const varieties = Array.from(
    records.reduce((map, record) => {
      const key = varietyKey(record)
      const existing = map.get(key)
      if (existing) {
        existing.records.push(record)
      } else {
        map.set(key, { key, name: varietyName(record), records: [record] })
      }
      return map
    }, new Map<string, { key: string; name: string; records: DahliaRecord[] }>()).values(),
  ).sort((a, b) => a.name.localeCompare(b.name))

  const selected = varieties.find((variety) => variety.key === selectedKey) ?? varieties[0]

  if (!selected) {
    return <div className="empty">No varieties available.</div>
  }

  return (
    <div className="varietyDetail">
      <div className="varietyList" aria-label="Flower varieties">
        {varieties.map((variety) => (
          <button
            key={variety.key}
            className={`varietyButton${variety.key === selected.key ? ' active' : ''}`}
            type="button"
            onClick={() => onSelectKey(variety.key)}
          >
            <span>{variety.name}</span>
            <span>{variety.records.length}</span>
          </button>
        ))}
      </div>

      <div className="varietyRecords">
        <div className="varietyDetailHeader">
          <div>
            <div className="modalTitle">{selected.name}</div>
            <div className="modalSub">{selected.records.length} associated tuber{selected.records.length === 1 ? '' : 's'} or plant{selected.records.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        <div className="tableWrap miniTable">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Flower Name</th>
                <th>Location</th>
                <th>Season</th>
              </tr>
            </thead>
            <tbody>
              {selected.records.map((record) => (
                <tr key={record.id} className="row" onClick={() => onOpenRecord(record)}>
                  <td>{record.recordNumber}</td>
                  <td>{record.flowerName}</td>
                  <td>{formatLocation(record)}</td>
                  <td>{record.seasonYearStart}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
