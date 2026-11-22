# Social Studio inventory and consolidation

Baseline: main, inspected 2026-11-09. This inventory is source inspection only; it does not imply a production runtime check.

## Existing UI and data

| Area | Existing implementation | Persistence / route | Consolidation |
|---|---|---|---|
| Social Studio | src/pages/CommunicationsSocialStudio.jsx; bilingual single-language-at-a-time composer, templates, multi-platform selector, basic character counts, HTTPS URL fields, planned time, copy action and editorial queue | /api/communications/editorial/items and item submit/approve/reject routes | Retain as the single authoring/editor surface; expand missing controls and safety checks |
| Social Media Studio | Inline legacy editor in src/pages/CommunicationMediaPortal.jsx; separate form, template buttons, TXT export and saved social drafts | communicationMediaItems via /api/communications/records | Remove duplicate tab and inline editor; retain existing records untouched and make the unified Studio able to discover compatible records |
| Social Accounts | src/pages/SocialMediaAccounts.jsx; account register, status changes, metadata-only Meta staging OAuth controls and audit view | Firestore socialMediaAccounts, socialMediaAccountsAudit; Meta read-only staging routes | Rename tab to Social Account Register; keep separate from post creation and do not change collections or rules |
| Editorial queue | Part of CommunicationsSocialStudio.jsx; only basic load, status display and approve/return | /api/communications/editorial/items | Extend the single Social Studio editor; backend capabilities must be verified before relying on revision or export operations |
| Self-test | Portal Self-Test includes editorial route probes, missing-ID validation probes, social connection status and pause status | Authenticated Worker requests | Add explicit Social Studio checks without invoking any network publishing route |

## Built but not rendered / incomplete

- The legacy Social Media Studio tab contains its own editor and TXT export; it is rendered independently of the newer Social Studio component.
- The main portal already imports SocialMediaAccounts, but its tab label is Social Accounts.
- The standalone Social Studio supports English or Kiswahili per draft, not paired side-by-side drafts.
- Platform text character ceilings exist, but hashtag counts, media size guidance, upload/Media Library selection, required alt text, campaign/funder metadata and per-platform mobile previews are absent.
- The editor queue lacks search/filtering, duplication, explicit revision history/restore, calendar export and a recorded manually-posted URL/date workflow.
- Existing approvals are Worker-routed and independent-authority checks exist for editorial items; administrator role handling and role assignment must remain server-authoritative.
- Existing Social Accounts metadata and audit collections are separate from editorial items; no migration or deletion is part of consolidation.

## Safety boundaries

Social-network publishing remains OFF. The existing Meta OAuth path is staging-only/read-only. Do not add publishing endpoints, token scopes, scheduled jobs or automatic posting. Existing account and editorial records must be retained. No Firestore rules, secrets or production configuration are changed by this work.