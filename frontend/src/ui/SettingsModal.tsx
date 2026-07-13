import { useState, type CSSProperties } from 'react'
import type { ExcelImportResult } from '../types'

type Theme = 'dark' | 'light'
type SettingsBlade = 'appearance' | 'imports' | 'account'

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
  onClose: () => void
}) {
  const [blade, setBlade] = useState<SettingsBlade>(initialBlade)
  const activeBlade: SettingsBlade = blade === 'imports' && !showFileImports ? 'appearance' : blade

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

  return (
    <Overlay>
      <div className="modalHeader">
        <div>
          <div className="modalTitle">Settings</div>
          <div className="modalSub">Manage appearance and data import preferences.</div>
        </div>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
      <div className="modalBody settingsLayout">
        <div className="settingsBladeList">
          <button
            className={`settingsBladeOption${activeBlade === 'appearance' ? ' selected' : ''}`}
            type="button"
            onClick={() => setBlade('appearance')}
          >
            Appearance
          </button>
          {showFileImports ? (
            <button
              className={`settingsBladeOption${activeBlade === 'imports' ? ' selected' : ''}`}
              type="button"
              onClick={() => setBlade('imports')}
            >
              File Imports
            </button>
          ) : null}
          <button
            className={`settingsBladeOption${activeBlade === 'account' ? ' selected' : ''}`}
            type="button"
            onClick={() => setBlade('account')}
          >
            Account
          </button>
        </div>
        <div className="settingsBladeContent">
          {activeBlade === 'appearance' ? renderAppearance() : null}
          {activeBlade === 'imports' ? renderFileImports() : null}
          {activeBlade === 'account' ? renderAccount() : null}
        </div>
      </div>
    </Overlay>
  )
}
