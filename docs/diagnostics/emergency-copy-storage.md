# Emergency-copy storage: historical repository audit

**Result: no emergency-copy writer or removal commit was found in the available Git history.** Therefore no exact writer commit, source file, Firestore collection, key format, byte field, or chunk schema can be responsibly identified. No resolver/backfill/migration was implemented.

## Exact Git history commands run

A GitHub Actions job checked out the repository with `fetch-depth: 0`, fetched all currently advertised remote branches and tags using `git fetch --all --tags --prune`, and ran:

```sh
git log --all --oneline -S"firestore-emergency"
git log --all --oneline -S"IRPA-EMG-DOC"
git log --all --oneline -S"emergency" -- src drive-gateway functions
```

Results:
- `-S'firestore-emergency'`: no historical source change. The only matches in the run were the new investigation text itself on this branch.
- `-S'IRPA-EMG-DOC'`: no historical source change. The only match was the audit command's own text.
- `-S'emergency' -- src drive-gateway functions`: no matching source commit.

The job also ran a date-bounded path history and deleted/renamed-file review:

```sh
git log --all --since='2026-09-20 00:00:00 +0000' --until='2026-09-29 00:00:00 +0000' --date=iso-strict --name-status --format='COMMIT %H%nDATE %ad%nSUBJECT %s' -- src drive-gateway functions
git log --all --name-status --format='COMMIT %H %ad %s' --date=short -- '**/*emergency*' '**/*fallback*' '**/*upload*'
```

The workflow fetched every branch advertised by GitHub at audit time. A deleted branch no longer advertised by GitHub cannot be recovered by `git fetch --all`; no claim is made about unreachable objects or deleted remote refs that GitHub no longer exposes.

## Relevant upload history inspected

The date-bounded path history shows the following upload implementation lineage:

| Commit | Date (repository log) | File | Finding |
|---|---|---|---|
| `5b33e8dd09d5d42cb47124139321582d5fb0e351` | 2026-09-21 | `src/firebase/signatureStorage.js` | “Fix controlled document upload gateway fallback” changes only the default Cloudflare Gateway URL. It does not write a Firestore byte copy. |
| `44d61175d34e7c8a8e70356ba6981fd16ca84db8` | 2026-09-24 | `src/components/ControlledDocumentUpload.jsx` | Rebuilds controlled upload to call `uploadControlledDocumentRouted`; stores Drive file IDs and Drive links in the document record. |
| `b236ea09f563f03037ad8f68486ac9f94e26dc6f` | 2026-09-24 | `drive-gateway/src/index.js` | Adds `uploadControlledDocument`; uploads the bytes to two Google Drive archive channels (category and governance) and returns Drive file IDs. No Firestore byte/chunk fallback. |
| `27eed39b565dbb5b5e6f2c210f713a994bcc8773` | 2026-09-26 | `drive-gateway/src/index.js` | Allows a trailing slash on the controlled upload route only. |
| `eadb6e2b7a6acf49ce854b320e5e2796add4bfdc` | 2026-09-26 | `drive-gateway/src/index.js` | Normalizes route paths; no emergency-copy writer. |
| `814cd5df5757351a1976293a0882c487cd0b80ac` | 2026-09-27 | `src/firebase/signatureStorage.js` | Adds transient retry around the Gateway request; no Firestore byte fallback. |
| `4a49fbc3627ec94f0666060df22e0290782b44f4` | 2026-09-27 | `drive-gateway/src/index.js` | Adds Drive-side idempotency lookup for upload retries; no Firestore byte fallback. |
| `82a7fa60915e2459a9f0e1af8db6ae3ac985b192` | 2026-09-27 | `src/firebase/signatureStorage.js` | Adds request timeout/retry behavior; no Firestore byte fallback. |
| `a376d8a39cdc9b561c4d6c2dffe6b375dbcd2a8e` | 2026-09-27 | `src/firebase/procurement.js` | Adds SHA-256 duplicate detection for procurement quotations and retry-safe upload behavior; not an emergency controlled-document storage system. |

No commit in the inspected upload lineage adds or removes a Firestore emergency-copy collection or chunk writer. In particular, the dual-channel controlled-document upload writes two Google Drive files, not a Firestore emergency copy.

## Firebase Functions and deleted-file review

The history job included `functions/` in the exact-string search and the date-bounded `--name-status` history, so changes and deletions under the Firebase Functions folder were in scope. The current `main` tree contains `functions/index.js` and the current Functions modules, but no emergency-copy writer was found in the searched history. No deleted emergency-named file appeared in the filename history.

## Conclusion and next safe step

There is no evidence in the currently advertised branches and fetched Git history for a writer that emits `firestore-emergency://` or `IRPA-EMG-DOC`. The source-history audit therefore cannot identify a writer commit or a collection/key/byte/chunk schema. No removal commit can be identified either.

The original four document errors still require the deployed historical fallback implementation or a Firestore export containing the relevant records and chunk metadata. Until that source of truth is available, do not guess a collection, fetch or reconstruct bytes, classify a pointer as duplicate, or migrate any document. Production Firestore and Drive remained read-only throughout this audit.

**Audit evidence:** GitHub Actions workflow “Emergency copy storage history audit”, run 2, job `history`, commit `eabb0dc9b3d31a438b1791aa02c691cf3db4946d`. The workflow uploaded `emergency-copy-history-evidence`.
