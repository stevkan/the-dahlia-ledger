---
name: ship
description: Bump version, update changelog, create a release branch, commit all working-tree changes, and push. Use when asked to ship, release, push, commit and push, or prepare a release branch. Reads the current git diff, picks the right semver bump (patch/minor/major), updates all three package.json files and CHANGELOG.md, creates a release/X.Y.Z branch, commits everything, and pushes. Does NOT open a PR.
---

Prepare and push a versioned release branch. Follow these steps in order.

## 1. Survey the working tree

```bash
git diff HEAD
git status
```

Read the full diff. Use it to:
- Classify the version bump (patch / minor / major)
- Draft the changelog entry
- Write the commit message

## 2. Classify the version bump

Per CLAUDE.md:
- **Patch** — bug fixes, dependency swaps, type corrections, config fixes, refactors with no behavior change
- **Minor** — backward-compatible new features or visible new functionality
- **Major** — breaking changes

Read the current version from `package.json` at the repo root.

## 3. Update all three package.json files

Bump the `"version"` field in **all three** — root, `backend/`, and `frontend/` — to the same new value. Do not touch any other field.

## 4. Update CHANGELOG.md

Prepend a new entry above the most recent one. Match the existing format exactly:

```
## X.Y.Z - YYYY-MM-DD

- One-line description per logical change.
```

Use today's date. Keep entries concise.

## 5. Create the release branch

```bash
git checkout -b release/X.Y.Z
```

## 6. Stage and commit

Review what will be staged:

```bash
git status
```

Stage everything:

```bash
git add .
git add .claude/   # if the .claude/ directory is untracked, git add . may not catch it
```

Commit using the same style as existing commits:

```bash
git commit -m "prepare X.Y.Z <type> release"
```

Where `<type>` is a short description of what changed (e.g. `record modal fix`, `analytics feature`).

## 7. Push

```bash
git push -u origin release/X.Y.Z
```

Do not open a PR. Report the pushed branch name when done.
