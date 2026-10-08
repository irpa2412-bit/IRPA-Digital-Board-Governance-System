# IRPA-DBGS App-Wide Readability Manual Verification

Branch: `audit/app-wide-readability-form-layout-20261008`

## Run locally

```bash
npm install
npm run check:token-contrast
npm run build
npm run dev -- --host 0.0.0.0
```

For a production-like local build:

```bash
npm install
npm run check:token-contrast
npm run build
npm run preview -- --host 0.0.0.0
```

If adding browser accessibility tooling locally:

```bash
npm i -D @playwright/test @axe-core/playwright
npx playwright install chromium
```

Playwright/axe should then be run against the local Vite/preview server. Do not point the test at production.

## Required viewport/zoom matrix

For every screen below test:
- 360px width at 100%, 125%, 150%
- 768px width at 100%, 125%, 150%
- 1280px width at 100%, 125%, 150%
- Light mode and dark mode
- No label overlap, clipping, truncation, or hidden values
- Inputs/selects/textareas: 16px entered text, readable placeholder, solid background, visible border, visible focus ring
- Form grids: one column below 768px; two columns at 768px and above
- Textareas: at least 120px tall and vertically resizable
- Checkbox/radio cards: control and label aligned and fully readable

## Screens and workspaces

### Authentication and special-entry screens
- Login / AuthScreen
- Invitation activation
- Invitation password setup
- Password reset modal / two-step recovery
- Access denied
- Startup error / recovery screen
- Signer invitation / signing entry
- Add Administrator

### Administrator / Executive workspace
- Dashboard
- Induction and Orientation
- Induction Applications
- Board Members Registration
- Members & Personnel
- Invitations
- Meetings
- Meeting Room
- Participants
- Resolutions
- Voting
- Actions
- Documents
- Signature Platform
- Decisions
- Risk Register
- Authorization & Approvals
- Employee Payments
- Finance Portfolio
- Procurement
- Research, Statistics and Knowledge
- Reports
- Audit Trail
- Downloads
- Settings
- Add Administrator
- External Auditor Portal
- Auditors & Special Invitees
- IT Operations

### Department/role workspaces
- Executive Office
- Internal Oversight
- Finance & Administration
- Human Resources
- Livestock
- Environment & Rangeland
- Outreach & Community Development
- Field Operations
- Operations
- Information Technology

For each department workspace, exercise its dashboard/landing card, module navigation, forms, tables, cards, drawers/modals and any role-specific action panels.

### Research / data screens
- Professional Data Collection / Instrument Builder
- Dataset Registry
- Research domain/version/language/description fields
- Structured Collection Fields
- Record/details views
- Statistical analysis and knowledge workbench

### Finance / operations
- Finance Portfolio
- Accounting/finance registers and tabs
- Procurement portal
- Donor/funder controls
- Payment forms
- Operational gateways
- IT Operations

### Document/signature
- PDF/document upload
- Document access point
- Signature Platform
- Signature authority/capacity selection
- Signing identity panel
- Signed-document view
- One modal containing form controls

## Screenshot evidence required

Capture before/after for:
1. Instrument Builder
2. Dataset Registry
3. Login
4. Invitation password setup
5. Each role workspace
6. PDF upload
7. Signature page
8. One modal

Name screenshots with viewport and zoom, for example:
`instrument-builder-360-150-light.png`.

## Accessibility scan

Run axe against every reachable route/workspace state that can be opened without changing security/data configuration. Record:
- total violations
- critical/serious/moderate/minor counts
- affected selector
- WCAG rule
- whether the violation is a false positive or requires source correction

Target: zero contrast violations.

## Pass/fail rule

Do not mark this branch fixed until:
- `npm run check:token-contrast` passes;
- `npm run build` passes;
- all required viewport/zoom/light-dark screens have been visually inspected;
- axe/Lighthouse contrast results are zero;
- no business/security/Worker/Firestore behavior has changed.
