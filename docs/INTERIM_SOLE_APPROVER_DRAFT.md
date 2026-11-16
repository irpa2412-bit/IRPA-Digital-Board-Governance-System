# Interim Sole-Approver Mode — Draft Owner Documents

**Status: PROPOSED DRAFT — NOT EFFECTIVE.** These documents do not enable the feature, authorise a live action, change a bank mandate, or replace any applicable legal requirement. The runtime feature must remain disabled until separately implemented, tested, and explicitly authorised by the owner.

## 1. Founder's Authorisation Declaration

I, the Founder and sole owner of IRPA, declare the following proposed temporary control for the Signature and Communication & Media portals only:

1. **Purpose and scope.** This is a temporary operational exception for the period before IRPA has additional authorised personnel. It applies only to website publishing in Communication & Media and document signing in Signature. It does not apply to other portals or workflows.
2. **Activation.** The application must implement a dedicated configuration flag that is OFF by default. It may be enabled only by a new, explicit owner authorisation recorded with the authenticated owner identity, timestamp, scope, and reason. This declaration is not itself an activation event.
3. **Limited exception.** While enabled, the application may relax only (a) the requirement that the website content author and approver be different people, and (b) the requirement for a second signer on a document. The owner is the sole interim approver/signer for those two actions.
4. **Controls that remain mandatory.** Authentication, verified signer identity, author/approver attribution, audit trail, document hashing, signature verification, tamper detection, access control, and all other workflow controls remain in force. Every action performed under the exception must be visibly labelled **“interim sole-approver”** and logged as such.
5. **No payment authority.** Additional payment authority under this mode is **USD 0**. The application grants no authority to initiate, approve, authorise, or release payments. Payments remain governed by the bank's applicable signatory mandate. This declaration does not interpret, amend, or replace that mandate.
6. **No assumed institutional instruments.** This declaration does not assert that a Board resolution, approved financial policy, or other institutional instrument exists. Any such instrument must be independently verified before it is relied upon.
7. **Readiness and sealing.** The owner may use the proposed “Declare functional and seal” action only after the system has stored the complete readiness reports from both AI reviewers. Each live test for both portals must be marked PASS, FAIL, or NOT VERIFIED. Any FAIL blocks sealing. Each NOT VERIFIED item requires the owner's written acceptance, recorded against that specific item. AI reviewers provide advice only and are not independent human approvers.
8. **Seal effect.** A successful seal must turn the mode OFF and permanently record the authenticated owner, date, time, the complete list of every item approved or signed while the mode was active, and the full contents and timestamps of both readiness reports. The seal record must contain this exact statement: **“Sealed by the owner on the advice of two AI reviewers; AI reviewers are advisory, not independent human approvers.”**
9. **Re-enablement.** A sealed mode cannot be re-enabled by a toggle, administrator, scheduled task, or inherited setting. Re-enablement requires a new explicit owner authorisation and a new recorded activation event.

**Owner authorisation (to be completed only when the implementation is ready):**

- Owner name: __________________________________
- Authenticated owner account / UID reference: __________________________________
- Scope authorised: Signature and Communication & Media only
- Staging feature flag key and value: __________________________________
- Reason and duration: __________________________________
- Date and time (system recorded): __________________________________
- Owner confirmation: __________________________________

## 2. Owner's Sealing Checklist

The application must enforce this checklist; it is not merely advisory.

### A. Reports and test inventory
- [ ] A complete readiness report from reviewer 1 is stored, with its original full contents and received timestamp.
- [ ] A complete readiness report from reviewer 2 is stored, with its original full contents and received timestamp.
- [ ] Both reports enumerate every live test for Signature and Communication & Media.
- [ ] Every live test has exactly one status: PASS, FAIL, or NOT VERIFIED.
- [ ] The system has reconciled the two reports into one itemised readiness register without silently dropping or merging conflicting results.
- [ ] Every report and each test item is linked to the correct portal, test name, environment, run/reference, reviewer, and timestamp.

### B. Owner decision
- [ ] No item is marked FAIL. If any item is FAIL, sealing is blocked.
- [ ] Every NOT VERIFIED item has a specific written owner acceptance. A general or blanket acceptance is insufficient.
- [ ] The owner has reviewed the list of every item approved or signed while interim mode was active.
- [ ] The owner has confirmed that no payment authority was granted (USD 0 additional authority).

### C. Seal operation
- [ ] The authenticated owner alone can invoke “Declare functional and seal”.
- [ ] The action re-checks all conditions on the server at the moment of sealing.
- [ ] The complete contents and timestamps of both reports are stored immutably in the seal record.
- [ ] The complete interim action inventory is stored in the seal record.
- [ ] The authenticated owner identity, seal date, and seal time are stored.
- [ ] The exact advisory statement is stored: “Sealed by the owner on the advice of two AI reviewers; AI reviewers are advisory, not independent human approvers.”
- [ ] The feature flag is set to OFF as part of the same authoritative seal operation.
- [ ] The system verifies and records that the mode is OFF after sealing.
- [ ] Any later re-enablement is blocked unless a new explicit owner authorisation is recorded.

## 3. Interim Signing and Publishing Matrix

| Activity | Interim actor | Separation exception | Mandatory controls | Payment authority |
|---|---|---|---|---|
| Communication & Media — website publishing | Owner authors and approves the website content | Author and approver may be the same person only while the feature flag is enabled | Authentication; owner identity; content/version history; approval and publish audit events; visible **“interim sole-approver”** label; tamper-evident logs | None |
| Signature — document signing | Owner signs as the sole interim signer | Second-signer requirement may be relaxed only while the feature flag is enabled | Authentication; verified signer identity and authority record; document hash; signature verification; tamper checks; immutable audit event; visible **“interim sole-approver”** label | None |
| Payments — initiation | No authority granted by this mode | No exception | Existing bank mandate governs; the application must not grant or imply payment initiation authority | **USD 0 additional** |
| Payments — approval | No authority granted by this mode | No exception | Existing bank mandate governs; the application must not grant or imply payment approval authority | **USD 0 additional** |
| Payments — release | No authority granted by this mode | No exception | Existing bank mandate governs; the application must not grant or imply payment release authority | **USD 0 additional** |

**Interpretation:** “Owner only” in this matrix is a narrowly scoped interim workflow exception, not a general delegation of authority. It does not change the identity of the signer, create bank authority, bypass authentication, or authorise payments.
