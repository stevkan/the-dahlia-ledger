import { useState, type CSSProperties } from 'react'
import type { ExcelImportResult, RecordDrift } from '../types'

type Theme = 'dark' | 'light'
type SettingsBlade = 'appearance' | 'imports' | 'account' | 'firebaseToken' | 'dataAudit'

const DATA_AUDIT_PAGE_SIZE = 25

function formatDriftValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(empty)'
  return String(value)
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="modalOverlay">
      <div className="modal settingsModal">
        {children}
      </div>
    </div>
  )
}

export function SettingsModal({
  initialBlade,
  theme,
  onToggleTheme,
  showFileImports,
  oneNoteImporting,
  oneNoteImportProgress,
  oneNoteImportMessage,
  onImportOneNote,
  excelImporting,
  excelImportProgress,
  excelImportResult,
  excelImportSummary,
  onImportExcel,
  excelReverting,
  excelRevertMessage,
  onRevertExcel,
  signedInAs,
  onSignOut,
  isGlobalAdmin,
  appCheckDebugToken,
  appCheckDebugTokenLoading,
  appCheckDebugTokenGenerating,
  onGenerateAppCheckDebugToken,
  driftRecords,
  driftLoading,
  driftError,
  onRefreshDrift,
  onMarkReviewed,
  onOpenDriftedRecord,
  onClose,
}: {
  initialBlade: SettingsBlade
  theme: Theme
  onToggleTheme: () => void
  showFileImports: boolean
  oneNoteImporting: boolean
  oneNoteImportProgress: number
  oneNoteImportMessage: string | null
  onImportOneNote: (file: File | undefined) => void
  excelImporting: boolean
  excelImportProgress: number
  excelImportResult: ExcelImportResult | null
  excelImportSummary: (result: ExcelImportResult) => string
  onImportExcel: (file: File | undefined) => void
  excelReverting: boolean
  excelRevertMessage: string | null
  onRevertExcel: () => void
  signedInAs: string
  onSignOut: () => void
  isGlobalAdmin: boolean
  appCheckDebugToken: string | null
  appCheckDebugTokenLoading: boolean
  appCheckDebugTokenGenerating: boolean
  onGenerateAppCheckDebugToken: () => void
  driftRecords: RecordDrift[]
  driftLoading: boolean
  driftError: string | null
  onRefreshDrift: () => void
  onMarkReviewed: (id: string) => void
  onOpenDriftedRecord: (id: string) => void
  onClose: () => void
}) {
  const [blade, setBlade] = useState<SettingsBlade>(initialBlade)
  const activeBlade: SettingsBlade =
    (blade === 'imports' && !showFileImports)
    || (blade === 'firebaseToken' && !isGlobalAdmin)
    || (blade === 'dataAudit' && !isGlobalAdmin)
      ? 'appearance'
      : blade

  const [driftPage, setDriftPage] = useState(0)
  const driftPageCount = Math.max(1, Math.ceil(driftRecords.length / DATA_AUDIT_PAGE_SIZE))
  const clampedDriftPage = Math.min(driftPage, driftPageCount - 1)
  const pagedDriftRecords = driftRecords.slice(
    clampedDriftPage * DATA_AUDIT_PAGE_SIZE,
    (clampedDriftPage + 1) * DATA_AUDIT_PAGE_SIZE,
  )

  function renderAppearance() {
    return (
      <div className="settingsBladeSection">
        <div className="subTitle">Appearance</div>
        <div className="appearanceSetting" role="group" aria-label="Appearance setting">
          <span>Theme</span>
          <button
            className={`switchToggle ${theme === 'light' ? 'on' : ''}`}
            type="button"
            role="switch"
            aria-checked={theme === 'light'}
            aria-label="Use light theme"
            onClick={onToggleTheme}
          >
            <span className="switchTrack">
              <span className="switchLabel">{theme === 'light' ? 'Light' : 'Dark'}</span>
              <span className="switchThumb" />
            </span>
          </button>
        </div>
      </div>
    )
  }

  function renderFileImports() {
    return (
      <div className="settingsBladeSection">
        <div className="subTitle">File Imports</div>
        <div className="oneNoteImportSetting">
          <div>
            <div className="settingTitle">OneNote Import</div>
            <div className="settingHint">Upload a Single File Web Page (.mht) export.</div>
          </div>
          <label
            className={`btn ghost compact importFileButton ${oneNoteImporting ? 'disabled importing' : ''}`}
            style={{ '--import-progress': `${oneNoteImportProgress}%` } as CSSProperties}
            aria-disabled={oneNoteImporting}
          >
            <span>{oneNoteImporting ? `Importing ${oneNoteImportProgress}%` : 'Import data from OneNote'}</span>
            <input
              type="file"
              accept=".mht,.mhtml"
              disabled={oneNoteImporting}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                onImportOneNote(file)
              }}
            />
          </label>
          {oneNoteImportMessage ? <div className="settingHint success">{oneNoteImportMessage}</div> : null}
        </div>
        <div className="oneNoteImportSetting">
          <div>
            <div className="settingTitle">Excel Import</div>
            <div className="settingHint">Upload the 2026 garden location spreadsheet.</div>
          </div>
          <label
            className={`btn ghost compact importFileButton ${excelImporting ? 'disabled importing' : ''}`}
            style={{ '--import-progress': `${excelImportProgress}%` } as CSSProperties}
            aria-disabled={excelImporting}
          >
            <span>{excelImporting ? `Importing ${excelImportProgress}%` : 'Import data from Excel'}</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={excelImporting}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                onImportExcel(file)
              }}
            />
          </label>
          {excelImportResult ? (
            <div className="excelImportSummary">
              <div className="settingHint success">{excelImportSummary(excelImportResult)}</div>
              {excelImportResult.canRevert ? (
                <button className="btn ghost compact" type="button" disabled={excelReverting} onClick={onRevertExcel}>
                  {excelReverting ? 'Reverting Excel import...' : 'Revert latest Excel import'}
                </button>
              ) : null}
              {excelImportResult.priorSeasonMissing.length ? (
                <div className="settingHint">Prior seasons only: {excelImportResult.priorSeasonMissing.slice(0, 5).map((entry) => `${entry.excelName} (${entry.gardenLocation})`).join(', ')}</div>
              ) : null}
              {excelImportResult.ambiguous.length ? (
                <div className="settingHint">Ambiguous: {excelImportResult.ambiguous.slice(0, 5).map((entry) => `${entry.excelName} (${entry.gardenLocation})`).join(', ')}</div>
              ) : null}
              {excelImportResult.unmatched.length ? (
                <div className="settingHint">Unmatched: {excelImportResult.unmatched.slice(0, 5).map((entry) => `${entry.excelName} (${entry.gardenLocation})`).join(', ')}</div>
              ) : null}
              {excelImportResult.skipped.length ? (
                <div className="settingHint">Skipped: {excelImportResult.skipped.slice(0, 5).map((entry) => `${entry.excelName} (${entry.gardenLocation})`).join(', ')}</div>
              ) : null}
            </div>
          ) : null}
          {excelRevertMessage ? <div className="settingHint success">{excelRevertMessage}</div> : null}
        </div>
      </div>
    )
  }

  async function copyAppCheckDebugToken() {
    if (!appCheckDebugToken) return
    try {
      await navigator.clipboard?.writeText(appCheckDebugToken)
    } catch {
      // Ignore clipboard failures; the value is still visible to copy manually.
    }
  }

  function renderAccount() {
    return (
      <div className="settingsBladeSection">
        <div className="subTitle">Account</div>
        <div className="settingsSignOut">
          <div className="signedInAs">Signed in as {signedInAs}</div>
          <button className="btn ghost compact" type="button" onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </div>
    )
  }

  function renderFirebaseToken() {
    return (
      <div className="settingsBladeSection">
        <div className="subTitle">Firebase Token</div>
        <div className="oneNoteImportSetting">
          <div>
            <div className="settingTitle">App Check Debug Token</div>
            <div className="settingHint">
              Stored in Firestore so it survives a browser cache clear. Register it once in Firebase Console → App Check → Manage debug tokens.
            </div>
          </div>
          <div className="appCheckDebugTokenRow">
            <button
              className="btn ghost compact knownUserIdButton"
              type="button"
              disabled={!appCheckDebugToken}
              aria-label="Copy App Check debug token"
              onClick={() => void copyAppCheckDebugToken()}
            >
              {appCheckDebugTokenLoading ? 'Loading...' : appCheckDebugToken ?? 'Not generated yet'}
            </button>
            <button
              className="btn ghost compact"
              type="button"
              disabled={appCheckDebugTokenGenerating}
              onClick={onGenerateAppCheckDebugToken}
            >
              {appCheckDebugTokenGenerating ? 'Generating...' : 'Generate new token'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderDataAudit() {
    return (
      <div className="settingsBladeSection">
        <div className="subTitle">Data Audit</div>
        <div className="settingHint">
          Records where the frozen pre-migration summary disagrees with the live record. Check each one against
          the actual garden, fix it in the record if needed, then mark it reviewed.
        </div>
        <div className="dataAuditToolbar">
          <button className="btn ghost compact" type="button" onClick={onRefreshDrift} disabled={driftLoading}>
            {driftLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          {driftRecords.length > 0 ? (
            <div className="dataAuditPager">
              <button
                className="btn ghost compact"
                type="button"
                disabled={clampedDriftPage === 0}
                onClick={() => setDriftPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <span className="settingHint">
                {clampedDriftPage * DATA_AUDIT_PAGE_SIZE + 1}
                –{Math.min(driftRecords.length, (clampedDriftPage + 1) * DATA_AUDIT_PAGE_SIZE)}
                {' of '}{driftRecords.length}
              </span>
              <button
                className="btn ghost compact"
                type="button"
                disabled={clampedDriftPage >= driftPageCount - 1}
                onClick={() => setDriftPage((p) => Math.min(driftPageCount - 1, p + 1))}
              >
                Next
              </button>
            </div>
          ) : null}
          {driftError ? <span className="settingHint error">{driftError}</span> : null}
        </div>
        {!driftLoading && driftRecords.length === 0 ? (
          <div className="settingHint success">No unreviewed drift found.</div>
        ) : null}
        <div className="dataAuditList">
          {pagedDriftRecords.map((drift) => (
            <div className="dataAuditEntry" key={drift.id}>
              <div className="dataAuditEntryHeader">
                <div>
                  <div className="settingTitle">#{drift.recordNumber} {drift.flowerName}</div>
                  <div className="settingHint">
                    {[drift.meta?.gardenZone, drift.gardenLocation].filter(Boolean).join(' · ') || 'No garden location recorded'}
                  </div>
                </div>
                <div className="dataAuditEntryActions">
                  <button className="btn ghost compact" type="button" onClick={() => onOpenDriftedRecord(drift.id)}>
                    Open
                  </button>
                  <button className="btn ghost compact" type="button" onClick={() => onMarkReviewed(drift.id)}>
                    Mark Reviewed
                  </button>
                </div>
              </div>
              <div className="tableWrap miniTable">
                <table className="table dataAuditTable">
                  <thead>
                    <tr>
                      <th className="colField">Field</th>
                      <th className="colSnapshotValue">Snapshot (pre-migration)</th>
                      <th className="colLiveValue">Live (current)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drift.fields.map((field) => (
                      <tr key={field.path}>
                        <td className="colField">{field.path}</td>
                        <td className="colSnapshotValue driftOldValue">{formatDriftValue(field.snapshotValue)}</td>
                        <td className="colLiveValue driftNewValue">{formatDriftValue(field.liveValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <Overlay>
      <div className="modalHeader">
        <div>
          <div className="modalTitle">Settings</div>
          <div className="modalSub">Manage appearance and data import preferences.</div>
        </div>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
      <div className={`modalBody settingsLayout${activeBlade === 'dataAudit' || activeBlade === 'firebaseToken' ? ' settingsLayoutWide' : ''}`}>
        <div className="settingsBladeList">
          <button
            className={`settingsBladeOption${activeBlade === 'account' ? ' selected' : ''}`}
            type="button"
            onClick={() => setBlade('account')}
          >
            Account
          </button>
          <button
            className={`settingsBladeOption${activeBlade === 'appearance' ? ' selected' : ''}`}
            type="button"
            onClick={() => setBlade('appearance')}
          >
            Appearance
          </button>
          {isGlobalAdmin ? (
            <button
              className={`settingsBladeOption${activeBlade === 'firebaseToken' ? ' selected' : ''}`}
              type="button"
              onClick={() => setBlade('firebaseToken')}
            >
              Firebase Token
            </button>
          ) : null}
          {isGlobalAdmin ? (
            <button
              className={`settingsBladeOption${activeBlade === 'dataAudit' ? ' selected' : ''}`}
              type="button"
              onClick={() => setBlade('dataAudit')}
            >
              Data Audit
            </button>
          ) : null}
          {showFileImports ? (
            <button
              className={`settingsBladeOption${activeBlade === 'imports' ? ' selected' : ''}`}
              type="button"
              onClick={() => setBlade('imports')}
            >
              File Imports
            </button>
          ) : null}
        </div>
        <div className="settingsBladeContent">
          {activeBlade === 'account' ? renderAccount() : null}
          {activeBlade === 'appearance' ? renderAppearance() : null}
          {activeBlade === 'firebaseToken' ? renderFirebaseToken() : null}
          {activeBlade === 'dataAudit' ? renderDataAudit() : null}
          {activeBlade === 'imports' ? renderFileImports() : null}
        </div>
      </div>
    </Overlay>
  )
}
