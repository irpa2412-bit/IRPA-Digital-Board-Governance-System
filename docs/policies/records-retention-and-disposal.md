# Records Retention and Disposal Policy

**Status:** Owner-recorded policy  
**Recorded:** 22 November 2026  
**Scope:** IRPA-DBGS meeting records, proceedings and associated documents

## 1. Owner's recorded instruction

The following is the owner's instruction, quoted verbatim (including the subsequent amendment):

> POLICY RECORDED, no change to the #845 plan. Do not weaken any check, and do not publish Firestore rules.
>
> 1. Merge #845 as already planned (it is consistent with this policy and stricter than it today). Do not add the policy to #845.
> 2. In the wind-up, add docs/policies/records-retention-and-disposal.md (docs only), quoting my words and recording: (a) no real meeting record may be deleted by anyone; (b) all proceedings are retained for not less than 10 years from the meeting date and can be disposed of only through a procedural process that includes seeking authorisation; (c) irrelevant documents may be deleted only with authorisation from the Executive Director, and the authorisation document must first be reviewed and duly signed by the Director of Internal Oversight; (d) trial meetings remain deletable by an administrator, with the safeguards decided earlier; (e) the administrator executes a disposal but cannot decide it; (f) every disposal leaves a permanent audit entry with the document's SHA-256 hash.  
> 3. Put in docs/HANDOVER.md, as the first task for the next session, a small PR for the retention lock and the disposal procedure: a retainUntil date of meeting date plus 10 years on every real proceedings record, enforced by the Worker (no disposal before it, no matter who asks); a disposal request workflow built on the signature portal and the authorisation matrix (request, then signature of the authorisation document by the Director of Internal Oversight, then authorisation by the Executive Director, then execution by an administrator, with a legal-hold flag and a recorded reason); no deletion button for real records anywhere; and a check of how the roles "Director of Internal Oversight" and "Executive Director" exist in the member register today (report if either is missing).
>
> AMENDMENT TO THE POLICY: the 10-year retention period counts from the day of the proceedings (the meeting date), not from the signing date. For a meeting that runs over several days, count from its final day. Update docs/policies/records-retention-and-disposal.md and the first task in docs/HANDOVER.md accordingly: retainUntil = the proceedings date + 10 years, and every minute, resolution, vote, attendance record, action and recording of that meeting inherits the same retainUntil. Docs only. Nothing else changes: #845 still merges as planned, with no code change.

## 2. Retention rule for real proceedings

1. No real meeting record may be directly deleted by any person, including an administrator. A real proceedings record may be disposed of only through the formal, authorised disposal procedure in this policy, and never before its retention deadline.
2. The retention period is **not less than ten (10) years from the proceedings date**. The proceedings date is:
   - the meeting date for a single-day meeting; or
   - the final day of proceedings for a meeting spanning multiple days.
3. The date of signing, approval, upload, transcription, or later filing does not start or reset the retention period.
4. For every real meeting, the following records inherit one identical `retainUntil` value: every minute, resolution, vote, attendance record, action record and audio/video or other recording of that meeting, together with any other record constituting or evidencing its proceedings.
5. The required value is `retainUntil = proceedings date + 10 calendar years`. The calculation must use the final proceedings date for a multi-day meeting. The Worker must enforce the deadline server-side. No user, role, administrator, request, approval, or alternate client path may bypass the prohibition on disposal before `retainUntil`.
6. If a legal hold applies, disposal is blocked irrespective of the elapsed retention period. A legal hold must be recorded and remain effective until formally released through an authorised process.

## 3. Authorised disposal of real proceedings

After the full retention period has elapsed, disposal is still not automatic. It may proceed only through a documented procedural process that seeks and records the required authorisations:

1. A disposal request identifies each record, its meeting, proceedings date, `retainUntil`, SHA-256 hash, reason for proposed disposal, and legal-hold status.
2. The proposed authorisation document must first be reviewed and duly signed by the **Director of Internal Oversight**.
3. The signed authorisation document is then submitted to the **Executive Director** for the Executive Director's authorisation.
4. Only after both preceding steps are complete, and all retention, legal-hold and other applicable safeguards pass, may an administrator execute the approved disposal.
5. The administrator is an executor only. The administrator cannot decide that a record is irrelevant, approve its disposal, substitute for either required authority, or bypass the workflow.
6. The Worker must enforce the sequence and authority checks. A request, signature, approval, or administrator action cannot override an unexpired `retainUntil` date or an active legal hold.

## 4. Irrelevant documents

A document determined to be irrelevant may be deleted only with authorisation from the **Executive Director**. The authorisation document must first be reviewed and duly signed by the **Director of Internal Oversight**. The review/signature must precede the Executive Director's authorisation. An administrator may execute the authorised disposal but may not make the relevance determination or grant authorisation.

This provision does not classify any real meeting minute, resolution, vote, attendance record, action or recording as an irrelevant document, and does not shorten the mandatory retention period for proceedings.

## 5. Trial meetings

Trial meetings remain deletable by an administrator, subject to the previously established safeguards. The authoritative meeting environment must explicitly identify the meeting as `TRIAL`; missing, invalid or ambiguous environment values are treated as `REAL`. The administrator-only and existing legal-hold, retention, pending-review and version safeguards remain in force. A real or unclassified meeting must not be treated as a trial meeting.

## 6. Permanent disposal audit

Every executed disposal must leave a permanent, tamper-evident audit entry containing, at minimum:

- the disposed document's SHA-256 hash;
- stable document and meeting identifiers;
- the proceedings date and `retainUntil`, where applicable;
- the recorded reason and legal-hold status;
- the disposal request and authorisation-document references;
- the Director of Internal Oversight's review/signature evidence;
- the Executive Director's authorisation evidence;
- the administrator who executed the disposal and the execution timestamp; and
- the outcome of the disposal.

The audit entry is retained permanently and is not deleted with the disposed document.

## 7. Implementation boundary

This document records policy; it does not itself implement runtime enforcement. The next implementation change is a separate, small, docs-referenced PR as specified first in `docs/HANDOVER.md`. No policy change is to be added to PR #845. No Firestore rules are to be published as part of this work.

## 8. Finance and Procurement records (DRAFT, to be confirmed)

**Status:** Proposed default only. This section is not a final owner-approved retention schedule and does not implement or change portal behaviour.

The owner's recorded words are:

> The deletion policy may apply to procurement and financial portals as well.

For the owner's confirmation, the following is proposed as the default:

1. **No deletion of real records:** no real financial or procurement record may be deleted by anyone. This proposed scope includes payments, invoices, requisitions, quotations, tenders, evaluations, awards, purchase orders, receipts, budgets, ledgers, payroll and payment requests. The prohibition is intended to apply to all actors, including administrators, unless and until the owner confirms a formal disposal policy.
2. **Retention period — OPEN QUESTION:** the owner has not yet decided the retention period for financial and procurement records. The meeting/proceedings rule elsewhere in this policy is ten (10) years from the proceedings day; that rule must not be assumed to apply automatically to finance or procurement records. The responsible person must check applicable donor agreements and Tanzanian legal requirements, document the findings and recommend a period for the owner's decision. No finance/procurement retention duration is established by this draft.
3. **Authorised disposal of an irrelevant document:** proposed disposal of an irrelevant finance or procurement document must follow the same authority chain: the authorisation document is first reviewed and duly signed by the Director of Internal Oversight, then the Executive Director authorises disposal. An administrator may execute only after those steps and applicable safeguards; the administrator does not decide relevance or authorise disposal.
4. **Trial/test exception:** trial or test financial and procurement records may be deleted by an administrator, subject to safeguards equivalent to those for trial meetings, only when the record carries an explicit authoritative TRIAL flag. Missing, invalid or ambiguous environment/classification values must not be treated as TRIAL and default to real-record protection.
5. **Permanent disposal audit:** every disposal leaves a permanent audit entry containing the disposed document's SHA-256 hash and the applicable request, review, authorisation, executor, reason and timestamp evidence. The audit entry must not be deleted with the disposed record.

**Confirmation required:** the owner must confirm or amend this proposed default, particularly the scope, retention period, trial safeguards and disposal process. Until confirmed, treat this section as a policy proposal for review, not an implemented rule or an approved finance/procurement retention schedule.
