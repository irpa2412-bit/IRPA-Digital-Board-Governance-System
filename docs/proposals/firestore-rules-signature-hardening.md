# Proposal — Firestore signature hardening (Phase 2; NOT APPLIED)

Date: 2026-11-03
Base: `main` observed at latest commit-search result `859e649da7e4661b61bee3da89d28578e3ee8843`.
Scope: proposal only. `firestore.rules` has NOT been edited. This diff requires Daniel's explicit approval before implementation.

## Security boundary

The Cloudflare Worker uses a service-account credential for canonical completion writes. The Firebase client must not be able to write completion state or cryptographic completion references. The Worker service account bypasses Firestore client security rules; therefore these client-rule restrictions do not block trusted Worker writes.

## Exact proposed firestore.rules diff

The following patch is against the retrieved current rules text. It is a proposal, not an applied change.

```diff
--- a/firestore.rules
+++ b/firestore.rules
@@
-  function signatureDocumentWorkflowUpdate(){return activeMember()&&resource.data.signatureEnvelopeId is string&&getAfter(/databases/$(database)/documents/signatureEnvelopes/$(resource.data.signatureEnvelopeId)).data.participantUids is list&&getAfter(/databases/$(database)/documents/signatureEnvelopes/$(resource.data.signatureEnvelopeId)).data.participantUids.hasAny([request.auth.uid])&&request.resource.data.signatureEnvelopeId==resource.data.signatureEnvelopeId&&request.resource.data.signatureOwnerUid==resource.data.signatureOwnerUid&&request.resource.data.signatureStatus in ["Draft","In Progress"]&&request.resource.data.diff(resource.data).affectedKeys().hasOnly(["signatureEnvelopeId","signatureReference","signatureStatus","signatureOwnerUid","workflowOwnerSectionSaved","workflowActionStatus","lastWorkflowAction","lastWorkflowActionUid","lastWorkflowActionAt","authorizationStatus","completedDocumentUrl","ownerCompletedDocumentUrl","ownerCompletedDocumentPath","ownerRecordStatus","lastCompletedDocumentHash","documentArchiveUid","documentArchiveFolderId","documentArchiveUidLink","documentArchivePath","documentArchiveAccess","governanceArchiveFolderId","governanceArchiveUidLink","governanceArchivePath","governanceArchiveSignedUrl","documentCustodianUid","documentCustodianRole","documentCustodyStatus","documentCustodyAssignedAt","documentClassification","updatedAt"])&&(request.auth.uid==resource.data.signatureOwnerUid||request.resource.data.lastWorkflowActionUid==request.auth.uid);}
+  function signatureDocumentWorkflowUpdate(){return activeMember()&&resource.data.signatureEnvelopeId is string&&getAfter(/databases/$(database)/documents/signatureEnvelopes/$(resource.data.signatureEnvelopeId)).data.participantUids is list&&getAfter(/databases/$(database)/documents/signatureEnvelopes/$(resource.data.signatureEnvelopeId)).data.participantUids.hasAny([request.auth.uid])&&request.resource.data.signatureEnvelopeId==resource.data.signatureEnvelopeId&&request.resource.data.signatureOwnerUid==resource.data.signatureOwnerUid&&request.resource.data.diff(resource.data).affectedKeys().hasOnly(["signatureEnvelopeId","signatureReference","signatureStatus","signatureOwnerUid","workflowOwnerSectionSaved","workflowActionStatus","lastWorkflowAction","lastWorkflowActionUid","lastWorkflowActionAt","authorizationStatus","documentArchiveUid","documentArchiveFolderId","documentArchiveUidLink","documentArchivePath","documentArchiveAccess","governanceArchiveFolderId","governanceArchiveUidLink","governanceArchivePath","governanceArchiveSignedUrl","documentCustodianUid","documentCustodianRole","documentCustodyStatus","documentCustodyAssignedAt","documentClassification","updatedAt"])&&(request.auth.uid==resource.data.signatureOwnerUid||request.resource.data.lastWorkflowActionUid==request.auth.uid);}
@@
   function signatureEnvelopeSignerUpdate(){
     return signedIn()&&
       resource.data.participantUids is list&&resource.data.participantUids.hasAny([request.auth.uid])&&
       resource.data.get("actionUids",[]) is list&&resource.data.get("actionUids",[]).hasAny([request.auth.uid])&&
       ((resource.data.get("signingMode","Sequential")=="Sequential"&&resource.data.get("currentSignerUid",null)==request.auth.uid)||
        resource.data.get("signingMode","Sequential")=="Parallel")&&
-      request.resource.data.lastSignedByUid==request.auth.uid&&
-      request.resource.data.status in ["In Progress","Completed"]&&
-      !request.resource.data.diff(resource.data).affectedKeys().hasAny(["senderUid","ownerUid","ownerEmail","participantUids","actionUids","recipients","fields","documentId","documentUrl","documentReference"]);
+      request.resource.data.status=="In Progress"&&
+      !request.resource.data.diff(resource.data).affectedKeys().hasAny(["senderUid","ownerUid","ownerEmail","participantUids","actionUids","recipients","fields","documentId","documentUrl","documentReference","lastSignedByUid","lastSignedAt","completedAt","completion","finalHash","gatewayFinalHash","originalDocumentHash","latestDocumentHash","lastCompletedDocumentHash","signedDocumentPath","signedDocumentUrl","ownerCompletedDocumentPath","ownerCompletedDocumentUrl","completedDocumentUrl","signedPdfReference","signedFileReference","cryptographicEvidenceIds"]);
@@
   function signatureEnvelopeAdminUpdate(){
     return admin()&&
-      !request.resource.data.diff(resource.data).affectedKeys().hasAny(["lastSignedByUid","lastSignedAt","signedDocumentPath","signedDocumentUrl","ownerCompletedDocumentPath","ownerCompletedDocumentUrl","ownerRecordStatus","originalDocumentHash","latestDocumentHash","workflowHistory","currentSignerUid","completedAt","documentCustodianUid","documentCustodianRole","documentCustodyStatus","documentCustodyAssignedAt"])&&
+      !request.resource.data.diff(resource.data).affectedKeys().hasAny(["lastSignedByUid","lastSignedAt","signedDocumentPath","signedDocumentUrl","ownerCompletedDocumentPath","ownerCompletedDocumentUrl","completedDocumentUrl","ownerRecordStatus","originalDocumentHash","latestDocumentHash","lastCompletedDocumentHash","finalHash","gatewayFinalHash","completion","signedPdfReference","signedFileReference","cryptographicEvidenceIds","workflowHistory","currentSignerUid","completedAt","documentCustodianUid","documentCustodianRole","documentCustodyStatus","documentCustodyAssignedAt"])&&
       request.resource.data.status in ["Draft","Sent","In Progress","Shared","Cancelled"];
@@
-  match /signatureEvents/{id}{allow read:if admin()||(signedIn()&&resource.data.actorUid==request.auth.uid);allow create:if ((admin()||activeMember())&&request.resource.data.actorUid==request.auth.uid)&&actualCreateAllowed();allow update:if (false)&&actualUpdateAllowed();allow delete:if (false)&&actualDeleteAllowed();}
+  function signatureEventActorAuthorized(){return request.resource.data.envelopeId is string&&exists(/databases/$(database)/documents/signatureEnvelopes/$(request.resource.data.envelopeId))&&(get(/databases/$(database)/documents/signatureEnvelopes/$(request.resource.data.envelopeId)).data.get("ownerUid","")==request.auth.uid||get(/databases/$(database)/documents/signatureEnvelopes/$(request.resource.data.envelopeId)).data.get("senderUid","")==request.auth.uid||(get(/databases/$(database)/documents/signatureEnvelopes/$(request.resource.data.envelopeId)).data.get("participantUids",[]) is list&&get(/databases/$(database)/documents/signatureEnvelopes/$(request.resource.data.envelopeId)).data.get("participantUids",[]).hasAny([request.auth.uid])));}
+  match /signatureEvents/{id}{allow read:if admin()||(signedIn()&&resource.data.actorUid==request.auth.uid);allow create:if signedIn()&&request.resource.data.actorUid==request.auth.uid&&signatureEventActorAuthorized()&&actualCreateAllowed();allow update:if (false)&&actualUpdateAllowed();allow delete:if (false)&&actualDeleteAllowed();}
```

## Collection-name mismatch: canonical audit collection

The retrieved rules already contain:

```javascript
match /audit/{id}{allow read:if admin()||auditor();allow create:if signedIn();allow update,delete:if false;}
```

The Worker audit writer uses `audit`, while the PR #515 acceptance test references `auditLogs`. The safest correction is to standardize the approval implementation and its tests on the existing canonical `audit` collection. Do NOT create a second audit collection merely to accommodate the typo. The Phase 2 code/test change must replace the `auditLogs` reference with `audit`; no additional Firestore match block is required for this correction.

## Required rules tests

1. **Signer cannot set Completed:** authenticated participant attempts to change `status` to `Completed`; expect permission denied.
2. **Signer cannot write completion hash:** participant attempts to change `finalHash`, `gatewayFinalHash`, `lastCompletedDocumentHash` or `cryptographicEvidenceIds`; expect permission denied.
3. **Signer cannot write signed-document references:** participant attempts to change `signedDocumentUrl`, `ownerCompletedDocumentUrl`, `completedDocumentUrl` or signed-file references; expect permission denied.
4. **Document lifecycle completion fields:** participant attempts to write the removed lifecycle completion fields; expect permission denied.
5. **Worker service-account write:** trusted Worker service-account commit writes Completed status, final hash, evidence IDs and signed-document references; expect success (exercise through the Worker integration fixture, not a client rules context).
6. **Signature event owner:** envelope owner creates an event with their own actor UID; expect success.
7. **Signature event participant:** listed participant creates an event with their own actor UID; expect success.
8. **Signature event unrelated member:** active member not in the envelope attempts to create an event; expect permission denied.
9. **Signature event spoofing:** participant supplies another actor UID; expect permission denied.
10. **Audit collection canonicalization:** approval test verifies the audit record is written to `audit`; assert that no approval audit write targets `auditLogs`.

## Approval gate

- This document is a review artifact only.
- No Firestore rules were changed.
- No rules deployment was run.
- Daniel must review and approve the exact diff before Phase 2 implementation.
