# ml-training

Offline metric-learning fine-tuning for the photo-identification pipeline. This directory is
**never deployed** with the Node/Azure backend — it's a standalone tool you run locally. Its only
output that crosses into `backend/` is a plain JSON file (a matrix of numbers).

Training a small linear projection on top of the frozen DINOv2 embeddings (via triplet loss) pulls
same-cultivar reference photos closer together and different-cultivar photos further apart than the
raw, general-purpose DINOv2 embeddings do on their own.

## Setup

```
cd ml-training
python -m venv .venv
.venv\Scripts\activate   # or `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
```

## Workflow

All commands below assume your working directory is `backend/` (not the repo root, and no
`--prefix backend` — that flag is relative to your current directory, so combining it with already
being inside `backend/` looks for a nonexistent nested `backend/backend`).

1. **Export current reference embeddings** from Firestore:
   ```
   npm run export:training-embeddings
   ```
   Writes `backend/scripts/fixtures/training-embeddings.json`.

2. **Train the projection** (from `ml-training/`):
   ```
   python train_projection.py
   ```
   Reads the export above by default, trains for 30 epochs, prints validation top-1 accuracy
   before (identity projection) vs. after training, and writes `output/learned-projection.json`.
   Run `python train_projection.py --help` for tunable options (epochs, batch size, margin,
   learning rate).

3. **Import the trained projection** (from `backend/`) — call the script directly with `node`
   rather than through `npm run ... -- --flag`: on Windows/PowerShell, npm silently drops flags
   forwarded after `--` (confirmed — `--in` never reaches the script, it falls back to trying to
   read `ml-training/output/learned-projection.json` relative to `backend/` and fails with ENOENT).
   This isn't specific to this script; avoid `npm run <script> -- --flag value` for any of this
   project's scripts on Windows and call `node scripts/<file>.js <flags>` directly instead.
   ```
   node scripts/import-learned-projection.js --dry-run --in ../ml-training/output/learned-projection.json
   ```
   Review the dry-run output, then import for real and activate it:
   ```
   node scripts/import-learned-projection.js --in ../ml-training/output/learned-projection.json --activate
   ```
   Importing without `--activate` stores the projection in Firestore for review without switching
   production traffic onto it — activate it separately once you're satisfied.

4. **Roll back** (from `backend/`) if the active projection turns out to hurt matching quality —
   reverts `identifyPhoto()` to unprojected (raw DINOv2) matching immediately:
   ```
   node scripts/deactivate-learned-projection.js
   ```
   This only removes the *active* pointer; the trained projection itself stays in Firestore/Storage,
   so nothing is lost if you want to inspect it or point a future version's `--activate` back at it.

## Notes

- The projection is trained by pooling reference photos across **all gardens** by cultivar name —
  a single garden typically has too few photos per cultivar for triplet learning to generalize well.
- **You need real per-cultivar photo depth for this to help, not just a lot of total photos.**
  `train_projection.py` requires >= 2 photos for a cultivar to contribute any training signal at all
  (an anchor/positive pair) and >= 3 to additionally hold one out for validation — a cultivar with
  only 1 reference photo is completely excluded from training, yet the resulting projection still
  gets applied to its embedding at inference time. Confirmed in practice: with 373 cultivars and 721
  total reference photos (average 1.9/cultivar), 191 cultivars (51%) had only 1 photo and 100 (27%)
  had only 2 -- the projection was trained on a thin, unrepresentative sample and made matching worse
  for most of the collection rather than better. Check your own distribution before activating (a
  quick way: filter `listAllPhotoEmbeddings()` results by cultivar and count). As a rough guideline,
  don't expect this to help until most cultivars you care about matching well have at least 3-5
  reference photos; below that, prefer the raw (unprojected) DINOv2 pipeline.
- Retraining is a manual step, not automatic. The backend surfaces a "retraining recommended"
  notification to the global admin when the live photo collection has grown significantly since the
  active projection was trained (see `LEARNED_PROJECTION_DRIFT_PHOTO_GROWTH` /
  `LEARNED_PROJECTION_DRIFT_CULTIVAR_GROWTH` env vars in `backend/src/learnedProjection.js`) — but
  nothing runs this pipeline for you automatically.
