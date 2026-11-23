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

test("meeting registration requires an active designated institutional role", () => {
  assert.equal(canRegisterMeeting({ active: true, role: "Departmental Director" }), true);
  assert.equal(canRegisterMeeting({ active: false, role: "Departmental Director" }), false);
  assert.equal(canRegisterMeeting({ active: true, role: "Staff" }), false);
  assert.equal(canRegisterMeeting({ isAdmin: true }), true);
});

test("released meeting edits are administrator-only", () => {
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Registered" }, {
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
  assert.match(meetingCentreSource, /const canRegisterMeeting = identity => canRegisterMeetingByRole\\(identity\\) \\|\\| identity\\.activeMember===true \\|\\| identity\\.activeEmployee===true/);
  assert.equal((meetingCentreSource.match(/canRegisterMeeting\\(\\{\\.\\.\\.actorIdentity,isAdmin:admin\\}\\)/g) || []).length, 4);
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

async function createMeetingAsInstitutionalIdentity({ uid, email, member = null, employee = null, category = "GENERAL" }) {
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
    const record = collection === "members" ? member : collection === "employees" ? employee : null;
    if (id !== uid || !record) return new Response("{}", { status: 404 });
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
