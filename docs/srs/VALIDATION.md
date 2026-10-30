# SRS / Wireframe validation report
Date: 30 October 2026  
Baseline: main @ f20403e6f26c296f9d3aa3cda87588115a0f694d  
Scope: documentation-only static validation.

## Inventory checks
- Source top-level NAV modules: 31
- Registered nested sub-portals: 15
- Total page/sub-portal wireframes planned: 46
- Functional requirements: 55
- Unique requirement IDs: 55
- Worker route families listed: 66
- Firestore collection names catalogued: 81

## Findings
- PASS: each top-level NAV module has a stable page ID.
- PASS: each registered nested sub-portal has a stable page ID and parent mapping.
- PASS: every functional requirement has a unique ID, priority, acceptance criteria and portal mapping.
- PASS: Worker dispatch/delegated route families are included in SRS §4.4.
- PASS: collection names from the explicit COLLECTIONS registry and additional source references are listed.
- GAP: live app URL was inaccessible to unauthenticated inspection; no authenticated visual or runtime test was possible.
- GAP: source NAV has 31 top-level modules, not 26; nested sub-portals add 15. Confirm intended page-count baseline.
- GAP: responsive overflow, broken links and missing images cannot be browser-tested against the authenticated live application from this session.
- GAP: source contains temporary gateway disconnect and data-gate flags; release owners must resolve/confirm intent.
- GAP: WordPress/cPanel/social credentials and live connectivity not inspected; secret values intentionally not requested or printed.
- GAP: no complete DR/RPO/RTO or accessibility/performance conformance evidence found.

## Automated checks to run on the documentation branch
1. Check every SRS page ID against one matching `wireframes/<PAGE-ID>.html`.
2. Check every href in `index.html` resolves to a generated page.
3. Parse every HTML file and assert viewport meta, mobile CSS breakpoint, and state panels (empty/loading/error/offline).
4. Check all SVGs are inline or local; no remote image assets are required.
5. Use a browser at 390×844 and 1440×900 to test document scroll width and card overlap.
6. Re-run the same checks after fixing all reported failures.

## Result
Static inventory/traceability checks: PASS by generation. Live/browser viewport checks: NOT RUN / GAP. This report does not claim that browser rendering or production routes were exercised.

## Generated artifact checks
- Generated HTML wireframes: 51 (31 top-level modules + 15 nested sub-portals + 5 shared/flow screens).
- Every page and nested sub-portal has a matching page ID filename; the index lists the 51 HTML files.
- Each wireframe contains the shared shell, 390px responsive breakpoint, and EMPTY / LOADING / ERROR / OFFLINE state panels.
- Wireframe HTML uses inline CSS and does not depend on external images or remote assets.
- Index links are relative to the SRS package; final path-existence validation is performed against the committed tree.
- SRS exports: Word DOCX, 11-page PDF; wireframe bundle: 51-page PDF.
- Browser-based 390×844 and 1440×900 screenshots were not run because no authenticated browser session is available. CSS overflow/overlap is structurally mitigated but not runtime-certified.

## Final inventory extension
- Source page components under `src/pages/`: 41. Appendix D maps all 41 component files to a wireframe page ID.
- HTML wireframe pages: 72 = 31 top-level NAV modules + 15 nested sub-portals + 21 component/subsystem screens + 5 shared/flow screens.
- Wireframe index: 72 page links plus document/report links.
- PDF wireframe bundle: 72 pages.
- SRS export regenerated from the final Markdown source: DOCX and 12-page PDF.
- Dataset Registry, Research Data Collection, Release Readiness and Signature Pathway Self-Test have dedicated component-level wireframes; these are not falsely described as top-level NAV entries.

## Final static validation snapshot (branch tree)
- Unique requirement IDs: 55 / 55.
- Core deliverables present: SRS.md, SRS.docx, SRS.pdf, WIRE_FRAMES.pdf, VALIDATION.md.
- HTML wireframe pages: 72 expected; index page is separate.
- Index link existence: checked against the committed branch tree; broken links: 0.
- Sampled HTML pages: viewport meta, mobile breakpoint, EMPTY/LOADING/ERROR/OFFLINE states all present; no remote image dependency.
- Remaining unexecuted checks: authenticated live browser inspection and actual 390×844 / 1440×900 rendering; do not interpret responsive CSS presence as proof of zero visual overflow.
