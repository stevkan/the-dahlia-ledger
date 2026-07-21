import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { getToken, initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth'

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean)

const app = hasFirebaseConfig ? initializeApp(firebaseConfig) : null
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY
const localAppCheckDebugToken = import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN
const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export const auth: Auth | null = app ? getAuth(app) : null

if (auth && import.meta.env.DEV && import.meta.env.VITE_USE_AUTH_EMULATOR === 'true') {
  try {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to connect to the Firebase Auth Emulator:', e)
  }
}

// The Firestore-stored token (see SettingsModal) is authoritative — it survives a browser cache
// clear instead of the App Check SDK minting a fresh, unregistered token every time local storage
// is wiped. VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN is only a fallback for when no admin has generated
// one yet (or the fetch fails), e.g. a fresh local checkout before the Firestore doc exists.
async function fetchStoredAppCheckDebugToken(): Promise<string | null> {
  if (!auth?.currentUser) return null

  try {
    const idToken = await auth.currentUser.getIdToken()
    const res = await fetch(`${API_BASE}/api/app-check/debug-token`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { debugToken?: string | null }
    return typeof data.debugToken === 'string' && data.debugToken ? data.debugToken : null
  } catch {
    return null
  }
}

// @firebase/app-check unconditionally console.logs the raw debug token on init (it bypasses its
// own logger specifically so this can't be silenced via setLogLevel) — the Settings modal already
// surfaces this same value, so filter out just that one message rather than leaking it to devtools.
function suppressAppCheckDebugTokenLog() {
  const originalConsoleLog = console.log
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('App Check debug token:')) return
    originalConsoleLog(...args)
  }
}

async function initAppCheck(): Promise<AppCheck | null> {
  if (!app || !appCheckSiteKey) return null

  const debugToken = (await fetchStoredAppCheckDebugToken()) || localAppCheckDebugToken
  if (debugToken) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken === 'true' ? true : debugToken
    suppressAppCheckDebugTokenLog()
  }

  return initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  })
}

let appCheckPromise: Promise<AppCheck | null> | null = null

function getAppCheck(): Promise<AppCheck | null> {
  if (!appCheckPromise) appCheckPromise = initAppCheck()
  return appCheckPromise
}

export async function initializeAuthPersistence() {
  if (!auth) return
  await setPersistence(auth, browserLocalPersistence)
}

export async function authHeaders() {
  const headers: Record<string, string> = {}

  if (auth?.currentUser) {
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`
  }

  const appCheck = await getAppCheck()
  if (appCheck) {
    const { token } = await getToken(appCheck)
    headers['X-Firebase-AppCheck'] = token
  }

  return headers
}

export async function apiHeaders(headers?: HeadersInit) {
  return {
    ...(await authHeaders()),
    ...(headers ?? {}),
  }
}
