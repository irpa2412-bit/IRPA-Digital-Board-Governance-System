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

test("governance category denies an unrelated active staff identity", () => {
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "staff-1", active: true, activeEmployee: true, role: "Staff"
  }), false);
});

test("governance category allows authorised board roles and administrators", () => {
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "board-1", active: true, activeMember: true, isBoardMember: true, role: "Board Member"
  }), true);
  assert.equal(canAccessMeetingCategory(governance, { uid: "admin-1", isAdmin: true }), true);
});

test("general meetings allow active institutional members and employees", () => {
  const general = { meetingCategory: "GENERAL", meetingPolicyId: "GENERAL" };
  assert.equal(canAccessMeetingCategory(general, { active: true, activeMember: true }), true);
  assert.equal(canAccessMeetingCategory(general, { active: true, activeEmployee: true }), true);
});

test("explicitly invited participants can access their meeting regardless of institutional role", () => {
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "external-expert", active: true, role: "External Expert"
  }, { isInvited: true }), true);
});

test("any active registered member or employee may initiate a meeting", () => {
  assert.equal(canRegisterMeeting({ active: true, role: "Departmental Director" }), true);
  assert.equal(canRegisterMeeting({ active: false, role: "Departmental Director" }), false);
  assert.equal(canRegisterMeeting({ active: true, role: "Staff" }), true);
  assert.equal(canRegisterMeeting({ active: true, role: "Member" }), true);
  assert.equal(canRegisterMeeting({ isAdmin: true }), true);
});

test("released meeting general details remain protected while the initiator may manage appointments before proceedings", () => {
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Registered", initiatorUid: "secretary-1" }, {
    uid: "secretary-1", active: true, role: "Board Secretary"
  }), true);
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Registered", initiatorUid: "secretary-1", status: "In Progress" }, {
    uid: "secretary-1", active: true, role: "Board Secretary"
  }), false);
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Registered" }, { isAdmin: true }), true);
});

test("a designated initiator may edit only an unreleased meeting they initiated", () => {
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Draft" }, {
    uid: "secretary-1", active: true, role: "Board Secretary"
  }), true);
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Draft" }, {
    uid: "another-user", active: true, role: "Board Secretary"
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
test("meeting register retrieval avoids an unscoped collection read", () => {
  const start = meetingDataSource.indexOf("export async function getAccessibleMeetingRecords");
  const end = meetingDataSource.indexOf("function meetingCreatedAt", start);
  assert.ok(start >= 0 && end > start, "meeting retrieval function must be present");
  const source = meetingDataSource.slice(start, end);
  assert.doesNotMatch(source, /if\s*\(user\.uid\)\s*\{\s*const all\s*=\s*await getDocs\(ref\)/);
  assert.match(source, /for\(const policy of Object\.values\(MEETING_CATEGORIES\)\)/);
  assert.match(source, /query\(ref,where\("initiatorUid","==",uid\)\)/);
  assert.match(source, /for\(const field of \["participantUids"/);
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
  assert.ok(meetingCentreSource.includes("const canRegisterMeeting = identity => canRegisterMeetingByRole(identity) || identity.activeMember===true || identity.activeEmployee===true"));
  assert.equal(meetingCentreSource.split("canRegisterMeeting({...actorIdentity,isAdmin:admin})").length - 1, 4);
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

test("meeting governance Firestore rules restrict live voting control to the active meeting mandate", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /function meetingVotingController\(meetingId,leadershipElection\).*transitionCommitteeActive.*leadershipElectionRequired.*leadershipElection==true/);
  assert.match(rules, /meetingLeadershipElectionVoter/);
  assert.match(rules, /meetingAllowsVoting/);
  assert.match(rules, /match \/meetings\/\{id\}\{allow read:if meetingReadAllowed\(resource\.data\)/);
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




import "./meeting-portal-worker-policy.test.mjs";
