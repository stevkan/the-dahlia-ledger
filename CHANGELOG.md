# Changelog

## 0.11.4-beta.1 - 2026-06-14

- Fixed garden-scoped flower record listing to query the selected garden directly while preserving legacy unassigned records when requested.

## 0.11.3-beta.1 - 2026-06-14

- Fixed flower record numbering so new records increment within the selected garden instead of across all gardens.
- Added the Firestore composite index configuration needed for garden-scoped record numbering deployments.
- Fixed garden detail updates so omitted optional fields are preserved instead of being cleared.
- Added garden and zone context to company and garden option dependency record lists.

## 0.11.2-beta.1 - 2026-06-14

- Prevented deleting garden placement options that are still used by planted records and added record links to help resolve those dependencies.

## 0.11.1-beta.1 - 2026-06-14

- Fixed custom row/bed option saves so values matching the previous default row set are not reset to `A`, `B`, and `C` during live edits.

## 0.11.0-beta.1 - 2026-06-13

- Added richer garden option management with delimited entry, ranges, reordering, default restoration, delete-all controls, and rename confirmation.
- Added garden option rename propagation across records, order items, assets, companies, and maintenance reminders.
- Added field help hints throughout garden, record, order, asset, company, and reminder forms.
- Improved handling for orphaned record placement options and draft record number display.

## 0.10.0-beta.6 - 2026-06-13

- Added garden-specific placement option persistence so shared gardens can keep their own zone, row, and position lists.
- Added migration from locally stored placement options to the active garden when no garden-specific options exist.
- Updated garden management change tracking so placement option saves happen independently of garden detail saves.

## 0.10.0-beta.5 - 2026-06-13

- Added apply support to the legacy company garden assignment script and expanded owner detection through created gardens and garden membership records.
- Fixed maintenance reminder modal backdrop behavior so clicks inside the overlay do not close the modal unexpectedly.
- Improved season year default selection and widened toggle controls for clearer filter state display.

## 0.10.0-beta.4 - 2026-06-13

- Added garden-shared company visibility so garden members can view and update companies tied to their shared garden while preserving company ownership.
- Restricted company deletion to the company owner or a joint garden owner and updated the Companies modal to hide unavailable delete actions.
- Added a dry-run script for reporting legacy company `gardenId` assignments before backfilling existing company records.
- Fixed default garden deletion so deleted defaults are not immediately recreated when the user already has another garden.
- Improved garden deletion feedback and selection handling after successful or blocked deletes.

## 0.10.0-beta.3 - 2026-06-12

- Updated garden access fallback handling to use the oldest accessible garden instead of only the default garden.
- Allowed owners to delete non-last gardens while preventing deletion of a user's final garden.
- Updated garden selection and deletion messaging to match the new fallback and last-garden behavior.

## 0.10.0-beta.2 - 2026-06-12

- Added maintenance reminder completion history and snooze support.
- Added reminder completion and snooze controls to the maintenance reminders modal.
- Updated reminder alert styling and active reminder state handling.

## 0.10.0-beta.1 - 2026-06-12

- Added multi-garden management with default gardens, member roles, invite links, and garden-scoped records, reminders, and order items.
- Added global admin capabilities for known-user tracking, import protection, user deletion, and company ownership reassignment.
- Added asset tracking with company/order-item links, invoice PDF uploads, and image-to-PDF invoice conversion.
- Updated record placement terminology to zones, rows/beds, and positions while preserving legacy placement data.
- Added bloom-width category normalization plus migration scripts for legacy bloom widths, records, and company ownership.
- Enhanced reminders, companies, orders, and records with ownership, assignment, validation, formatting, and refresh controls.

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
