import { useEffect, useRef, useState } from 'react'

export function ColorsModal({
  colors,
  onClose,
  onRenameColor,
}: {
  colors: string[]
  onClose: () => void
  onRenameColor: (oldColor: string, newColor: string) => Promise<void>
}) {
  const [editingColor, setEditingColor] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mergeConfirm, setMergeConfirm] = useState(false)
  const [search, setSearch] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editingColor !== null) editInputRef.current?.focus()
  }, [editingColor])

  function startEdit(color: string) {
    setEditingColor(color)
    setEditValue(color)
    setError(null)
  }

  function cancelEdit() {
    setEditingColor(null)
    setEditValue('')
    setError(null)
    setMergeConfirm(false)
  }

  async function saveEdit() {
    const trimmed = editValue.trim()
    if (!editingColor || !trimmed || trimmed === editingColor) {
      cancelEdit()
      return
    }
    if (!mergeConfirm && colors.includes(trimmed)) {
      setMergeConfirm(true)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onRenameColor(editingColor, trimmed)
      setEditingColor(null)
      setEditValue('')
      setMergeConfirm(false)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const filtered = colors.filter((color) => color.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="modalOverlay stackedModalOverlay">
      <div className="modal modalNarrow">
        <div className="modalHeader">
          <div>
            <div className="modalTitle">Colors</div>
            <div className="modalSub">Rename a color to update it across all records.</div>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="modalBody flowerNamesModalBody">
          <input
            className="input"
            type="search"
            placeholder="Search colors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {error ? <div className="error inlineError">{error}</div> : null}
          {filtered.length ? (
            <div className="flowerNamesList">
              {filtered.map((color) => (
                <div className="flowerNameRow" key={color}>
                  {editingColor === color ? (
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
                          <button className="btn ghost compact" type="button" disabled={saving || editValue === editingColor} onClick={cancelEdit}>
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
                      <span className="flowerNameText">{color}</span>
                      <button className="btn ghost compact" type="button" disabled={editingColor !== null} onClick={() => startEdit(color)}>
                        Edit
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">{search ? 'No matching colors.' : 'No colors found.'}</div>
          )}
        </div>
      </div>
    </div>
  )
}
