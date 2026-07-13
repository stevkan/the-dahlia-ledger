import { useState } from 'react'
import type { AgentPhotoIdentificationResult, AgentPhotoSuggestion } from '../types'

function formatConfidence(confidence: number) {
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100)
  return `${pct}% confident`
}

function PhotoIdentifySuggestionCard({ suggestion, onEnlarge }: { suggestion: AgentPhotoSuggestion; onEnlarge: (url: string) => void }) {
  return (
    <div className="photoIdentifyCard">
      {suggestion.thumbnailUrl ? (
        <button className="photoPreviewButton" type="button" onClick={() => onEnlarge(suggestion.thumbnailUrl!)}>
          <img className="photoPreview" src={suggestion.thumbnailUrl} alt={suggestion.name} loading="lazy" decoding="async" />
        </button>
      ) : (
        <div className="photoPlaceholder photoIdentifyPlaceholder">No saved photo</div>
      )}
      <div className="photoIdentifyInfo">
        <div className="photoIdentifyName">{suggestion.name}</div>
        <div className="photoIdentifyConfidence">{formatConfidence(suggestion.confidence)}</div>
        {suggestion.notes ? <div className="photoIdentifyNotes">{suggestion.notes}</div> : null}
      </div>
    </div>
  )
}

export function PhotoIdentifyResultsModal({ result, onClose }: { result: AgentPhotoIdentificationResult; onClose: () => void }) {
  const [enlargedUrl, setEnlargedUrl] = useState<string | null>(null)

  return (
    <div className="photoIdentifyOverlay" role="dialog" aria-modal="true" aria-label="Flower identification results">
      <div className="photoViewerModal photoIdentifyModal">
        <div className="photoViewerHeader">
          <div>
            <div className="modalTitle">Identification Results</div>
            {result.status === 'answer' ? <div className="photoHint">Compared against your saved cultivar photos, most similar first.</div> : null}
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="photoViewerBody photoIdentifyBody">
          {result.status === 'needs_clarification' ? (
            <div className="callout warn">{result.message}</div>
          ) : result.suggestions.length === 0 ? (
            <div className="callout warn">No close matches were found among your saved cultivar photos.</div>
          ) : (
            <>
              {result.caveats?.length ? (
                <div className="callout warn photoIdentifyCaveats">
                  {result.caveats.map((caveat, index) => <div key={index}>{caveat}</div>)}
                </div>
              ) : null}
              <div className="photoIdentifyGrid">
                {result.suggestions.map((suggestion, index) => (
                  <PhotoIdentifySuggestionCard key={`${suggestion.name}-${index}`} suggestion={suggestion} onEnlarge={setEnlargedUrl} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {enlargedUrl ? (
        <div
          className="photoViewerOverlay photoIdentifyEnlargeOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="Suggested flower photo"
          onMouseDown={() => setEnlargedUrl(null)}
        >
          <div className="photoViewerModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="photoViewerHeader">
              <div className="modalTitle">Reference Photo</div>
              <button className="btn ghost" type="button" onClick={() => setEnlargedUrl(null)}>
                Close
              </button>
            </div>
            <div className="photoViewerBody">
              <img className="photoViewerImage" src={enlargedUrl} alt="Suggested cultivar reference" decoding="async" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
