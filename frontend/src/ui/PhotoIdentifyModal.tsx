import { useRef, useState } from 'react'
import type { AgentPhotoIdentificationResult } from '../types'
import { identifyPhoto } from '../api/client'
import { PhotoIdentifyResultsModal } from './PhotoIdentifyResultsModal'

export function PhotoIdentifyModal({ onClose }: { onClose: () => void }) {
  const identifyFileInputRef = useRef<HTMLInputElement | null>(null)
  const [identifyFile, setIdentifyFile] = useState<File | null>(null)
  const [identifyPreview, setIdentifyPreview] = useState<string | null>(null)
  const [identifyBusy, setIdentifyBusy] = useState(false)
  const [identifyError, setIdentifyError] = useState<string | null>(null)
  const [identifyResult, setIdentifyResult] = useState<AgentPhotoIdentificationResult | null>(null)

  function selectIdentifyPhoto(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setIdentifyError('Please select an image file.')
      return
    }
    setIdentifyError(null)
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
                <button className="btn ghost compact" type="button" disabled={identifyBusy} onClick={() => identifyFileInputRef.current?.click()}>
                  {identifyFile ? 'Choose Different Photo' : 'Choose Photo'}
                </button>
                <button className="btn compact" type="button" disabled={!identifyFile || identifyBusy} onClick={() => void submitIdentifyPhoto()}>
                  {identifyBusy ? 'Identifying...' : 'Identify Photo'}
                </button>
                {identifyFile ? (
                  <button className="btn ghost compact" type="button" disabled={identifyBusy} onClick={cancelIdentifyPhoto}>
                    Cancel
                  </button>
                ) : null}
              </div>
              <input
                ref={identifyFileInputRef}
                className="fileInput"
                type="file"
                accept="image/*,.heic,.heif"
                onChange={(e) => selectIdentifyPhoto(e.target.files?.[0])}
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
