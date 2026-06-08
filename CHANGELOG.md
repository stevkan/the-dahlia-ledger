# Changelog

## 0.9.0-beta.3 - 2026-06-08

- Added root production build/start scripts for Azure App Service deployment.
- Added backend production start script.
- Served the built Vite frontend from the Express backend with SPA route fallback.

## 0.9.0-beta.2 - 2026-06-08

- Secured backend API routes with Firebase ID token verification while keeping health checks public.
- Added optional Firebase App Check verification for backend requests.
- Added frontend Firebase auth/App Check header support for API calls and file uploads.
- Added Firebase project configuration plus Firestore and Storage security rules.
