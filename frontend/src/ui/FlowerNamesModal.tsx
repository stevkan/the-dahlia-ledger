import { useEffect, useRef, useState } from 'react'

export function FlowerNamesModal({
  flowerNames,
  onClose,
  onRenameFlowerName,
}: {
  flowerNames: string[]
  onClose: () => void
  onRenameFlowerName: (oldName: string, newName: string) => Promise<void>
}) {
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mergeConfirm, setMergeConfirm] = useState(false)
  const [search, setSearch] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editingName !== null) editInputRef.current?.focus()
  }, [editingName])

  function startEdit(name: string) {
    setEditingName(name)
    setEditValue(name)
    setError(null)
  }

  function cancelEdit() {
    setEditingName(null)
    setEditValue('')
    setError(null)
    setMergeConfirm(false)
  }

  async function saveEdit() {
    const trimmed = editValue.trim()
    if (!editingName || !trimmed || trimmed === editingName) {
      cancelEdit()
      return
    }
    if (!mergeConfirm && flowerNames.includes(trimmed)) {
      setMergeConfirm(true)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onRenameFlowerName(editingName, trimmed)
      setEditingName(null)
      setEditValue('')
      setMergeConfirm(false)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const filtered = flowerNames.filter((name) => name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="modalOverlay stackedModalOverlay">
      <div className="modal modalNarrow">
        <div className="modalHeader">
          <div>
            <div className="modalTitle">Flower Names</div>
            <div className="modalSub">Rename a flower name to update it across all records and invoice items.</div>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="modalBody flowerNamesModalBody">
          <input
            className="input"
            type="search"
            placeholder="Search flower names..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {error ? <div className="error inlineError">{error}</div> : null}
          {filtered.length ? (
            <div className="flowerNamesList">
              {filtered.map((name) => (
                <div className="flowerNameRow" key={name}>
                  {editingName === name ? (
                    <div className="flowerNameEditArea">
                      <div className="flowerNameEditRow">
                        <input
                          ref={editInputRef}
                          className="input flowerNameEditInput"
                          value={editValue}
                          onChange={(e) => { setEditValue(e.target.value); setMergeConfirm(false) }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveEdit()
                            if (e.key === 'Escape') cancelEdit()
                          }}
                        />
                        <div className="rowActions">
                          {mergeConfirm ? (
                            <button className="btn compact danger" type="button" disabled={saving} onClick={() => void saveEdit()}>
                              {saving ? 'Saving...' : 'Merge'}
                            </button>
                          ) : (
                            <button className="btn compact" type="button" disabled={saving || !editValue.trim()} onClick={() => void saveEdit()}>
                              {saving ? 'Saving...' : 'Save'}
                            </button>
                          )}
                          <button className="btn ghost compact" type="button" disabled={saving} onClick={cancelEdit}>
                            Cancel
                          </button>
                        </div>
                      </div>
                      {mergeConfirm ? (
                        <div className="flowerNameMergeWarning">
                          "{editValue.trim()}" already exists. Saving will merge both into one.
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <span className="flowerNameText">{name}</span>
                      <button className="btn ghost compact" type="button" disabled={editingName !== null} onClick={() => startEdit(name)}>
                        Edit
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">{search ? 'No matching flower names.' : 'No flower names found.'}</div>
          )}
        </div>
      </div>
    </div>
  )
}
