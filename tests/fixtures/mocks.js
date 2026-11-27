import React from "react";
const STORE_KEY = "irpa-meeting-fixture-v1";
const clone = value => JSON.parse(JSON.stringify(value));
function initialStore() {
  return {
    nextId: 1,
    meetings: [{
      id: "TEST-meeting-001",
      title: "TEST — Previously Scheduled Board Meeting",
      meetingType: "Board Meeting",
      meetingCategory: "GOVERNANCE",
      meetingPolicyId: "GOVERNANCE",
      meetingPlatform: "IRPA-DBGS Meeting Room",
      date: "2027-01-15",
      startTime: "10:00",
      endTime: "11:00",
      chairperson: "TEST Fixture Chairperson",
      agenda: "1. Confirm the agenda\n2. Review the work plan",
      status: "Scheduled",
      registerStatus: "Registered",
      registeredAt: "2026-11-20T09:00:00.000Z",
      initiatorUid: "fixture-board-secretary-uid",
      meetingHostUid: "fixture-board-secretary-uid",
      initiatorEmail: "board-secretary@example.test",
      initiatorName: "TEST Fixture Board Secretary",
      memberUids: [], participantUids: [], participants: [], attendees: []
    }],
    members: [
      { id: "fixture-board-member-active", name: "TEST Active Board Member", role: "Board Member", boardMember: true, status: "Active", email: "board-member@example.test", memberNumber: "TEST-BM-001", uid: "fixture-board-member-auth-uid" },
      { id: "fixture-board-member-inactive", name: "TEST Inactive Board Member", role: "Board Member", boardMember: true, status: "Inactive", email: "inactive@example.test", memberNumber: "TEST-BM-002", uid: "fixture-board-member-inactive-uid" },
      { id: "fixture-ordinary-member", name: "TEST Ordinary Member", role: "Member", boardMember: false, status: "Active", email: "ordinary@example.test", memberNumber: "TEST-M-001", uid: "fixture-ordinary-member-uid" }
    ],
    employees: [{ id: "fixture-board-secretary-employee", uid: "fixture-board-secretary-uid", name: "TEST Fixture Board Secretary", email: "board-secretary@example.test", role: "Board Secretary", department: "Board Secretariat", status: "Active", employeeNumber: "TEST-EMP-001" }], participants: [], resolutions: [], decisions: [], actions: [],
    meetingSubscriptions: [], votes: [], meetingRoomEvents: [], meetingRecords: [],
    meetingDailyAttendance: [], dailyAttendanceDispatches: {}, meetingWorkingDocuments: []
  };
}
function readStore() {
  if (typeof window === "undefined") return initialStore();
  const stored = window.localStorage.getItem(STORE_KEY);
  if (!stored) { const seeded = initialStore(); window.localStorage.setItem(STORE_KEY, JSON.stringify(seeded)); return seeded; }
  try { return JSON.parse(stored); }
  catch { const seeded = initialStore(); window.localStorage.setItem(STORE_KEY, JSON.stringify(seeded)); return seeded; }
}
function writeStore(value) { if (typeof window !== "undefined") window.localStorage.setItem(STORE_KEY, JSON.stringify(value)); }
function recordAction(action) {
  if (typeof window === "undefined") return;
  window.__irpaFixtureActions = [...(window.__irpaFixtureActions || []), { ...action, testOnly: true, emailSent: false }];
}
export const COLLECTIONS = {
  meetings: "meetings", members: "members", employees: "employees", participants: "participants",
  resolutions: "resolutions", decisions: "decisions", actions: "actions",
  meetingSubscriptions: "meetingSubscriptions", votes: "votes", meetingRoomEvents: "meetingRoomEvents"
};
const hostUser = {
  uid: "fixture-board-secretary-uid", email: "board-secretary@example.test",
  displayName: "TEST Fixture Board Secretary",
  getIdToken: async () => "TEST-FIXTURE-TOKEN",
  getIdTokenResult: async () => ({ claims: { irpaRoles: ["Board Secretary"] } })
};
export const auth = { currentUser: { ...hostUser } };
export const db = { fixtureOnly: true };
export function setFixtureActor(kind = "host") {
  auth.currentUser = kind === "outsider" ? {
    uid: "fixture-outsider-uid", email: "outsider@example.test", displayName: "TEST Unauthorised Outsider",
    getIdToken: async () => "TEST-OUTSIDER-TOKEN",
    getIdTokenResult: async () => ({ claims: {} })
  } : { ...hostUser };
  recordAction({ type: "actor-switch", actor: kind });
}
export async function getCurrentMemberProfile() { return null; }
export async function getCurrentEmployeeProfile() {
  return auth.currentUser.uid === hostUser.uid
    ? { uid: hostUser.uid, email: hostUser.email, name: hostUser.displayName, role: "Board Secretary", department: "Board Secretariat", status: "Active", employmentStatus: "Active", employeeNumber: "TEST-EMP-001" }
    : null;
}
export async function getAdminProfile() { return null; }
export async function getRecords(collection) { return clone(readStore()[collection] || []); }
export async function getMyMeetingSubscriptions() { return clone(readStore().meetingSubscriptions || []); }
export async function getAccessibleMeetingRecords() {
  const meetings = readStore().meetings || [];
  if (auth.currentUser?.uid === hostUser.uid) return clone(meetings);
  return clone(meetings.filter(meeting => String(meeting.initiatorUid || meeting.meetingHostUid || meeting.ownerUid || "") === String(auth.currentUser?.uid || "")));
}
export async function getRecord(collection, id) { return clone((readStore()[collection] || []).find(record => String(record.id) === String(id)) || null); }
export async function createRecord(collection, payload) {
  const store = readStore();
  const id = `TEST-${collection}-${store.nextId++}`;
  const row = { ...clone(payload), id };
  store[collection] = [...(store[collection] || []), row];
  if (collection === "meetings") {
    const baseParticipants = (payload.participants || []).map((p, i) => ({
      ...clone(p), id: `TEST-participant-${store.nextId}-${i + 1}`, meetingId: id,
      participantUid: p.uid || p.participantUid || null,
      participantEmail: String(p.email || p.participantEmail || "").toLowerCase(),
      participantName: p.name || p.participantName || "TEST Registered Participant",
      participantRole: p.role || p.participantRole || "Board Member",
      participantType: p.participantType || "Member",
      invitationStatus: "TEST_ACCEPTED", meetingAccessDispatched: true,
      meetingAccessDispatchStatus: "TEST_DISPATCHED", status: "Active",
      sourceType: p.sourceType || "member register"
    }));
    const guests = [1, 2, 3].map(position => ({
      id: `TEST-guest-${store.nextId}-${position}`, meetingId: id,
      participantUid: null, uid: null, userId: null,
      participantEmail: "shared-guest@example.test",
      email: "shared-guest@example.test",
      participantName: `TEST Guest — Position ${position}`,
      name: `TEST Guest — Position ${position}`,
      participantRole: `External Participant — Position ${position}`,
      role: `External Participant — Position ${position}`,
      participantType: "External Participant", sourceType: "manual invitee",
      invitationStatus: "TEST_ACCEPTED", meetingAccessDispatched: true,
      meetingAccessDispatchStatus: "TEST_DISPATCHED", status: "Active"
    }));
    store.participants = [...(store.participants || []), ...baseParticipants, ...guests];
    store.meetingDailyAttendance = [...(store.meetingDailyAttendance || []),
      ...[...baseParticipants, ...guests].map(p => ({
        id: `TEST-daily-${p.id}`, meetingId: id, participantId: p.id,
        participantUid: p.participantUid || null, attendanceDate: payload.date,
        attendanceStatus: "Present", recordedByUid: "TEST-fixture", recordedAt: "2026-11-20T09:00:00.000Z"
      }))
    ];
    store.meetingRecords = store.meetingRecords || [];
  }
  writeStore(store);
  recordAction({ type: "record-create", collection, id, label: "TEST RECORD" });
  return id;
}
export async function updateRecord(collection, id, patch) {
  const store = readStore();
  store[collection] = (store[collection] || []).map(record => String(record.id) === String(id) ? { ...record, ...clone(patch) } : record);
  writeStore(store); return { id };
}
export async function deleteRecord(collection, id) {
  const store = readStore();
  store[collection] = (store[collection] || []).filter(record => String(record.id) !== String(id));
  writeStore(store); return { id };
}
export async function openVotingIssue(payload = {}) { const store = readStore(); const issue = { id: `TEST-vote-${store.nextId++}`, ...(payload || {}), status: "Open" }; store.votes.push(issue); writeStore(store); recordAction({ type: "resolution-vote-open", issueId: issue.id }); return issue; }
export async function listMeetingRecords(meetingId) { return clone(readStore().meetingRecords.filter(r => r.meetingId === meetingId)); }
export async function retrieveMeetingRecord(id) { return clone(readStore().meetingRecords.find(r => r.id === id) || null); }
export async function saveMeetingAssistantDraft() { return { id: "TEST-draft-001" }; }
export async function compileAndEmailMeetingReport() { recordAction({ type: "report-mock", stage: "TEST_ONLY_NO_EMAIL" }); return { ok: true, emailSent: false }; }
export async function saveLiveMeetingProceedings() { return { version: 1, testOnly: true }; }
export async function uploadMeetingProductToDrive() { throw new Error("External storage is disabled in this isolated TEST fixture."); }
export async function provisionAllMeetingCategoryArchives() { return { testOnly: true, created: 0 }; }
export async function listMeetingBoardMembers() {
  return clone(readStore().members.filter(m => m.boardMember === true && ["active", "activated"].includes(String(m.status || "").toLowerCase())));
}
export async function listMeetingPeople() {
  const directory = await listMeetingInviteeDirectory();
  const rows = [...(Array.isArray(directory.boardMembers) ? directory.boardMembers : []), ...(Array.isArray(directory.members) ? directory.members : []), ...(Array.isArray(directory.employees) ? directory.employees : [])];
  const seen = new Set();
  return rows.filter(row => {
    const uid = String(row.uid || "").trim();
    if (!uid || seen.has(uid)) return false;
    seen.add(uid);
    return true;
  }).map(row => ({ ...row, uid: String(row.uid).trim(), name: String(row.name || row.email || row.uid), email: String(row.email || "").toLowerCase() }));
}
export async function listMeetingInviteeDirectory() {
  const store = readStore();
  const active = rows => clone(rows.filter(m => ["active", "activated"].includes(String(m.status || m.employmentStatus || m.registrationStatus || "").toLowerCase())));
  const boardMembers = active(store.members.filter(m => m.boardMember === true || String(m.role || "").toLowerCase() === "board member" || Boolean(m.boardPosition)));
  const members = active(store.members.filter(m => !(m.boardMember === true || String(m.role || "").toLowerCase() === "board member" || Boolean(m.boardPosition))));
  return { boardMembers, members, employees: active(store.employees || []) };
}
export async function callMeetingService(path, payload = {}) {
  const store = readStore();
  const meetingId = payload.meetingId || payload.data?.meetingId;
  if (path === "/api/meeting-register/create") {
    const id = await createRecord("meetings", payload.data || {});
    recordAction({ type: "meeting-register-create", meetingId: id });
    return { id, testOnly: true };
  }
  if (path === "/api/meeting-register/update") {
    store.meetings = store.meetings.map(m => m.id === meetingId ? { ...m, ...(payload.data || {}) } : m);
    writeStore(store); recordAction({ type: "meeting-update", meetingId, keys: Object.keys(payload.data || {}) });
    return { ok: true, testOnly: true };
  }
  if (path === "/api/meeting-outcomes/public") {
    return { resolutions: clone(store.resolutions || []), testOnly: true };
  }
  if (path === "/api/meeting-resolutions/create") {
    const data = payload.data || {};
    const row = { id: `TEST-resolution-${store.nextId++}`, ...clone(data), meetingId: data.meetingId || meetingId };
    store.resolutions.push(row);
    writeStore(store);
    recordAction({ type: "resolution-create", resolutionId: row.id, meetingId: row.meetingId });
    return { id: row.id, resolution: clone(row), testOnly: true };
  }
  if (path === "/api/meeting-resolutions/update") {
    const resolutionId = payload.resolutionId;
    store.resolutions = (store.resolutions || []).map(row => String(row.id) === String(resolutionId) ? { ...row, ...clone(payload.data || {}) } : row);
    writeStore(store);
    recordAction({ type: "resolution-update", resolutionId });
    return { ok: true, testOnly: true };
  }
  if (path === "/api/meeting-resolutions/delete") {
    store.resolutions = (store.resolutions || []).filter(row => String(row.id) !== String(payload.resolutionId));
    writeStore(store);
    recordAction({ type: "resolution-delete", resolutionId: payload.resolutionId });
    return { ok: true, testOnly: true };
  }
  if (path === "/api/meeting-room/event") {
    store.meetingRoomEvents.push({ id: `TEST-event-${store.nextId++}`, meetingId, ...(payload.event || {}) });
    writeStore(store); recordAction({ type: "meeting-event", meetingId }); return { ok: true };
  }
  if (path === "/api/meeting-voting/open") {
    const issue = {
      id: `TEST-vote-${store.nextId++}`, meetingId,
      resolutionId: payload.resolutionId || null,
      resolutionReference: payload.resolutionReference || null,
      votingReference: payload.votingReference, status: "Open"
    };
    store.votes.push(issue);
    if (payload.resolutionId) {
      store.resolutions = (store.resolutions || []).map(row => String(row.id) === String(payload.resolutionId)
        ? { ...row, status: "Voting Open", votingStatus: "Voting Open", votingResult: "Pending", votingIssueId: issue.id }
        : row);
    }
    writeStore(store);
    recordAction({ type: "vote-open", meetingId, issueId: issue.id, resolutionId: payload.resolutionId || null });
    return { issue, alreadyOpen: false, testOnly: true };
  }
  if (path === "/api/meeting-decisions/create") {
    const row = { id: `TEST-decision-${store.nextId++}`, ...(payload.data || {}), meetingId };
    store.decisions.push(row); writeStore(store); recordAction({ type: "decision-create", id: row.id }); return row;
  }
  if (path === "/api/meeting-actions/create") {
    const row = { id: `TEST-action-${store.nextId++}`, ...(payload.data || {}), meetingId };
    store.actions.push(row); writeStore(store); recordAction({ type: "action-create", id: row.id }); return row;
  }
  if (path === "/api/meeting-attendance/daily/dispatch") {
    recordAction({ type: "attendance-dispatch-stage", phase: payload.phase, stage: "TEST_ONLY_NO_EMAIL" });
    return { ok: true, status: "TEST_MOCKED" };
  }
  recordAction({ type: "meeting-service-mock", path });
  return { ok: true, id: `TEST-service-${store.nextId++}`, testOnly: true };
}
export async function assessMeetingQuorum({ meetingId } = {}) {
  const store = readStore();
  recordAction({ type: "quorum-assess", meetingId, quorumMet: true });
  const participants = store.participants.filter(p => p.meetingId === meetingId);
  const boardMembers = participants.filter(p => p.participantUid && /board member|board chairperson/i.test(String(p.participantRole || p.role || "")));
  return { assessment: {
    meetingId, boardMeeting: true, required: 1, present: 1, quorumMet: true, status: "MET",
    rule: "TEST fixture quorum: one authenticated Board Member",
    counts: { registered: participants.length, boardMembers: boardMembers.length || 1, signedAttendance: 0, invitationsDispatched: participants.length, activeAccessPasses: participants.length, queued: 0, admitted: 0, boardMembersPresent: 1 },
    rows: participants.map(p => ({ participantId: p.id, name: p.participantName, registrationCategory: p.participantUid ? "BOARD_MEMBER" : "EXTERNAL_INVITEE", attendanceStatus: "Present", signed: false, countsTowardQuorum: Boolean(p.participantUid) }))
  } };
}
export async function getDailyMeetingAttendance(meetingId, date) {
  const store = readStore();
  const participants = store.participants.filter(p => p.meetingId === meetingId);
  const daily = store.meetingDailyAttendance.filter(r => r.meetingId === meetingId && r.attendanceDate === date);
  const rows = participants.map(p => {
    const day = daily.find(r => r.participantId === p.id);
    return {
      participantId: p.id, participantUid: p.participantUid || null,
      name: p.participantName || p.name, email: p.participantEmail || p.email,
      role: p.participantRole || p.role,
      registrationCategory: p.participantUid ? "BOARD_MEMBER" : "EXTERNAL_INVITEE",
      dailyAttendanceStatus: day?.attendanceStatus || "N/A",
      attendanceStatus: day?.attendanceStatus || "N/A", signed: false
    };
  });
  return { meetingId, date, rows, dispatch: store.dailyAttendanceDispatches[`${meetingId}-${date}`] || null };
}
export async function markDailyMeetingAttendance({ meetingId, date, participantId, attendanceStatus }) {
  const store = readStore();
  const row = store.meetingDailyAttendance.find(r => r.meetingId === meetingId && r.participantId === participantId && r.attendanceDate === date);
  if (row) row.attendanceStatus = attendanceStatus;
  writeStore(store); recordAction({ type: "attendance-mark", participantId, attendanceStatus });
  return { ok: true, testOnly: true };
}
export async function markMeetingAttendance() { return { ok: true, testOnly: true }; }
export async function dispatchDailyAttendanceSigning({ meeting, date, records }) {
  const assignments = records.map((row, index) => ({
    signerId: `TEST-S${index + 1}`, participantId: row.participantId,
    participantUid: row.participantUid || null, participantEmail: String(row.email || "").toLowerCase(),
    participantName: row.name
  }));
  const store = readStore();
  const dispatch = { status: "TEST_MOCKED", envelopeId: "TEST-ENVELOPE-001", documentId: "TEST-DOCUMENT-001", gatewaySignerMap: assignments };
  store.dailyAttendanceDispatches[`${meeting.id}-${date}`] = dispatch;
  writeStore(store);
  recordAction({ type: "attendance-signing-mock", assignments, sameEmailCount: assignments.filter(a => a.participantEmail === "shared-guest@example.test").length, emailSent: false, stage: "TEST_ONLY_NO_EMAIL" });
  return { envelopeId: dispatch.envelopeId, documentId: dispatch.documentId, signerCount: assignments.length, status: "TEST_MOCKED" };
}
export async function resumeDailyAttendanceSigning(args) { return dispatchDailyAttendanceSigning({ ...args, records: args.records || [] }); }
export async function captureMeetingRecord({ meetingId, recordType, type, content, title }) {
  const store = readStore();
  const record = { id: `TEST-record-${store.nextId++}`, meetingId, recordType: recordType || type || "TEST_DRAFT", title, content, recordLabel: "TEST Meeting Minutes", capturedAt: "2026-11-20T09:00:00.000Z", integrityStatus: "TEST_FIXTURE", storageDestination: "TEST_LOCAL_FIXTURE", contentHash: "TEST-NOT-A-REAL-HASH", retainUntil: "2027-11-20", retentionYears: 1, legalHold: false };
  store.meetingRecords.push(record); writeStore(store); recordAction({ type: "minutes-capture", recordId: record.id });
  return record;
}
export async function updateMeetingRecordProtection() { return { ok: true, testOnly: true }; }
export async function disposeMeetingRecord() { return { ok: true, testOnly: true }; }
export async function listMeetingWorkingDocuments(meetingId) { return clone(readStore().meetingWorkingDocuments.filter(r => r.meetingId === meetingId)); }
export async function registerMeetingWorkingDocument({ meetingId, documentId }) { recordAction({ type: "working-document-register", meetingId, documentId }); return { ok: true, testOnly: true }; }
export async function submitMeetingDocumentReview() { return { ok: true, testOnly: true }; }
export async function translateMeetingPhrase({ content }) { return { translatedText: "TEST translation: " + content, testOnly: true }; }
export function withWorkflowLinks(value) { return value; }
export function readWorkflowContext() { return null; }
export function clearWorkflowContext() {}
export function navigateWorkflow(module, context = {}) {
  if (typeof window !== "undefined") window.__irpaNavigationCalls = [...(window.__irpaNavigationCalls || []), { module, context }];
}
export function collection(_db, collectionName) { return { kind: "collection", collectionName }; }
export function doc(_db, collectionName, id) { return { kind: "doc", collectionName, id }; }
export function query(collectionRef, ...filters) { return { kind: "query", collection: collectionRef, filters }; }
export function where(field, op, value) { return { field, op, value }; }
export function onSnapshot(ref, callback) {
  const store = readStore();
  if (ref?.kind === "doc" && ref.collectionName === "meetings") {
    const row = store.meetings.find(m => m.id === ref.id);
    callback({ id: ref.id, exists: () => Boolean(row), data: () => clone(row || {}) });
  } else if (ref?.kind === "query" && ref.collection?.collectionName === "participants") {
    const meetingId = ref.filters.find(f => f.field === "meetingId")?.value;
    const rows = store.participants.filter(p => p.meetingId === meetingId);
    callback({ docs: rows.map(row => ({ id: row.id, data: () => clone(row) })) });
  }
  return () => {};
}
export default function FixtureNoopComponent() { return React.createElement(React.Fragment, null); }

