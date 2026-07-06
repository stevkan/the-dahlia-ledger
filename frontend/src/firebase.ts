import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { getToken, initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check'
import {
  browserLocalPersistence,
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
const appCheckDebugToken = import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN

if (appCheckDebugToken) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken === 'true' ? true : appCheckDebugToken
}

export const auth: Auth | null = app ? getAuth(app) : null
export const appCheck: AppCheck | null = app && appCheckSiteKey
  ? initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  : null

export async function initializeAuthPersistence() {
  if (!auth) return
  await setPersistence(auth, browserLocalPersistence)
}

export async function authHeaders() {
  const headers: Record<string, string> = {}

  if (auth?.currentUser) {
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`
  }

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
