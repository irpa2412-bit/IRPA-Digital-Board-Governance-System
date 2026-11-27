import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMeetingServicesRouter } from "../drive-gateway/src/meetingServices.mjs";
import {
  canAccessMeetingCategory,
  canRegisterMeeting,
  canEditMeeting,
  canVoteInMeeting,
  meetingCapabilities
} from "../src/firebase/meetingPolicy.js";

const governance = {
  id: "meeting-1",
  meetingCategory: "GOVERNANCE",
  meetingPolicyId: "GOVERNANCE",
  status: "Scheduled",
  initiatorUid: "secretary-1"
};

test("every active member and employee can view the sanitized Meeting Portal directory across categories", () => {
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "staff-1", active: true, activeEmployee: true, role: "Staff"
  }), true);
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "board-1", active: true, activeMember: true, isBoardMember: true, role: "Board Member"
  }), true);
  assert.equal(canAccessMeetingCategory({ ...governance, participantUids: ["staff-1"] }, {
    uid: "staff-1", active: true, activeEmployee: true, role: "Staff"
  }), true);
  assert.equal(canAccessMeetingCategory({ ...governance, participantUids: ["ordinary-member"] }, {
    uid: "ordinary-member", active: true, activeMember: true, role: "Member"
  }), true);
});

test("administrator-only accounts do not gain private meeting access", () => {
  assert.equal(canAccessMeetingCategory(governance, { uid: "admin-1", isAdmin: true }), false);
  assert.equal(canAccessMeetingCategory({ ...governance, participantUids: ["admin-member"] }, {
    uid: "admin-member", active: true, activeMember: true, isAdmin: true
  }), true);
});

test("inactive and external identities do not receive the general Meeting Portal directory", () => {
  const general = { meetingCategory: "GENERAL", meetingPolicyId: "GENERAL" };
  assert.equal(canAccessMeetingCategory(general, { uid: "member-1", active: true, activeMember: true }), true);
  assert.equal(canAccessMeetingCategory(general, { uid: "inactive-1", active: false, activeMember: false, activeEmployee: false }), false);
  assert.equal(canAccessMeetingCategory({ ...general, participantUids: ["member-1"] }, {
    uid: "member-1", active: true, activeMember: true
  }), true);
});

test("explicitly invited external participants can access only their listed meeting", () => {
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "external-expert", email: "external@example.test", active: false, role: "External Expert"
  }, { isInvited: true }), true);
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "other-external", email: "other@example.test", active: false
  }), false);
});

test("only an active member or employee may initiate a meeting", () => {
  assert.equal(canRegisterMeeting({ active: true, activeMember: true, role: "Departmental Director" }), true);
  assert.equal(canRegisterMeeting({ activeMember: true, role: "Ordinary Member" }), true);
  assert.equal(canRegisterMeeting({ active: true, activeEmployee: true, role: "Staff" }), true);
  assert.equal(canRegisterMeeting({ active: true, role: "Staff" }), false);
  assert.equal(canRegisterMeeting({ active: false, activeMember: true }), false);
  assert.equal(canRegisterMeeting({ isAdmin: true }), false);
});

test("only the active meeting organiser may edit before proceedings begin", () => {
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Registered", initiatorUid: "secretary-1" }, {
    uid: "secretary-1", active: true, activeMember: true, role: "Board Secretary"
  }), true);
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Registered", initiatorUid: "secretary-1", status: "In Progress" }, {
    uid: "secretary-1", active: true, activeMember: true, role: "Board Secretary"
  }), false);
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Registered" }, { isAdmin: true }), false);
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Draft" }, {
    uid: "another-user", active: true, activeEmployee: true
  }), false);
});

test("voting is restricted to active registered board members in governance meetings", () => {
  assert.equal(canVoteInMeeting(governance, {
    active: true, activeMember: true, isBoardMember: true, role: "Board Member"
  }), true);
  assert.equal(canVoteInMeeting(governance, {
    active: true, activeMember: true, role: "Staff"
  }), false);
  assert.equal(canVoteInMeeting({ meetingCategory: "STAFF", meetingPolicyId: "STAFF" }, {
    active: true, activeMember: true, isBoardMember: true, role: "Board Member"
  }), false);
});

test("category capabilities keep voting and resolutions disabled outside governance", () => {
  const staff = meetingCapabilities({ meetingCategory: "STAFF", meetingPolicyId: "STAFF" });
  assert.equal(staff.voting, false);
  assert.equal(staff.resolutions, false);
  assert.equal(staff.facilities.signature, false);
  const governanceCapabilities = meetingCapabilities(governance);
  assert.equal(governanceCapabilities.voting, true);
  assert.equal(governanceCapabilities.resolutions, true);
});

const meetingDataSource = readFileSync(new URL("../src/firebase/data.js", import.meta.url), "utf8");
const meetingGatewayApiSource = readFileSync(new URL("../src/firebase/meetingGatewayApi.js", import.meta.url), "utf8");
test("meeting register retrieval uses the authenticated Worker safe-directory endpoint", () => {
  const pageSource = readFileSync(new URL("../src/pages/Meetings.jsx", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../src/firebase/meetingGatewayApi.js", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../drive-gateway/src/meetingServices.mjs", import.meta.url), "utf8");
  assert.match(pageSource, /getAccessibleMeetingRecords,getMyMeetingSubscriptions/);
  assert.match(apiSource, /callMeetingService\("\/api\/meeting-register\/list"\)/);
  assert.match(workerSource, /if\(pathname==="\/api\/meeting-register\/list"\)/);
  assert.match(workerSource, /meetingPortalDirectoryEntry\(record,record\.id\)/);
  assert.match(workerSource, /activeInstitutionalRecord\(member\)\|\|activeInstitutionalRecord\(employee\)/);
});

test("active Meeting Portal attendance screens never call undeployed Firebase attendance callables",()=>{
 const room=readFileSync(new URL("../src/pages/MeetingRoom.jsx",import.meta.url),"utf8");
 const access=readFileSync(new URL("../src/meeting/MeetingAccessControl.jsx",import.meta.url),"utf8");
 const records=readFileSync(new URL("../src/firebase/meetingRecords.js",import.meta.url),"utf8");
 const signing=readFileSync(new URL("../src/firebase/meetingAttendanceSigning.js",import.meta.url),"utf8");
 const legacy=readFileSync(new URL("../src/components/MeetingAccessControl.jsx",import.meta.url),"utf8");
 assert.doesNotMatch(room,/httpsCallable|getFunctions|signMeetingAttendance/);
 assert.doesNotMatch(access,/httpsCallable|getFunctions|listMeetingEntryRequests|resolveMeetingEntryRequest/);
 assert.match(room,/\.\.\/meeting\/MeetingAccessControl/);
 assert.doesNotMatch(room,/\.\.\/components\/MeetingAccessControl/);
 for(const route of ["/api/meeting-attendance/mark","/api/meeting-attendance/register","/api/meeting-attendance/daily/register","/api/meeting-attendance/daily/mark","/api/meeting-attendance/daily/dispatch"])assert.ok(records.includes(route),route);
 assert.match(access,/\/api\/meeting-entry-requests\/list/);
 assert.match(access,/\/api\/meeting-entry-requests\/resolve/);
 assert.match(signing,/callMeetingService/);
 assert.match(legacy,/listMeetingEntryRequests/);
 assert.match(legacy,/resolveMeetingEntryRequest/);
});


const meetingCentreSource = readFileSync(new URL("../src/pages/Meetings.jsx", import.meta.url), "utf8");
test("Meeting Centre exposes initiation to every active member and employee", () => {
  assert.ok(meetingCentreSource.includes("const canRegisterMeeting = identity => canRegisterMeetingByRole(identity);"));
  assert.ok(meetingCentreSource.includes("payload.organizerUid=actor.uid"));
  assert.ok(meetingCentreSource.includes("payload.participantUids=[...new Set([actor.uid"));
});

const meetingGatewayContext = {
  authenticateFirebaseRequest: async () => ({ user_id: "test-user", email: "test@example.test" }),
  getFirebaseProjectId: () => "test-project",
  getFirestoreAdminAccessToken: async () => "test-token",
  json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }),
  corsHeaders: () => ({ "content-type": "application/json" })
};
const postMeetingGateway = (router, path, body = {}) => router(new Request("https://worker.test" + path, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
}), { FIREBASE_PROJECT_ID: "test-project" }, path);

async function requestMeetingDirectory({ uid, email, identityCollection, status }) {
  const originalFetch = globalThis.fetch;
  let listRead = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const match = url.pathname.match(/\\/documents\\/(members|employees)\\/([^/]+)$/);
    if (match) {
      const [, collection, recordUid] = match;
      if (collection !== identityCollection || recordUid !== uid) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({
        name: url.pathname,
        fields: { uid: { stringValue: uid }, email: { stringValue: email }, status: { stringValue: status } }
      }), { status: 200 });
    }
    if (url.pathname.endsWith("/documents:runQuery")) {
      listRead = true;
      return new Response(JSON.stringify([{
        document: {
          name: "projects/test-project/databases/(default)/documents/meetings/private-meeting",
          fields: {
            title: { stringValue: "Board meeting" },
            meetingCategory: { stringValue: "GOVERNANCE" },
            meetingType: { stringValue: "Board Meeting" },
            meetingReference: { stringValue: "IRPA-MTG-2026-001" },
            date: { stringValue: "2026-11-27" },
            status: { stringValue: "Scheduled" },
            initiatorUid: { stringValue: "another-user" },
            agenda: { stringValue: "Private agenda" },
            minutes: { stringValue: "Private minutes" },
            platformPasscode: { stringValue: "secret-passcode" }
          }
        }
      }]), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  try {
    const context = {
      ...meetingGatewayContext,
      authenticateFirebaseRequest: async () => ({ user_id: uid, email })
    };
    const response = await postMeetingGateway(createMeetingServicesRouter(context), "/api/meeting-register/list");
    return { response, body: await response.json(), listRead };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("active members can retrieve the Meeting Portal directory without receiving private meeting content", async () => {
  const result = await requestMeetingDirectory({
    uid: "directory-member", email: "member@example.test",
    identityCollection: "members", status: "Active"
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.meetings.length, 1);
  assert.equal(result.body.meetings[0].title, "Board meeting");
  for (const field of ["agenda", "minutes", "platformPasscode", "participantUids"]) {
    assert.equal(field in result.body.meetings[0], false, field);
  }
  assert.equal(result.listRead, true);
});

test("active employees can retrieve the Meeting Portal directory", async () => {
  const result = await requestMeetingDirectory({
    uid: "directory-employee", email: "employee@example.test",
    identityCollection: "employees", status: "Active"
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.meetings.length, 1);
});

test("inactive members and employees are denied the Meeting Portal directory", async () => {
  const result = await requestMeetingDirectory({
    uid: "inactive-directory-user", email: "inactive@example.test",
    identityCollection: "members", status: "Suspended"
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(result.listRead, false);
});


async function createMeetingAsInstitutionalIdentity({ uid, email, member = null, employee = null, otherMembers = {}, otherEmployees = {}, category = "GENERAL", meetingData = {} }) {
  const originalFetch = globalThis.fetch;
  let meetingWrites = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const documentPath = url.pathname.split("/documents/")[1] || "";
    if (init.method === "POST") {
      if (documentPath === "meetings") meetingWrites += 1;
      return new Response(JSON.stringify({ name: url.pathname + "/test-record", fields: {} }), { status: 200 });
    }
    const [collection, id] = documentPath.split("/");
    const record = collection === "members" ? (id === uid ? member : otherMembers[id]) : collection === "employees" ? (id === uid ? employee : otherEmployees[id]) : null;
    if (!record) return new Response("{}", { status: 404 });
    const fields = Object.fromEntries(Object.entries(record).map(([key, value]) => [key, { stringValue: String(value) }]));
    return new Response(JSON.stringify({ name: url.pathname, fields }), { status: 200 });
  };
  try {
    const context = {
      ...meetingGatewayContext,
      authenticateFirebaseRequest: async () => ({ user_id: uid, email })
    };
    const router = createMeetingServicesRouter(context);
    const response = await postMeetingGateway(router, "/api/meeting-register/create", {
      data: {
        title: "Member-initiated meeting",
        meetingCategory: category,
        meetingPolicyId: category,
        meetingType: category === "GOVERNANCE" ? "Board Meeting" : "General Meeting",
        ...meetingData,
        initiatorUid: uid,
        initiatorEmail: email,
        date: "2026-11-24"
      }
    });
    return { response, body: await response.json(), meetingWrites };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("meeting directory projection exposes metadata only and excludes private proceedings and credentials", async () => {
  const { meetingPortalDirectoryEntry } = await import("../drive-gateway/src/meetingServices.mjs");
  const entry = meetingPortalDirectoryEntry({
    title: "Quarterly meeting", meetingCategory: "GOVERNANCE", meetingType: "Board Meeting",
    meetingReference: "IRPA-MTG-2026-001", date: "2026-11-27", startTime: "10:00",
    status: "Scheduled", initiatorUid: "member-1", agenda: "Confidential agenda",
    minutes: "Private minutes", transcript: "Private transcript",
    platformPasscode: "secret", participantUids: ["member-1","member-2"]
  }, "meeting-1");
  assert.deepEqual(Object.keys(entry).sort(), [
    "createdAt","date","endTime","id","initiatorUid","meetingCategory","meetingIdentity",
    "meetingPolicyId","meetingReference","meetingType","registerStatus","startTime","status",
    "title","updatedAt"
  ].sort());
  assert.equal(entry.title, "Quarterly meeting");
  assert.equal("agenda" in entry, false);
  assert.equal("minutes" in entry, false);
  assert.equal("transcript" in entry, false);
  assert.equal("platformPasscode" in entry, false);
  assert.equal("participantUids" in entry, false);
});

test("meeting directory projection exposes metadata only and excludes private proceedings and credentials", async () => {
  const { meetingPortalDirectoryEntry } = await import("../drive-gateway/src/meetingServices.mjs");
  const entry = meetingPortalDirectoryEntry({
    title: "Quarterly meeting", meetingCategory: "GOVERNANCE", meetingType: "Board Meeting",
    meetingReference: "IRPA-MTG-2026-001", date: "2026-11-27", startTime: "10:00",
    status: "Scheduled", initiatorUid: "member-1", agenda: "Confidential agenda",
    minutes: "Private minutes", transcript: "Private transcript",
    platformPasscode: "secret", participantUids: ["member-1","member-2"]
  }, "meeting-1");
  assert.equal(entry.title, "Quarterly meeting");
  for (const field of ["agenda","minutes","transcript","platformPasscode","participantUids","participantEmails","venue"]) {
    assert.equal(field in entry, false, field);
  }
});

test("combined Worker and Firestore rules preserve universal non-ongoing access and live participant restrictions", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../drive-gateway/src/meetingServices.mjs", import.meta.url), "utf8");
  assert.ok(rules.includes("function meetingUser(){return activeMember()||activeEmployee();}"));
  assert.ok(rules.includes('function meetingReadAllowed(data){return meetingParticipant(data)||(meetingUser()&&data.get("status","")!="In Progress"&&data.get("proceedingsStatus","")!="In Progress");}'));
  assert.ok(rules.includes("match /meetings/{id}{allow read:if meetingReadAllowed(resource.data);"));
  assert.ok(worker.includes("meetingContextAccessAllowed"));
  assert.ok(worker.includes("if(!c.participant)throw Object.assign(new Error(\"Live meeting admission is restricted to invited participants and leaders appointed to this specific meeting.\"),{status:403});"));
});

test("uninvited active IRPA identities can read non-ongoing meetings but cannot enter ongoing proceedings", async () => {
  const { meetingContextAccessAllowed } = await import("../drive-gateway/src/meetingServices.mjs");
  assert.equal(meetingContextAccessAllowed({ status: "Scheduled" }, true, false), true);
  assert.equal(meetingContextAccessAllowed({ status: "Completed" }, true, false), true);
  assert.equal(meetingContextAccessAllowed({ proceedingsStatus: "In Progress" }, true, false), false);
  assert.equal(meetingContextAccessAllowed({ status: "In Progress" }, true, false), false);
  assert.equal(meetingContextAccessAllowed({ status: "In Progress" }, true, true), true);
  assert.equal(meetingContextAccessAllowed({ status: "Scheduled" }, false, false), false);
  assert.equal(meetingContextAccessAllowed({ status: "In Progress" }, false, true), true);
});

test("active staff can initiate a Governance-level meeting through the authenticated Worker", async () => {
  const result = await createMeetingAsInstitutionalIdentity({
    uid: "staff-initiator", email: "staff@example.test",
    employee: { uid: "staff-initiator", email: "staff@example.test", status: "Active", role: "Staff" },
    category: "GOVERNANCE"
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.meetingWrites, 1);
});

test("active members can initiate meetings without a management title", async () => {
  const result = await createMeetingAsInstitutionalIdentity({
    uid: "member-initiator", email: "member@example.test",
    member: { uid: "member-initiator", email: "member@example.test", status: "Active", role: "Member" },
    category: "ADMINISTRATIVE"
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.meetingWrites, 1);
});

test("inactive institutional identities cannot initiate meetings through the Worker", async () => {
  const result = await createMeetingAsInstitutionalIdentity({
    uid: "inactive-user", email: "inactive@example.test",
    employee: { uid: "inactive-user", email: "inactive@example.test", status: "Suspended", role: "Staff" },
    category: "GENERAL"
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(result.meetingWrites, 0);
});


test("meeting registration keeps all three permanent appointments optional", async () => {
  const result = await createMeetingAsInstitutionalIdentity({
    uid: "member-no-leaders", email: "member@example.test",
    member: { uid: "member-no-leaders", email: "member@example.test", status: "Active", role: "Member" },
    category: "STAFF"
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.meetingWrites, 1);
});

test("repeated appointee identities are accepted for all three meeting positions", async () => {
  const uid = "same-person";
  const result = await createMeetingAsInstitutionalIdentity({
    uid, email: "same@example.test",
    member: { uid, email: "same@example.test", status: "Active", role: "Member" },
    category: "STAFF",
    meetingData: {
      meetingChairpersonUid: uid,
      meetingSecretaryUid: uid,
      meetingAdministratorUid: uid
    }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.meetingWrites, 1);
});

test("a declared leadership-election workflow requires all three temporary Transition Committee appointments", async () => {
  const uid = "transition-member";
  const base = {
    uid, email: "transition@example.test",
    member: { uid, email: "transition@example.test", status: "Active", role: "Member" },
    category: "STAFF"
  };
  const complete = await createMeetingAsInstitutionalIdentity({
    ...base,
    meetingData: {
      leadershipElectionRequired: true,
      transitionChairpersonUid: uid,
      transitionSecretaryUid: uid,
      transitionAdministratorUid: uid
    }
  });
  assert.equal(complete.response.status, 200);
  const incomplete = await createMeetingAsInstitutionalIdentity({
    ...base,
    meetingData: {
      leadershipElectionRequired: true,
      transitionChairpersonUid: uid,
      transitionSecretaryUid: uid
    }
  });
  assert.equal(incomplete.response.status, 409);
  assert.equal(incomplete.meetingWrites, 0);
});

test("inactive identities cannot be appointed to a meeting position", async () => {
  const inactiveUid = "inactive-appointee";
  const result = await createMeetingAsInstitutionalIdentity({
    uid: "active-registrar", email: "registrar@example.test",
    member: { uid: "active-registrar", email: "registrar@example.test", status: "Active", role: "Member" },
    otherMembers: {
      [inactiveUid]: { uid: inactiveUid, email: "inactive@example.test", status: "Suspended", role: "Member" }
    },
    category: "STAFF",
    meetingData: { meetingChairpersonUid: inactiveUid }
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.meetingWrites, 0);
});

test("staff and general meetings enable ballots only during an active leadership election", () => {
  const meeting = {
    meetingCategory: "STAFF",
    meetingPolicyId: "STAFF",
    leadershipElectionRequired: true,
    transitionCommitteeActive: true,
    status: "Scheduled"
  };
  const capabilities = meetingCapabilities(meeting);
  assert.equal(capabilities.leadershipElection, true);
  assert.equal(capabilities.voting, true);
  assert.equal(capabilities.resolutions, false);
  assert.equal(canVoteInMeeting(meeting, {
    active: true, activeEmployee: true, isMeetingParticipant: true
  }), true);
  assert.equal(canVoteInMeeting(meeting, {
    active: true, activeEmployee: true, isMeetingParticipant: false
  }), false);
  assert.equal(meetingCapabilities({ ...meeting, transitionCommitteeActive: false }).voting, false);
});

test("meeting governance source enforces the proceedings gate and immediate transition mandate expiry", () => {
  const source = readFileSync(new URL("../drive-gateway/src/meetingServices.mjs", import.meta.url), "utf8");
  assert.match(source, /Formal proceedings cannot begin until the meeting-specific Chairperson, Secretary and Meeting Administrator have all been declared/);
  assert.match(source, /leadershipIssues\.some\(issue=>lower\(issue\.status\)!=="closed"\)/);
  assert.match(source, /MEETING_TRANSITION_COMMITTEE_MANDATE_ENDED/);
  assert.match(source, /transitionCommitteeMandateEndedAtProceedings=true/);
  assert.match(source, /Only the Chairperson appointed to this meeting may open formal proceedings/);
});

test("Meeting Worker allows universal portal initiation while retaining participant-only private meeting context", () => {
  assert.match(meetingServicesGovernanceSource, /const isAdminIdentity=claims\.admin===true/);
  assert.match(meetingServicesGovernanceSource, /if\(isAdminIdentity&&!activeIdentity\)/);
  assert.doesNotMatch(meetingServicesGovernanceSource, /subscription\|\|participantRecord/);
  assert.match(meetingServicesGovernanceSource, /participantUids,meeting\.attendeeUids,meeting\.memberUids,meeting\.invitedUids/);
  assert.match(meetingServicesGovernanceSource, /if\(!explicitParticipant\)/);
  assert.match(meetingServicesGovernanceSource, /canRead:true/);
  assert.match(meetingServicesGovernanceSource, /isAdmin:false/);
  assert.doesNotMatch(meetingServicesGovernanceSource, /canRead:canManage\|\|participant\|\|isAdmin/);
  assert.match(meetingServicesGovernanceSource, /if\(!\(active\(member\)\|\|active\(employee\)\)\)return fail/);
});

test("Meeting Worker exposes public outcomes separately and never publishes raw ballots from room activity", () => {
  assert.match(meetingServicesGovernanceSource, /\/api\/meeting-outcomes\/public/);
  assert.match(meetingServicesGovernanceSource, /meetingPublicOutcomes/);
  assert.match(meetingServicesGovernanceSource, /summarizeMeetingVotes/);
  const activity = meetingServicesGovernanceSource.match(/if\(pathname==="\/api\/meeting-room\/activity"\)\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.ok(activity.includes("meetingRoomEvents"));
  assert.ok(!activity.includes('"votes"'));
  assert.ok(!activity.includes("visibleVotes"));
});

test("Meeting Worker allows participants to retrieve archived private records without modifying archive state", () => {
  assert.match(meetingServicesGovernanceSource, /isRetrievableMeetingRecordStatus\\(r\.status\\)/);
  assert.match(meetingServicesGovernanceSource, /isRetrievableMeetingRecordStatus\\(record\.status\\)/);
  assert.match(meetingServicesGovernanceSource, /return \["active","archived"\]\.includes\(lower\(status\)\)/);
});


const meetingServicesGovernanceSource = readFileSync(new URL("../drive-gateway/src/meetingServices.mjs", import.meta.url), "utf8");
const meetingRoomGovernanceSource = readFileSync(new URL("../src/pages/MeetingRoom.jsx", import.meta.url), "utf8");
const votingPageGovernanceSource = readFileSync(new URL("../src/pages/Voting.jsx", import.meta.url), "utf8");
test("Transition Committee powers are limited to leadership election, invitations and appointment handover", () => {
  assert.match(meetingServicesGovernanceSource, /function meetingSecretariatAuthority\(meeting,uid\)\{return !transitionCommitteeActive\(meeting\)/);
  assert.match(meetingServicesGovernanceSource, /function meetingTransitionElectionAuthority\(meeting,uid\)/);
  for (const route of ["/api/meeting-actions/create", "/api/meeting-decisions/create"]) {
    const start = meetingServicesGovernanceSource.indexOf(`if(pathname==="${route}")`);
    assert.notEqual(start, -1, `expected ${route}`);
    const end = meetingServicesGovernanceSource.indexOf("\n}", start);
    const body = meetingServicesGovernanceSource.slice(start, end < 0 ? start + 2500 : end);
    assert.match(body, /const controller=!transitionCommitteeActive\(c\.meeting\)/);
  }
  assert.match(meetingRoomGovernanceSource, /controller=Boolean\(!transitionActive&&\(canChair\|\|canSecretary\)\),electionController=Boolean\(transitionActive&&\(canTransitionChair\|\|canTransitionSecretary\)\),canControlVoting=controller\|\|electionController/);
  assert.match(meetingRoomGovernanceSource, /async function openVote\(\)\{if\(!canControlVoting\)return deny\(\)/);
  assert.match(meetingRoomGovernanceSource, /MeetingAccessControl meeting=\{selected\} controller=\{Boolean\(activeAdministrator\)\} admissionController=\{Boolean\(activeAdministrator\)\}/);
  assert.match(meetingRoomGovernanceSource, /MeetingWorkingDocuments meeting=\{selected\} controller=\{controller\}/);
});


const legacyLiveMeetingSource = readFileSync(new URL("../functions/liveMeeting.js", import.meta.url), "utf8");
test("legacy LiveKit callable cannot bypass meeting-specific admission or Meeting Administrator moderation", () => {
  assert.match(legacyLiveMeetingSource, /function moderatorForMeeting\(meeting = \{\}, uid\)/);
  assert.match(legacyLiveMeetingSource, /meeting\.transitionAdministratorUid : meeting\.meetingAdministratorUid/);
  assert.doesNotMatch(legacyLiveMeetingSource, /meeting\.chairpersonUid && text\(meeting\.chairpersonUid\) === uid/);
  assert.doesNotMatch(legacyLiveMeetingSource, /meeting\.secretaryUid && text\(meeting\.secretaryUid\) === uid/);
  assert.match(legacyLiveMeetingSource, /const moderator = moderatorForMeeting\(meeting, uid\)/);
  assert.doesNotMatch(legacyLiveMeetingSource, /const moderator = isAdmin \|\|/);
  assert.match(legacyLiveMeetingSource, /if \(!listed\)/);
  assert.match(legacyLiveMeetingSource, /const controller = moderatorForMeeting\(meeting, uid\)/);
});

test("Meeting Administrator alone controls admission, attendance and technical media operations", () => {
  assert.match(meetingRoomGovernanceSource, /MeetingAccessControl meeting=\{selected\} controller=\{Boolean\(activeAdministrator\)\} admissionController=\{Boolean\(activeAdministrator\)\}/);
  assert.match(meetingRoomGovernanceSource, /isMeetingHost&&p\.participantId&&!\["PREPARING","DISPATCHED"\]\.includes\(dailyAttendanceDispatch\?\.status\)/);
  assert.match(meetingRoomGovernanceSource, /Only the Meeting Administrator appointed to this meeting may update the attendance sheet/);
  assert.match(meetingServicesGovernanceSource, /Only the Meeting Administrator appointed to this meeting may update the daily attendance sheet/);
});


test("leadership election ballots are operable by the Transition Committee through meeting-scoped controls", () => {
  assert.match(meetingRoomGovernanceSource, /Leadership Election Ballot/);
  assert.match(meetingRoomGovernanceSource, /if\(!currentItem&&!electionMode\)/);
  assert.match(meetingRoomGovernanceSource, /electionController\|\|busy/);
  assert.match(votingPageGovernanceSource, /function meetingVotingController\(meeting,uid,issue=null\)/);
  assert.match(votingPageGovernanceSource, /callMeetingService\("\/api\/meeting-voting\/open"/);
  assert.match(votingPageGovernanceSource, /callMeetingService\("\/api\/meeting-voting\/close"/);
  assert.match(votingPageGovernanceSource, /canManageIssue\(issue\)/);
  assert.doesNotMatch(votingPageGovernanceSource, /admin&&/);
  const closeStart = meetingServicesGovernanceSource.indexOf('if(pathname==="/api/meeting-voting/close")');
  assert.notEqual(closeStart, -1);
  const closeBody = meetingServicesGovernanceSource.slice(closeStart, closeStart + 1800);
  assert.match(closeBody, /issue\.leadershipElection===true&&c\.meeting\.leadershipElectionRequired===true&&meetingTransitionElectionAuthority/);
});

test("leadership-election invitation management cannot be bypassed by the initiator or global administrator", () => {
  assert.match(meetingServicesGovernanceSource, /const canManageParticipants=meeting\.leadershipElectionRequired===true\?\(chair\|\|secretary\|\|meetingAdministrator\)/);
  assert.match(meetingServicesGovernanceSource, /if\(!c\.canManageParticipants\)return fail/);
  assert.match(meetingServicesGovernanceSource, /function meetingTransitionElectionAuthority\(meeting,uid\)/);
});


test("legacy invitee directory export delegates to the authenticated Cloudflare Worker",()=>{
  const start=meetingDataSource.indexOf("export async function listMeetingInviteeDirectory()");
  const end=meetingDataSource.indexOf("\n}",start);
  assert.ok(start>=0&&end>start,"legacy compatibility export remains available");
  const source=meetingDataSource.slice(start,end);
  assert.match(source,/listMeetingInviteeDirectoryViaGateway\(\)/);
  assert.doesNotMatch(source,/httpsCallable|getFunctions/);
  assert.match(source,/boardMembers:Array\.isArray\(directory\?\.boardMembers\)/);
  assert.match(source,/members:Array\.isArray\(directory\?\.members\)/);
  assert.match(source,/employees:Array\.isArray\(directory\?\.employees\)/);
  assert.match(meetingGatewayApiSource,/\/api\/meeting-invitee-directory\/list/);
});



