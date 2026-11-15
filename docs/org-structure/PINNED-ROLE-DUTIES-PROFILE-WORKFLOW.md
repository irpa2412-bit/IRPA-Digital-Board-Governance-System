# Pinned Role Duties on User Profiles

## Operating model

The dashboard resolves the signed-in user's current role from the selected authority and the existing employee/member profile fields. It matches those role titles against `config/org-structure-authority.json` and displays the approved purpose, key duties, and current appointment/engagement status in a pinned profile panel.

The same display is available to employees and Board Members. It is read-only for the holder. It does not depend on the `jobDescriptionWorkflows` Firestore collection and does not require manual administrator distribution.

## Executive Director / Board Secretary dual capacity

When the authenticated profile maps to Executive Director, the dashboard also displays the permanent Board Secretary employee office duties. These are distinct capacities held by the same incumbent; the dual display does not merge their governance and management authority.

## Appointment integrity

The role register records the Executive Director and Board Secretary as occupied. Board Chairperson and Treasurer are recorded as occupied, and Board Member as several occupied seats. Volunteer designations remain volunteer designations and do not imply employee appointment or formal directorate authority. Other positions remain vacant or unconfirmed unless the authoritative appointment register says otherwise.

## Amendments and version control

The Executive Director is the designated authority to initiate and approve amendments to role descriptions. Amendments must be versioned, attributable, dated, and preserve prior versions. The Administrator may not select holders, edit role descriptions, assign duties, or approve amendments.

This change records the amendment authority in the governance configuration and displays it on the Executive Director profile. It does **not** introduce a new client-side write path. The current Firestore rules do not provide an ED-only write target for the static role catalogue. Therefore, actual in-system amendment submission and persistence remain unavailable until a separately secured persistence mechanism is implemented and tested. No Firestore rules were changed in this release.

## Authority boundary

A pinned job description documents duties; it does not grant Firebase claims, portal permissions, approval powers, procurement authority, signature authority, bank-signatory status, or restricted research access. Existing appointment records, written delegations, Board resolutions, bank mandates, and server-side authorization remain authoritative.
