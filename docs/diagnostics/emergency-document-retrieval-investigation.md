# Emergency controlled-document retrieval investigation

**Scope:** read-only repository investigation. No production Firestore records or Drive files were read or changed.

## Confirmed source paths on `main`

1. `src/components/ControlledDocumentUpload.jsx:157-180` allocates a Firestore document ID and calls `uploadControlledDocumentRouted`; the normal path requires a Google Drive archive file ID. The document payload stores `fileId`, `archiveFileId`, `governanceArchiveFileId`, and a `drive://` URL at approximately lines 198-212. The upload handler has no `firestore-emergency://` fallback branch.
2. `src/firebase/signatureStorage.js:102-128` sends the bytes to `/api/upload-controlled-document` and rejects a response without `categoryArchive.file.fileId`. This file contains no Firestore emergency-copy writer or resolver.
3. `drive-gateway/src/index.js:1669-1690` treats the supplied `fileId` as a Google Drive ID and requires it to equal `documents.driveFileId` or `documents.fileId`. A record with neither field fails the relationship check.
4. `drive-gateway/src/index.js:1692-1725` calls the Google Drive metadata and media endpoints using the supplied ID. There is no `firestore-emergency://` scheme dispatch, Firestore copy lookup, or chunk reassembly path.
5. `src/firebase/signatureStorage.js:203-225` routes document bytes through the same Worker `/api/download` route. `src/components/DocumentReader.jsx` uses this path for ordinary documents and has no emergency storage resolver.

## Why the four reported records fail

| Firestore document ID | Reported condition | What the checked code establishes |
|---|---|---|
| `IRPA-DOC-2026-MUKF0WMY-DQSQXXO2-9DF470D8` | `fileId` and `driveFileId` are missing | The Worker cannot satisfy `storedDriveId === fileId`; the emergency reference is not resolved by the current route. |
| `fAGDKKhypGGR6F7PRcLe` | Google reports `File not found: firestore-emergency://…` | The Worker passes the URI to the Drive files endpoint as though it were a Drive file ID. |
| `h3ynycNR7Zqyl9GBoCLk` | Google reports `File not found: firestore-emergency://…` | Same unsupported URI handling; the current repository contains no emergency copy lookup. |
| `k8M9oVewTBEv5WfgpQU5` | Pointer reportedly targets the MUKF0WMY emergency file | The supplied evidence indicates a cross-record/duplicate pointer. The current Worker has no duplicate-emergency-reference detection. |

These four diagnoses are based on the failure details supplied in the task and the checked source code. They are **not** confirmation that any emergency copy currently exists or is missing.

## Blocking evidence gap

A repository-wide source search on the current `main` branch found no `firestore-emergency://` writer, collection name, chunk schema, or resolver. The checked upload path is Drive-only. Consequently, the actual Firestore collection, chunk document IDs, byte field, and URI-to-copy mapping cannot be established from this checkout.

Implementing a resolver or migration without that schema would require guessing the storage location and could upload the wrong bytes or associate one record's emergency copy with another record. No such guess or mutation has been made.

## Safe next implementation gate

Before implementing retrieval and the per-document Drive migration, locate the deployed upload-fallback source/version or provide the exact emergency-copy collection and chunk schema. Once grounded, the Worker can read the copy, verify its stored hash and byte length, detect duplicate pointers across `documents`, and expose per-document dry-run/explicit-confirm migration without deleting emergency data.
