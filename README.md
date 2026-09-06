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

```bash
firebase deploy
```

Before production use, verify Firebase Authentication providers, authorized domains, Firestore rules, and the initial `adminProfiles/{uid}` administrator record in the Firebase Console.
