# IRPA Digital Board Governance System

React/Vite application for the digital governance, authorization, finance and employee-management workspace of Improvement of Rangeland in Pastoral Areas (IRPA).

## Current structure

- Dark IRPA governance interface
- Governance / Finance / Evidence / System navigation
- Administrator and authorized-user access control
- Dashboard
- Invitations
- Members & Personnel / Employees
- Meetings and integrated proceedings workspace
- Resolutions
- Voting
- Employee Payments
- Generic governance registers for the remaining planned modules

## Application architecture

- React 19 + Vite
- Firebase Authentication
- Firestore
- Email/password authentication
- Google sign-in configuration
- Administrator email-link sign-in
- Role-aware application access
- Firestore security rules
- Controlled invitations
- Meeting-linked governance records
- Anonymous voting records with separate participation controls
- Immutable audit records

## Governance workflow

The intended governance chain is:

**Meeting → Proceedings → Resolution → Voting → Decision → Action → Accountability**

The repository currently contains the Meeting, Resolution and Voting foundations. The remaining workflow integrations are deliberately being completed only after the repository and application foundation has been cleaned and verified.

## Repository hygiene

The repository contains only the active production source tree and required Firebase/Vite configuration. Historical ZIP archives, obsolete nested source trees and temporary public test artifacts are not part of the active application.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Firebase deployment
<!-- Production deployment trigger: 2026-09-22 admin authorization synchronization -->

```bash
firebase deploy
```

Before production use, verify Firebase Authentication providers, authorized domains, Firestore rules, and the initial `adminProfiles/{uid}` administrator record in the Firebase Console.

<!-- Induction gateway migration deployment trigger: 2026-09-23 -->

<!-- Sign-in cleanup deployment trigger: 2026-09-23 -->

<!-- Induction questions consolidated deployment trigger: 2026-09-23 -->

<!-- Gateway pathway/data audit deployment trigger: 2026-09-23 -->


## PDF Upload and E-Signature Module

The controlled repair branch contains the isolated PDF upload/e-signature implementation under `drive-gateway/src/`. Run `cd drive-gateway && npm install && npm test` for the 18-case CI suite. The module remains isolated until adapter and Worker-route integration is explicitly approved.

## Assessment remediation and release evidence

The current remediation priorities, operational prerequisites, acceptance criteria, and controlled-release procedure are tracked in [the Assessment Remediation Runbook](docs/ASSESSMENT_REMEDIATION_RUNBOOK.md).

The repository also contains more modules and supporting services than the short historical list above. Treat the module list as a high-level summary, not a complete inventory. The assessment remediation gates validate the dependency audit, production build, selected governance policy tests, and a Playwright app-shell smoke test. A passing smoke test is not a substitute for full authenticated end-to-end tests or an independent security assessment.

### Verification commands

```bash
npm ci
npm audit --audit-level=high
npm run build
npx playwright install chromium
npx playwright test
```

Firestore rules tests require the Firebase emulator and should be run through the existing security-baseline workflow. Production promotion remains blocked until the exact candidate passes all required gates and the operational controls in the runbook have been verified.
