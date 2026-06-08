import admin from 'firebase-admin'
import fs from 'node:fs'

let app

function getCredential() {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))
    return admin.credential.cert(serviceAccount)
  }

  return admin.credential.applicationDefault()
}

export function getAdminApp() {
  if (app) return app

  // Prefer explicit values so local development does not depend on gcloud context.
  app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
        credential: getCredential(),
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      })

  return app
}

export function getDb() {
  return admin.firestore(getAdminApp())
}

export function getBucket() {
  const a = getAdminApp()
  if (!a.options.storageBucket) {
    throw new Error('Missing FIREBASE_STORAGE_BUCKET (e.g. your-project.appspot.com)')
  }
  return admin.storage(a).bucket()
}

export async function verifyFirebaseIdToken(idToken) {
  return admin.auth(getAdminApp()).verifyIdToken(idToken)
}

export async function verifyFirebaseAppCheckToken(appCheckToken) {
  return admin.appCheck(getAdminApp()).verifyToken(appCheckToken)
}
