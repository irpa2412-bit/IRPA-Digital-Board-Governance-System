const STORE_KEY = "irpa-meeting-fixture-v1";
const clone = value => JSON.parse(JSON.stringify(value));
function initialStore() {
  return {
    nextId: 1,
    meetings: [{
      id: "fixture-meeting-001",
      title: "Previously Scheduled Board Meeting",
      meetingType: "Board Meeting",
      meetingCategory: "GOVERNANCE",
      meetingPolicyId: "GOVERNANCE",
      meetingPlatform: "IRPA-DBGS Meeting Room",
      date: "2027-01-15",
      startTime: "10:00",
      endTime: "11:00",
      chairperson: "Fixture Chairperson",
      agenda: "Verify retrieval of an already scheduled meeting.",
      status: "Scheduled",
      registerStatus: "Registered",
      registeredAt: "2026-10-01T09:00:00.000Z",
      initiatorUid: "fixture-board-secretary-uid",
      initiatorEmail: "board-secretary@example.test",
      initiatorName: "Isolated Board Secretary Fixture",
      memberUids: [], participantUids: [], participants: [], attendees: []
    }],
    members: [
      { id: "fixture-board-member-active", name: "Active Board Member Fixture", role: "Board Member", boardMember: true, status: "Active", email: "active-board-member@example.test", memberNumber: "FIX-BM-001", uid: "fixture-board-member-auth-uid" },
      { id: "fixture-board-member-inactive", name: "Inactive Board Member Fixture", role: "Board Member", boardMember: true, status: "Inactive", email: "inactive-board-member@example.test", memberNumber: "FIX-BM-002", uid: "fixture-board-member-inactive-uid" },
      { id: "fixture-ordinary-member", name: "Ordinary Member Fixture", role: "Member", boardMember: false, status: "Active", email: "ordinary-member@example.test", memberNumber: "FIX-M-001", uid: "fixture-ordinary-member-uid" }
    ],
    resolutions: [], decisions: [], meetingSubscriptions: [], votes: []
  };
}
function readStore() {
  if (typeof window === "undefined") return initialStore();
  const stored = window.localStorage.getItem(STORE_KEY);
  if (!stored) {
    const seeded = initialStore();
    window.localStorage.setItem(STORE_KEY, JSON.stringify(seeded));
    return seeded;
  }
  try { return JSON.parse(stored); }
  catch {
    const seeded = initialStore();
    window.localStorage.setItem(STORE_KEY, JSON.stringify(seeded));
    return seeded;
  }
}
function writeStore(value) { window.localStorage.setItem(STORE_KEY, JSON.stringify(value)); }
export const COLLECTIONS = {
  meetings: "meetings", members: "members", resolutions: "resolutions",
  decisions: "decisions", meetingSubscriptions: "meetingSubscriptions", votes: "votes"
};
export const auth = {
  currentUser: {
    uid: "fixture-board-secretary-uid",
    email: "board-secretary@example.test",
    displayName: "Isolated Board Secretary Fixture",
    getIdTokenResult: async () => ({ claims: { irpaRoles: ["Board Secretary"] } })
  }
};
export async function getCurrentMemberProfile() {
  return { uid: auth.currentUser.uid, email: auth.currentUser.email, role: "Board Secretary", status: "Active", registrationStatus: "Activated" };
}
export async function getCurrentEmployeeProfile() { return null; }
export async function getRecords(collection) { return clone(readStore()[collection] || []); }
export async function getAccessibleMeetingRecords() { return clone(readStore().meetings || []); }
export async function createRecord(collection, payload) {
  const store = readStore();
  const id = `fixture-created-meeting-${store.nextId++}`;
  store[collection] = [...(store[collection] || []), { ...clone(payload), id }];
  writeStore(store);
  return id;
}
export async function updateRecord(collection, id, patch) {
  const store = readStore();
  store[collection] = (store[collection] || []).map(record =>
    String(record.id) === String(id) ? { ...record, ...clone(patch) } : record
  );
  writeStore(store);
  return { id };
}
export async function deleteRecord(collection, id) {
  const store = readStore();
  store[collection] = (store[collection] || []).filter(record => String(record.id) !== String(id));
  writeStore(store);
  return { id };
}
export async function openVotingIssue() { return { id: "fixture-vote-001" }; }
export async function listMeetingRecords() { return []; }
export async function retrieveMeetingRecord() { return null; }
export async function saveMeetingAssistantDraft() { return { id: "fixture-draft-001" }; }
export async function compileAndEmailMeetingReport() { return { ok: true }; }
export async function saveLiveMeetingProceedings() { return { version: 1 }; }
export async function uploadMeetingProductToDrive() { throw new Error("External storage is disabled in this isolated fixture."); }
export async function provisionAllMeetingCategoryArchives() { throw new Error("External storage is disabled in this isolated fixture."); }

export async function listMeetingInviteeDirectory() {
  const store = readStore();
  const active = rows => clone(rows.filter(m => ["active", "activated"].includes(String(m.status || m.employmentStatus || m.registrationStatus || "").toLowerCase())));
  const boardMembers = active(store.members.filter(m => m.boardMember === true || String(m.role || "").toLowerCase() === "board member" || Boolean(m.boardPosition)));
  const members = active(store.members.filter(m => !(m.boardMember === true || String(m.role || "").toLowerCase() === "board member" || Boolean(m.boardPosition))));
  return { boardMembers, members, employees: active(store.employees || []) };
}
