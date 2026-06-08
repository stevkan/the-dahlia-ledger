# Changelog

## 0.9.0-beta.5 - 2026-06-08

- Defaulted frontend API calls to the same origin when `VITE_API_BASE` is not set.
- Updated frontend environment documentation for Azure same-origin hosting.

## 0.9.0-beta.4 - 2026-06-08

- Added production Firebase Admin credential parsing for Azure App Service environment variables.
- Added `APP_ENV` support so local development can continue using a service account file path.
- Documented backend environment variable usage for development and production credentials.

## 0.9.0-beta.3 - 2026-06-08

- Added root production build/start scripts for Azure App Service deployment.
- Added backend production start script.
- Served the built Vite frontend from the Express backend with SPA route fallback.

## 0.9.0-beta.2 - 2026-06-08

- Secured backend API routes with Firebase ID token verification while keeping health checks public.
- Added optional Firebase App Check verification for backend requests.
- Added frontend Firebase auth/App Check header support for API calls and file uploads.
- Added Firebase project configuration plus Firestore and Storage security rules.
