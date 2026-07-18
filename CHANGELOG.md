# Changelog

## 0.29.2 - 2026-07-17

- Fixed a regression from the 0.27.0 cultivar photo sync change: renaming a record's variety name wiped its saved cultivar-scope photos instead of carrying them forward. `updateRecord()` (`backend/src/records.js`) only pulls in another record's shared cultivar photos as a "donor" when the new name matches an existing record; previously, if no donor was found, the record's own `cultivarPhotos` were unconditionally reset to empty — even when this record was the only one that had ever held them. It now only clears them when another record still holds the *old* cultivar name (a genuine split, where the shared photos correctly stay with the group), otherwise the record's existing photos carry over under the new name.

## 0.29.1 - 2026-07-16

- Fixed Identify Photo always failing in production ("I could not read that photo"). Root cause: `@huggingface/transformers` (`backend/src/embeddings.js`) defaults to caching downloaded CLIP model weights inside its own `node_modules` folder, which is read-only under Azure App Service's "Run From Package" deployment, so the model never loaded. The cache directory is now configurable via `HF_CACHE_DIR` (defaults to the OS temp dir).
- Fixed a related resiliency bug: a failed model load was cached forever (a rejected promise was never retried), so one transient failure broke photo identification until the process restarted. Model loaders now retry on the next request after a failure instead of staying permanently broken.

## 0.29.0 - 2026-07-15

- Records pagination is no longer bypassed for every user on their default garden; a cheap cached check now confirms legacy gardenId-less records actually exist before disabling pagination, so the common case gets fast incremental page loads.
- Enabled gzip/deflate compression for backend API responses and the static frontend bundle.
- Added a dedicated 96px "list" thumbnail for the records table (previously the 320px thumbnail was downscaled to 42x42px in the browser), generated on upload and backfillable via `backend/scripts/backfill-photo-list-thumbnails.js`.
- The PWA service worker now caches dahlia photo/thumbnail storage responses (CacheFirst), so repeat garden visits load previously-viewed images instantly, including offline or on a weak signal.
- Added a `useIsWeakConnection` hook that automatically pauses background records refresh when the connection is 2G/slow-2G or the browser's Data Saver mode is on, with a "Paused (weak connection)" note next to the refresh interval dropdown; the user's saved preference is left untouched.

## 0.28.3 - 2026-07-15

- Replaced the discrete 11-bucket color zero-shot classifier in `identifyPhoto()` (`backend/src/agent.js`) with continuous cosine similarity between the query photo and a text embedding of each reference's own recorded color string (e.g. "Creamy White", "White Lavender"). The old design forced the query into exactly one best-guess color bucket via argmax, then required an exact whole-word match against the reference's color text — fragile for blended colors (a white-and-lavender flower could only match a reference literally containing whichever single word won the argmax that run) and with no credit for adjacent colors (cream vs. white, lavender vs. purple). The new approach subtracts a per-query "a photo of a dahlia flower" baseline so the signal self-calibrates per photo, and naturally gives partial credit for semantically close colors via CLIP's own text embedding space — no hand-curated adjacency list needed. Verified against a real previously-failing case and all prior self-match regression cases.
- `photoEmbeddings` docs now also store a `colorEmbedding` (`backend/src/photoEmbeddings.js`), computed and refreshed alongside `color` whenever a record's color changes; `backend/scripts/backfill-photo-embeddings.js` backfills it for existing photos without re-running the (expensive) visual embedding. New env vars `PHOTO_MATCH_COLOR_SIMILARITY_SCALE` (default 0.4) and `PHOTO_MATCH_MAX_COLOR_BOOST` (default 0.02) replace `PHOTO_MATCH_COLOR_BOOST`. Form matching is unchanged (still a discrete-label match, since it's a closed dropdown vocabulary rather than free text).

## 0.28.2 - 2026-07-13

- Fixed a real regression from the 0.27.0 metadata re-ranking boost: `PHOTO_MATCH_COLOR_BOOST`/`PHOTO_MATCH_FORM_BOOST` defaults (0.03/0.015) were large enough to override genuine visual-similarity differences, so a cultivar with no recorded color/form (getting zero boost, by design) could be outranked by a visually-worse match that happened to have matching metadata — confirmed with a real case where a cultivar's own saved photo, used as the query, scored 0.9737 (correctly the best raw visual match) but ranked behind two other cultivars boosted to 0.983/0.979 from raw scores of ~0.95, burying the correct self-match entirely. Reduced the defaults to 0.008/0.004 in `backend/src/agent.js` — small enough to only break near-ties, verified against multiple real self-match cases that previously failed or were at risk.

## 0.28.1 - 2026-07-13

- Fixed an intermittent 400 "A photo is required to identify" from Identify Photo when selecting a HEIC photo (the default format for iPhone camera photos): the button could be tapped before the async HEIC→JPEG conversion finished, submitting neither a file nor an image URL. `RecordModal.tsx`'s Photo Galleries Identify Photo button now also disables while `photoConverting` is true. `PhotoIdentifyModal.tsx` previously had no HEIC handling at all (a raw `.heic` upload could fail server-side, or be rejected client-side depending on browser MIME reporting); it now converts HEIC the same way `RecordModal.tsx` does, with matching button-disable behavior during conversion.
- `identifyPhoto()` in `frontend/src/api/client.ts` now downscales the photo client-side (max 768px on the long edge, JPEG quality 0.85, via `createImageBitmap`/canvas) before uploading for identification, since CLIP resizes to 224×224 internally regardless — this cuts upload size and time substantially on mobile connections with no accuracy loss. Falls back to the original file if resizing fails for any reason.
- Added diagnostic logging (`trackTrace`, visible in Application Insights) to the `POST /api/agent/identify-photo` 400 responses in `backend/src/routes/agent.js`, capturing content-type, content-length, user-agent, and whether a file was received, to help diagnose any further occurrences.

## 0.28.0 - 2026-07-13

- Replaced the Settings dropdown with a new `SettingsModal.tsx`, styled like the Companies modal with an equal-width left/right blade layout: "Appearance" (theme toggle), "File Imports" (OneNote/Excel import, admin-only), and "Account" (signed-in email and Sign Out, stacked and left-aligned). The Settings header button now opens the modal directly instead of expanding an inline dropdown/accordion, and the modal only closes via its Close button.
- `App.tsx`'s Settings button, drawer, and top bar no longer render sign-in info or Sign Out inline; that's now exclusively reachable through the modal's Account blade.
- The Settings modal's width grows (up to ~820px) to fit the full "Signed in as..." line without truncating it.

## 0.27.0 - 2026-07-13

- Added metadata-assisted re-ranking to Identify Photo: `backend/src/embeddings.js` now also loads CLIP's text tower (`CLIPTextModelWithProjection`/`AutoTokenizer`, `embedTexts()`) so `identifyPhoto()` in `backend/src/agent.js` can zero-shot-classify the query photo's likely color family and bloom form using the same already-loaded model (no extra vision-model inference, since it reuses the query's existing image embedding against small cached sets of text-label embeddings). Cultivars whose saved `core.color`/`core.form` agree with that inferred guess get a small score boost (`PHOTO_MATCH_COLOR_BOOST`/`PHOTO_MATCH_FORM_BOOST` env vars, defaulting to 0.03/0.015 — form's default is lower since empirical testing showed CLIP's zero-shot form discrimination is much weaker than its color discrimination). Missing or non-matching metadata is always neutral (no penalty), so records with incomplete color/form data behave exactly as before.
- `photoEmbeddings` docs now also store `color`/`form` captured from each record at embed time; `ensureEmbeddingsForRecord()` (`backend/src/photoEmbeddings.js`) refreshes those fields on existing embeddings (without re-running CLIP) whenever a record's color/form changes after the photo was first embedded. `backend/scripts/backfill-photo-embeddings.js` does the same one-time metadata backfill for pre-existing embeddings.
- Moved "Identify A Flower From A Photo" out of the Agent Helper panel and into its own `PhotoIdentifyModal.tsx`, opened via a new "Identify A Flower" button in the Insights menu (`App.tsx`), so identification no longer requires opening the agent chat.
- `PhotoIdentifyResultsModal.tsx` now has a "Back" button alongside "Close", letting users return to the photo picker (Agent Helper or Photo Galleries) to try another photo without closing the whole flow.
- In the `RecordModal.tsx` Photo Galleries modal, reordered the photo action buttons so "Save/Add Photo", "Choose Different Photo", and "Cancel" sit on one row, with "Identify Photo" underneath "Save/Add Photo".

## 0.26.0 - 2026-07-13

- Replaced the LLM-vision-comparison approach behind Identify Photo with local image embeddings: `backend/src/embeddings.js` runs a CLIP model (`@huggingface/transformers`, `Xenova/clip-vit-base-patch32`) entirely in-process to embed photos, warmed once at server startup in `backend/src/server.js`. No reference photos are sent to an LLM at request time anymore — identification is now a fast in-memory cosine-similarity search.
- Added a new `photoEmbeddings` Firestore collection and `backend/src/photoEmbeddings.js` data-access module. `ensureEmbeddingsForRecord()` is hooked (fire-and-forget, non-blocking) into `createRecord`, `updateRecord`, and `updateCultivarPhoto` in `backend/src/records.js` so every saved photo gets embedded incrementally without slowing down saves.
- Added `backend/scripts/backfill-photo-embeddings.js` (`npm run backfill:photo-embeddings[:dry-run]` from `backend/`) to seed embeddings for existing photos and prune embeddings for photos no longer referenced by any record.
- `identifyPhoto()` in `backend/src/agent.js` now embeds only the submitted query photo, compares it against the resolved garden's stored embeddings (max similarity per cultivar), and returns matches above `PHOTO_MATCH_MIN_SIMILARITY` (env-configurable, default `0.88` based on empirical testing — different dahlia cultivars can score 0.75-0.93 on raw cosine similarity, so this needs real-world tuning against your own collection). This also fixes a latent bug where identification compared against every garden's photos globally instead of just the current garden's.
- Removed the now-unused `backend/prompts/photo-identification-agent.md` and the per-request OpenAI vision call from the identify-photo path (`ingestText`, `reviewRecordMapping`, and `proposeMissedIssueCorrection` still use OpenAI as before). Suggestions no longer include LLM-generated `notes` text; the frontend already renders that field conditionally, so no frontend changes were needed.

## 0.25.0 - 2026-07-12

- Added dahlia photo identification: a new "Identify Photo" action in `AgentPanel.tsx` lets users submit a photo directly to the agent, and a new "Identify Photo" button in the `RecordModal.tsx` Photo Galleries modal identifies the currently assigned (even unsaved) photo. Both open a new `PhotoIdentifyResultsModal.tsx` showing up to 5 suggested cultivars, each as a row with its thumbnail beside the name, confidence score, and notes; the modal only closes via its Close button and renders above all other content.
- `identifyPhoto()` in `backend/src/agent.js` sends the submitted photo to the vision-capable OpenAI model alongside labeled reference photos of the user's own saved cultivars, and asks it to visually rank which saved cultivars most resemble the new photo. Suggestions are filtered server-side to only ever include an exact match against a saved cultivar, so every returned result always has a photo to compare against; a flower new to the collection correctly returns "no close match" instead of a guessed name. Reference photos are now collected from all of a cultivar's saved `recordPhotos`/`cultivarPhotos` (up to 4 per cultivar, deduplicated by URL) instead of just one representative photo, and the overall request is capped at 60 reference photos.
- Added `backend/prompts/photo-identification-agent.md` describing this photo-vs-collection comparison task.
- Added `POST /api/agent/identify-photo` in `backend/src/routes/agent.js`, accepting a multipart file upload or an existing photo URL.

## 0.24.1 - 2026-07-08

- In `RecordModal.tsx`, moved the Core Details section above Photos as the first section, and moved Flower Name/Season and Planting State (with its conditional reason and garden-location fields) into Core Details above Cultivar and Planted Date.

## 0.24.0 - 2026-07-07

- Added a dev-only `-AuthBypass` mode to the `run-the-dahlia-ledger` driver script that signs in a throwaway user against a local Firebase Auth Emulator, so authenticated UI can be screenshotted without a real Microsoft OAuth popup; gated behind `import.meta.env.DEV` and compiled out of production builds.
- Added `firebase-tools` as a root dev dependency and a Firebase Auth Emulator config in `firebase.json` to support the new auth bypass flow.
- Reworked the Photos section in `RecordModal.tsx`: the section header is now a collapsible toggle button showing just the assigned photo, and "Show Galleries" now opens a dedicated modal with the upload dropzone, scope picker, and Record/Cultivar photo galleries instead of expanding inline.
- Changed the default photo upload scope in `RecordModal.tsx` from "This record only" to "All ... records" (cultivar).
- Fixed `Start-Process -FilePath "npm"` resolving to `npm.ps1` and failing in the driver script by calling `npm.cmd` explicitly.

## 0.23.7 - 2026-07-07

- In `RecordModal.tsx`, moved the Not Planted Reason / Not Viable Reason fields onto the same row as Planting State (25%/75% split) via a new `.gridSpan3` CSS class.
- Removed the "Location details stop at..." summary message and its now-unused `getPlantingStateLabel` helper and `.stateSummary` style.

## 0.23.6 - 2026-07-07

- Replaced the local `SelectField` component and `plantingStateOptions` helper in `RecordModal.tsx` with the shared `DahliaPickerField` component for the Planting State field.
- Added Claude Code run and ship skills under `.claude/skills/`.

## 0.23.5 - 2026-07-06

- Replaced `heic2any` with `heic-to` for HEIC/HEIF image conversion in photo upload, and excluded `heic-to` from the Workbox service worker precache.

## 0.23.4 - 2026-07-06

- Added `frontend/src/vite-env.d.ts` to declare `ImportMetaEnv` and `ImportMeta` types for `VITE_API_BASE`, enabling proper TypeScript typing of `import.meta.env` in the frontend.
- Removed the `as any` cast and optional chaining from the `API_BASE` constant in `frontend/src/api/client.ts`.

## 0.23.3 - 2026-07-06

- Extracted all route handlers from `backend/src/server.js` into dedicated router modules under `backend/src/routes/` (gardens, users, records, maintenance reminders, companies, orders, assets, upload, imports, flower names, colors, agent, settings).

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
