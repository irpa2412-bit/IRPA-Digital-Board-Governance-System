# SRS / Wireframe validation report

Date: 30 October 2026  
Repository baseline inspected: `main` @ `f20403e6f26c296f9d3aa3cda87588115a0f694d`  
Documentation branch: `docs/srs-wireframes-20261030`  
Scope: static repository validation only. No application code, Firestore rules, secrets, production configuration or deployment changed.

## Inventory

| Item | Verified count |
|---|---:|
| Top-level NAV modules in source | 31 |
| Registered nested sub-portals | 15 |
| Source page components under `src/pages/` | 41 |
| Additional component/subsystem wireframes | 21 |
| Shared shell / authentication / flow wireframes | 5 |
| Page-specific HTML wireframes | 72 |
| HTML files including the wireframe index | 73 |
| Functional requirements | 55 |
| Unique functional requirement IDs | 55 |
| Gateway route families in SRS | 66 listed in primary inventory, plus separately delegated route families in Appendix C |
| Firestore collection names catalogued | 81 |

The user-specified “26 pages” does not match the current source navigation. The source NAV contains 31 top-level modules; 15 additional nested sub-portals are separately registered. The SRS does not force the inventory to 26.

## Static validation results

- PASS — SRS, DOCX, SRS PDF, wireframe PDF, validation report and wireframe index are present in `docs/srs/`.
- PASS — 55 functional requirement IDs parsed from the §3 requirement table; all 55 are unique; no duplicate IDs found.
- PASS — each requirement row includes a priority, acceptance criteria and a portal/page mapping.
- PASS — requirement-to-page-to-test traceability is provided in §10.3 by requirement family. Individual test coverage for every acceptance criterion is not claimed; where direct tests are absent, the SRS labels additional tests PROPOSED.
- PASS — 72 HTML wireframe page files are present, plus the separate index page.
- PASS — the index contains 72 page links; every relative HTML link resolves to a file in the committed branch tree (0 missing links).
- PASS — sampled wireframe HTML includes a viewport meta tag, a narrow-screen CSS breakpoint, and EMPTY / LOADING / ERROR / OFFLINE state panels.
- PASS — sampled wireframe uses inline CSS and has no external image dependency. Wireframes use illustrative placeholders, not fabricated screenshots or real records.
- PASS — page/component cross-reference is included in SRS Appendix D; 41 source page components are mapped to stable wireframe IDs.
- PASS — separate Worker boundaries are identified: Drive Gateway, grant crawler Worker and frontend static-asset Worker. The grant crawler is not misrepresented as a Drive Gateway route.
- NOT RUN — full automated HTML validation across all 72 files could not complete within the available repository-tool call budget. No assertion is made that every HTML file was independently parsed.
- NOT RUN — PDF binary page-count inspection and DOCX package-open validation were not executed in this environment. The generated export metadata in the SRS describes a 12-page SRS PDF and 72-page wireframe PDF.
- NOT RUN — browser-based rendering at exact 390×844 and 1440×900 dimensions; actual overflow, overlap, keyboard navigation and visual fidelity remain unverified.

## Failures / gaps found

1. **Page-count discrepancy (GAP):** request says 26 pages; source NAV has 31 top-level modules plus 15 nested sub-portals. Decision: confirm whether “26” referred to an older app version or a selected subset.
2. **Live app inspection (GAP):** the public live URL could not be authenticated/inspected in this session. Live role assignments, records, route health and provider connectivity were not tested.
3. **Visual viewport testing (GAP):** no authenticated browser/device session was available. Responsive CSS is present in sampled wireframes, but this is not proof of zero visual overflow at target dimensions.
4. **Requirement-to-test granularity (GAP):** every requirement maps to a page; the traceability table maps test sources by requirement family. A one-test-per-requirement acceptance matrix is not evidenced. Add those tests as PROPOSED where required.
5. **PDF/DOCX integrity (GAP):** package-open and rendered page-count checks remain to be run in Word/LibreOffice or an automated document validation pipeline.
6. **Production integrations (GAP):** no live probes were made for Firebase, Google Drive, SMTP, WordPress, cPanel, social providers or LiveKit. Secrets were not requested or exposed.
7. **Operational quality targets (GAP):** no approved SLA, RPO/RTO, retention schedule, load target, accessibility conformance statement or quota budget was found.
8. **Release flags (GAP):** source contains environment/data-gate and temporary gateway-disconnect controls; owners must confirm intended release posture before enabling production functionality.

## Residual decisions for IRPA

- Confirm the intended page-count baseline (26 versus the current 31 top-level + 15 nested).
- Confirm whether the source-derived roles and permission categories match the approved Board/HR register.
- Approve data retention, legal hold, backup, RPO/RTO and disaster-recovery targets.
- Approve accessibility target (recommended WCAG 2.2 AA) and performance/load targets.
- Confirm whether Grant Intelligence is discovery/analysis only or whether a future donor-application submission workflow is required (not assumed implemented).
- Confirm the release state and ownership of Actual/Trial gate and temporary gateway-disconnect flags.
- Schedule authenticated browser acceptance at 390×844 and 1440×900 and integration smoke tests.

## Final status

Static tree inventory and index-link checks: PASS. Requirement ID uniqueness: PASS (55/55). Live application, full HTML parser sweep, exact viewport rendering and binary document validation: NOT RUN / GAP. Documentation is submitted for review, not deployed or merged.
