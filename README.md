# IRPA Digital Board Governance System

Clean React/Vite rebuild aligned to the original IRPA governance gateway layout.

## Preserved layout

- Dark IRPA governance interface
- Left navigation with Governance / Finance / Evidence / System sections
- Administrator profile panel
- Gateway top bar
- Governance Control Centre dashboard
- Board Members, Participants, Meetings, Meeting Room
- Transcription & Proceedings
- Resolutions, Voting, Actions, Documents
- Signature Platform
- Decisions, Risk Register
- Finance Portfolio
- Reports and Audit Trail
- System Settings

The source evidence for this structure is retained in the IRPA HTML versions previously supplied. The original interface explicitly used these navigation sections and modules.

## Rebuilt application architecture

- React 19 + Vite
- Firebase Authentication
- Firestore
- Firebase Storage
- Email/password authentication
- One-time email-link administrator sign-in
- Google sign-in configuration
- Role-aware Firestore rules
- Controlled invitations collection
- Document authorization model
- Signature records
- Immutable audit collection
- Meeting-linked governance records

## Important

The uploaded historical HTML exports contained the interface and Firebase configuration but did not contain a complete React `src/main.jsx` application implementation. Therefore this package is a clean reconstruction, not a claim that missing source was recovered verbatim.

## Run

```bash
npm install
npm run dev
```

## Production

```bash
npm run build
firebase deploy
```

Before production use, verify Firebase Authentication providers, authorized domains, Firestore rules, Storage rules, and the initial `adminProfiles/{uid}` administrator record in the Firebase Console.
