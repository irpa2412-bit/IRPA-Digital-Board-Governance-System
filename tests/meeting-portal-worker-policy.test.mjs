import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMeetingServicesRouter, meetingContextAccessAllowed } from "../drive-gateway/src/meetingServices.mjs";
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

test("every IRPA member and employee identity can view the sanitized Meeting Portal directory across categories regardless of status", () => {
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

test("external identities without an IRPA member or employee record do not receive the general Meeting Portal directory", () => {
  const general = { meetingCategory: "GENERAL", meetingPolicyId: "GENERAL" };
  assert.equal(canAccessMeetingCategory(general, { uid: "member-1", active: true, activeMember: true }), true);
  assert.equal(canAccessMeetingCategory(general, { uid: "inactive-member", memberIdentity: true, activeMember: false }), true);
  assert.equal(canAccessMeetingCategory(general, { uid: "former-employee", employeeIdentity: true, activeEmployee: false }), true);
  assert.equal(canAccessMeetingCategory(general, { uid: "external-1", active: false, activeMember: false, activeEmployee: false }), false);
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

test("any registered IRPA member or employee may initiate a meeting regardless of status", () => {
  assert.equal(canRegisterMeeting({ active: true, activeMember: true, role: "Departmental Director" }), true);
  assert.equal(canRegisterMeeting({ activeMember: true, role: "Ordinary Member" }), true);
  assert.equal(canRegisterMeeting({ active: true, activeEmployee: true, role: "Staff" }), true);
  assert.equal(canRegisterMeeting({ active: true, role: "Staff" }), false);
  assert.equal(canRegisterMeeting({ active: false, activeMember: false, memberIdentity: true }), true);
  assert.equal(canRegisterMeeting({ active: false, activeEmployee: false, employeeIdentity: true }), true);
  assert.equal(canRegisterMeeting({ active: false }), false);
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
  assert.match(workerSource, /if\(!member&&!employee\)return fail/);
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
test("Meeting Centre exposes initiation to every registered member and employee identity", () => {
  assert.ok(meetingCentreSource.includes("identity.memberIdentity===true||identity.employeeIdentity===true"));
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

test("only invited participants may read an ongoing meeting; any IRPA identity may read it outside proceedings", () => {
  const scheduled={status:"Scheduled",proceedingsStatus:"Not Started"};
  const ongoing={status:"In Progress",proceedingsStatus:"In Progress"};
  assert.equal(meetingContextAccessAllowed(scheduled,true,false),true);
  assert.equal(meetingContextAccessAllowed(ongoing,true,false),false);
  assert.equal(meetingContextAccessAllowed(ongoing,true,true),true);
  assert.equal(meetingContextAccessAllowed(scheduled,false,false),false);
  assert.equal(meetingContextAccessAllowed(ongoing,false,true),true);
});

test("members can retrieve the Meeting Portal directory regardless of status without receiving private meeting content", async () => {
  const result = await requestMeetingDirectory({
    uid: "directory-member", email: "member@example.test",
    identityCollection: "members", status: "Suspended"
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

test("employees can retrieve the Meeting Portal directory regardless of status", async () => {
  const result = await requestMeetingDirectory({
    uid: "directory-employee", email: "employee@example.test",
    identityCollection: "employees", status: "Former"
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.meetings.length, 1);
});

test("inactive members and employees retain universal Meeting Portal directory access", async () => {
  const member = await requestMeetingDirectory({uid:"inactive-member",email:"inactive-member@example.test",identityCollection:"members",status:"Suspended"});
  const employee = await requestMeetingDirectory({uid:"former-employee",email:"former-employee@example.test",identityCollection:"employees",status:"Former"});
  assert.equal(member.response.status,200); assert.equal(member.body.meetings.length,1);
  assert.equal(employee.response.status,200); assert.equal(employee.body.meetings.length,1);
});

test("external invitees without an IRPA identity cannot browse the general meeting directory", async () => {
  const result=await requestMeetingDirectory({uid:"external-invitee",email:"external@example.test",identityCollection:"external",status:"Active"});
  assert.equal(result.response.status,403);
  assert.equal(result.body.ok,false);
  assert.equal(result.listRead,false);
});

test("Meeting Portal Worker access is based on member/employee identity existence, not status", () => {
  const source = readFileSync(new URL("../drive-gateway/src/meetingServices.mjs", import.meta.url), "utf8");
  assert.match(source, /if\(!member&&!employee\)return fail/);
  assert.match(source, /const institutionalIdentity=!!member\|\|!!employee/);
  assert.match(source, /meetingContextAccessAllowed\(meeting,institutionalIdentity,explicitParticipant\)/);
});

test("Meeting Portal frontend grants initiation and category visibility to any registered IRPA identity", () => {
  const policy = readFileSync(new URL("../src/firebase/meetingPolicy.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/pages/Meetings.jsx", import.meta.url), "utf8");
  assert.match(policy, /identity\.memberIdentity===true\|\|identity\.employeeIdentity===true/);
  assert.match(page, /memberIdentity:!!member,employeeIdentity:!!employee/);
  assert.match(page, /identity\.memberIdentity===true\|\|identity\.employeeIdentity===true/);
});
