# Changelog

## 0.23.2 - 2026-07-06

- Moved `frontend/src/api.ts` into `frontend/src/api/client.ts`.
- Extracted garden query logic (options, members, query keys) from `App.tsx` into a new `frontend/src/hooks/useGardens.ts` custom hook.
- Extracted records query logic (summaries, flower names, colors, infinite scroll) from `App.tsx` into a new `frontend/src/hooks/useRecords.ts` custom hook.

## 0.23.1 - 2026-07-06

- Extracted HTTP helper functions (`bearerToken`, `forbidden`, `requireGlobalAdmin`, `requireGlobalAdminRoute`) from `server.js` into a new `backend/src/httpHelpers.js` module.
- Moved inline Zod schemas (`GardenInputSchema`, `MemberInputSchema`, `InviteInputSchema`, `CompanyReassignmentSchema`, `MaintenanceReminderInputSchema`) from `server.js` into `backend/src/schema.js`.
- Extracted record utility functions and types (`patchRecords`, `patchRecordSummaries`, `recordToSummary`, `RecordsPage`, `InfiniteRecordsData`) from `App.tsx` into a new `frontend/src/recordUtils.ts` module.
- Added vitest testing infrastructure to both backend and frontend, with `test` and `test:watch` scripts.

## 0.23.0 - 2026-07-06

- Added Azure Application Insights telemetry to the backend: auto-collects requests, exceptions, and dependencies when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set, and tracks exceptions from agent routes and the global error handler.

## 0.22.3 - 2026-07-06

- Extracted the shared `api` helper and `API_BASE` constant into `frontend/src/api.ts`, removing the duplicated copies from `App.tsx`, `AgentPanel.tsx`, and `AnalyticsModal.tsx`.

## 0.22.2 - 2026-07-06

- Updated the Azure deployment workflow to build the frontend and install backend production dependencies before uploading the artifact.
- Removed a stale release workflow file.

## 0.22.1 - 2026-07-06

- Disabled overscroll bounce and touch-action on the orientation overlay and body in portrait mobile view to prevent scroll bleed-through.

## 0.22.0 - 2026-07-04

- Displays the app version number next to the title in the top bar.

## 0.21.0 - 2026-07-04

- Converted the mobile navigation hamburger panel into a slide-in drawer that overlays from the right, with a backdrop, smooth transition, and a close button inside the panel.
- Fixed the top bar backdrop blur to use a `::before` pseudo-element so it no longer clips content that overlaps the bar.

## 0.20.3 - 2026-07-03

- Limited invoice item association to one item per record; the picker is disabled once an item is linked.
- Added company filtering to the invoice item picker so only items matching the selected source company are shown.
- Added a disabled style for `DahliaPickerField` trigger buttons when the field is disabled.
- Auto-populates the source field with the company name when an invoice item is selected and no source is set.

## 0.20.2 - 2026-07-03

- Renamed the "Garden Assignment" label to "Garden" on order item rows in the order modal.

## 0.20.1 - 2026-07-03

- Fixed order item picker in the record form to hide items already linked to other records, preventing duplicate order item assignments.

## 0.20.0 - 2026-07-03

- Added `required` and `disabled` props to `DahliaPickerField` so picker fields can display a required indicator and be conditionally disabled.
- Switched the Zone, Row/Bed, and Position picker fields in the record form to use `DahliaPickerField`, with taken positions shown as disabled options.
- Added a records refresh status label next to the New Record button that shows the last-updated time and indicates when a background refresh is in progress.

## 0.19.0 - 2026-07-01

- Replaced `DahliaFormField` with a new generic `DahliaPickerField` component that supports configurable options, grid and list layouts, disabled entries, and an optional clear action.
- Switched the Form, Bloom Width, and Habit fields in the record form to use `DahliaPickerField` with predefined option lists.
- Fixed record change detection to normalize `linkedOrderItemIds` to an empty array when absent, preventing spurious unsaved-changes warnings.

## 0.18.1 - 2026-07-01

- Updated record modal title to display the flower name alongside the record number for easier identification.

## 0.18.0-beta.11 - 2026-07-01

- Fixed cultivar photos and default photo scope to sync when a record's flower name or cultivar changes, inheriting photos from another matching record or clearing stale cultivar data.
- Fixed default photo scope fallback to recover gracefully when the scoped default photo no longer exists, selecting the oldest available photo instead.

## 0.18.0-beta.10 - 2026-06-30

- Fixed record form to auto-update the cultivar when the flower name changes and the cultivar previously matched the old flower name.

## 0.18.0-beta.9 - 2026-06-30

- Removed minimum width constraint from the records table so it scales down on narrow viewports.
- Renamed the "Thumbnail" column header to "Photo" in the records table.

## 0.18.0-beta.8 - 2026-06-30

- Fixed inherited cultivar photos to exclude the current record's own photos so they do not appear twice in the cultivar photo list.
- Fixed cultivar photos to always merge form photos with inherited photos using deduplication, rather than falling back to inherited only when form photos are absent.
- Fixed record summaries refresh after save to use query cache invalidation instead of a full refetch.

## 0.18.0-beta.7 - 2026-06-28

- Added `cultivar` to record summaries so it is available in the records table without a full record fetch.
- Added cultivar as searchable text in the records table.
- Added a backfill script (`backfill-summary-cultivar.js`) to populate cultivar on existing record summaries.

## 0.18.0-beta.6 - 2026-06-28

- Added exact phrase search in the records table by wrapping a query in double quotes.

## 0.18.0-beta.5 - 2026-06-28

- Added `flower_count_by_photo_type` analytics metric with photo type filter (any, record-level, cultivar-level, or no photos).
- Fixed color and flower name rename to also update `dahliaRecordSummaries` so the table reflects the new values without a full refresh.
- Added optimistic cache updates for color and flower name renames so the record list and active record update immediately.
- Order modal items now update in memory when a flower name is renamed.
- Extracted `DahliaFormField` component with a dedicated modal picker for dahlia form selection.
- Refreshed record form layout to a four-column grid with updated field ordering.
- Added HEIC/HEIF photo support in the record modal with automatic conversion to JPEG.
- Reverted Firebase App Check from ReCaptcha Enterprise back to ReCaptcha V3 and added debug token support for local development.

## 0.18.0-beta.4 - 2026-06-26

- Added color management with a dedicated modal for listing and renaming colors across records.
- Added color autocomplete to the record form with a link to the colors management modal.
- Upgraded Firebase App Check from ReCaptcha v3 to ReCaptcha Enterprise provider.
- Added a hamburger menu for mobile layout and moved the refresh interval control into it.

## 0.18.0-beta.3 - 2026-06-25

- Extracted Analytics panel into a standalone AnalyticsModal component.
- Added five new analytics metrics: average item cost by season, order count by company, flower count by bloom size, flower count by height, and flower count by source.
- Expanded Agent Helper capabilities to include record lookup, season and garden planning, cultivar research, arrangement and design advice, and problem diagnosis.
- Added slim record, order, and company helpers to reduce agent context payload size.
- Added portal rendering and separator support to DropdownField for improved overlay positioning.
- Passed garden ID to RecordModal and OrderModal for garden-scoped operations.

## 0.18.0-beta.2 - 2026-06-24

- Merged garden creation and management into a single dropdown flow with a "Create new garden..." option.
- Disabled the new company name field in the order form when an existing company is selected.
- Required invoice number, total cost, and order date before enabling order save.
- Reorganized order form layout and updated field labels for clarity.

## 0.18.0-beta.1 - 2026-06-24

- Added flower name management with a dedicated modal for listing and renaming flower names across records and orders.
- Added flower name autocomplete to the record and order item forms.
- Added item number field to order line items.
- Changed uploaded order and asset file names to sequential Doc numbering instead of the browser-provided filename.
- Simplified order modal navigation by removing the intermediate year grouping step.
- Added body scroll lock when any modal is open.

## 0.17.1-beta.1 - 2026-06-15

- Fixed duplicated record drafts so planted placement values and non-planted reason fields are preserved without delaying modal opening.

## 0.17.0-beta.1 - 2026-06-15

- Added zone-owned row/bed placement options with stable option IDs and dependent record placement selection.

## 0.16.1-beta.2 - 2026-06-15

- Improved maintenance reminder modal layout and controls for more reliable related-record selection.

## 0.16.1-beta.1 - 2026-06-15

- Improved modal select controls with custom dropdowns and fixed reminder related-record selection with searchable current-season filtering.

## 0.16.0-beta.1 - 2026-06-15

- Improved record create, edit, photo, and delete flows so cached record summaries update immediately before background refreshes complete.

## 0.15.2-beta.1 - 2026-06-15

- Fixed record editing and filtering so placement fields stay aligned with planted status changes in record tables and modals.

## 0.15.1-beta.1 - 2026-06-15

- Fixed record summaries and row filters so non-planted records do not retain garden placement values in table filtering or location display.

## 0.15.0-beta.2 - 2026-06-15

- Fixed the records table season default so clearing season filters is not immediately overwritten after the initial default is applied.

## 0.15.0-beta.1 - 2026-06-15

- Added paginated garden-scoped record summary endpoints with cursor support and Firestore indexes for common record sorts.

## 0.14.2-beta.2 - 2026-06-15

- Improved record summary loading with a short-lived backend cache and added Firestore indexes for common garden-scoped record sorts.

## 0.14.2-beta.1 - 2026-06-15

- Improved record table search responsiveness by precomputing searchable row text before applying filters.

## 0.14.1-beta.1 - 2026-06-15

- Fixed record and photo thumbnail image sizing to reduce layout shifts in virtualized record views and photo previews.

## 0.14.0-beta.1 - 2026-06-14

- Added virtualized flower record table rendering to keep large paginated record lists responsive while scrolling.

## 0.13.0-beta.1 - 2026-06-14

- Added paginated flower record summary loading with a load-more control to reduce initial record table fetch size.

## 0.12.1-beta.1 - 2026-06-14

- Improved photo edit performance by returning only changed records from photo mutations and patching the records cache instead of replacing it with a full reload.

## 0.12.0-beta.1 - 2026-06-14

- Added a summary view for flower record listing so the table can load lightweight record data and fetch full records only when opened.

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
