import crypto from 'node:crypto'
import { getDb } from './firebase.js'

const COLLECTION = 'appConfig'
const DOC_ID = 'appCheck'

export async function getAppCheckDebugToken() {
  const doc = await getDb().collection(COLLECTION).doc(DOC_ID).get()
  if (!doc.exists) return null
  return doc.data()?.debugToken ?? null
}

export async function generateAppCheckDebugToken(user) {
  const debugToken = crypto.randomUUID()
  const ref = getDb().collection(COLLECTION).doc(DOC_ID)
  await ref.set({
    debugToken,
    updatedAt: new Date().toISOString(),
    updatedBy: { uid: user?.uid ?? null, email: user?.email ?? null },
  })
  return debugToken
}
