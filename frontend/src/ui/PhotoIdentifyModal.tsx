import { useRef, useState } from 'react'
import type { AgentPhotoIdentificationResult } from '../types'
import { identifyPhoto } from '../api/client'
import { PhotoIdentifyResultsModal } from './PhotoIdentifyResultsModal'

export function PhotoIdentifyModal({ onClose }: { onClose: () => void }) {
  const identifyFileInputRef = useRef<HTMLInputElement | null>(null)
  const [identifyFile, setIdentifyFile] = useState<File | null>(null)
  const [identifyPreview, setIdentifyPreview] = useState<string | null>(null)
  const [identifyConverting, setIdentifyConverting] = useState(false)
  const [identifyBusy, setIdentifyBusy] = useState(false)
  const [identifyError, setIdentifyError] = useState<string | null>(null)
  const [identifyResult, setIdentifyResult] = useState<AgentPhotoIdentificationResult | null>(null)

  async function selectIdentifyPhoto(file: File | undefined) {
    if (!file) return
    const isHeic = file.type === 'image/heic' || file.type === 'image/heif' || /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name)
    if (!file.type.startsWith('image/') && !isHeic) {
      setIdentifyError('Please select an image file.')
      return
    }

    setIdentifyError(null)

    if (isHeic) {
      setIdentifyConverting(true)
      try {
        const { heicTo } = await import('heic-to')
        const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 })
        const convertedName = file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg')
        const convertedFile = new File([jpeg], convertedName, { type: 'image/jpeg' })
        setIdentifyFile(convertedFile)
        setIdentifyPreview((previous) => {
          if (previous) URL.revokeObjectURL(previous)
          return URL.createObjectURL(jpeg)
        })
      } catch {
        setIdentifyError('Could not convert HEIC file. Please try a different photo format.')
      } finally {
        setIdentifyConverting(false)
      }
      return
    }

    setIdentifyFile(file)
    setIdentifyPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return URL.createObjectURL(file)
    })
  }

  function cancelIdentifyPhoto() {
    setIdentifyFile(null)
    setIdentifyPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return null
    })
    setIdentifyError(null)
    if (identifyFileInputRef.current) identifyFileInputRef.current.value = ''
  }

  async function submitIdentifyPhoto() {
    if (!identifyFile || identifyBusy) return

    setIdentifyBusy(true)
    setIdentifyError(null)
    try {
      const out = await identifyPhoto({ file: identifyFile })
      setIdentifyResult(out)
    } catch (e: any) {
      setIdentifyError(e?.message ?? String(e))
    } finally {
      setIdentifyBusy(false)
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="photo-identify-title">
      <div className="modal modalNarrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <div className="modalTitle" id="photo-identify-title">Identify A Flower Photo From Collection</div>
            <div className="modalSub">Upload a photo to compare against your saved cultivar photos.</div>
          </div>
          <button className="btn ghost compact" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modalBody">
          <div className="agentPhotoIdentify">
            <div className="agentPhotoIdentifyRow">
              {identifyPreview ? (
                <img className="agentPhotoIdentifyPreview" src={identifyPreview} alt="Selected photo to identify" />
              ) : (
                <div className="photoPlaceholder agentPhotoIdentifyPreview">No photo selected</div>
              )}
              <div className="agentPhotoIdentifyActions">
                <button className="btn ghost compact" type="button" disabled={identifyBusy || identifyConverting} onClick={() => identifyFileInputRef.current?.click()}>
                  {identifyFile ? 'Choose Different Photo' : 'Choose Photo'}
                </button>
                <button className="btn compact" type="button" disabled={!identifyFile || identifyBusy || identifyConverting} onClick={() => void submitIdentifyPhoto()}>
                  {identifyConverting ? 'Converting...' : identifyBusy ? 'Identifying...' : 'Identify Photo'}
                </button>
                {identifyFile ? (
                  <button className="btn ghost compact" type="button" disabled={identifyBusy || identifyConverting} onClick={cancelIdentifyPhoto}>
                    Cancel
                  </button>
                ) : null}
              </div>
              <input
                ref={identifyFileInputRef}
                className="fileInput"
                type="file"
                accept="image/*,.heic,.heif"
                onChange={(e) => void selectIdentifyPhoto(e.target.files?.[0])}
              />
            </div>
            {identifyError ? <div className="error inlineError">{identifyError}</div> : null}
          </div>
        </div>
      </div>
      {identifyResult ? (
        <PhotoIdentifyResultsModal result={identifyResult} onBack={() => setIdentifyResult(null)} onClose={onClose} />
      ) : null}
    </div>
  )
}
