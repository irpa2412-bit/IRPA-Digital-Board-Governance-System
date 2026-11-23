import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingServicesRouter } from "../src/meetingServices.mjs";

const ctx = {
  authenticateFirebaseRequest: async () => { throw new Error("Firebase authentication is required."); },
  getFirebaseProjectId: () => "test-project",
  getFirestoreAdminAccessToken: async () => "test-token",
  sendEmail: async () => "test-message-id",
  json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }),
  corsHeaders: () => ({ "content-type": "application/json" })
};
const post = (router, path, body = {}) => router(new Request("https://worker.test" + path, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
}), { FIREBASE_PROJECT_ID: "test-project" }, path);

test("meeting services router ignores unrelated paths", async () => {
  assert.equal(await post(createMeetingServicesRouter(ctx), "/api/not-a-meeting-service"), null);
});

test("meeting record operations require Firebase-authenticated identity", async () => {
  const response = await post(createMeetingServicesRouter(ctx), "/api/meeting-records/capture", {
    meetingId: "test-meeting",
    recordType: "MINUTES_DRAFT",
    content: "Non-confidential test minutes"
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign-in/i);
});

test("LiveKit token issuance also requires an authenticated identity", async () => {
  const response = await post(createMeetingServicesRouter(ctx), "/api/meeting-media/token", {
    meetingId: "test-meeting",
    selectedAuthority: "Board Member"
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign-in/i);
});

test("meeting register, decision, and voting control routes require authenticated identity", async () => {
  const router = createMeetingServicesRouter(ctx);
  for (const path of [
    "/api/meeting-register/create",
    "/api/meeting-register/update",
    "/api/meeting-register/delete",
    "/api/meeting-decisions/create",
    "/api/meeting-actions/create",
    "/api/meeting-voting/open",
    "/api/meeting-voting/close",
    "/api/meeting-participants/create",
    "/api/meeting-participants/update",
    "/api/meeting-participants/delete",
    "/api/meeting-room/activity",
    "/api/meeting-room/event",
    "/api/meeting-subscriptions/mine",
    "/api/meeting-entry-requests/list",
    "/api/meeting-entry-requests/resolve",
    "/api/meeting-attendance/register",
    "/api/meeting-attendance/mark",
    "/api/meeting-attendance/daily/register",
    "/api/meeting-attendance/daily/mark",
    "/api/meeting-attendance/daily/dispatch",
    "/api/meeting-working-documents/register",
    "/api/meeting-working-documents/list",
    "/api/meeting-working-documents/review"
  ]) {
    const response = await post(router, path, { meetingId: "test-meeting" });
    assert.equal(response.status, 401, path);
    assert.match((await response.json()).error, /sign-in/i, path);
  }
});

test("direct attendance signature endpoint is retired in favour of Signature Portal email-link envelopes", async () => {
  assert.equal(await post(createMeetingServicesRouter(ctx), "/api/meeting-attendance/sign", { meetingId: "test-meeting" }), null);
});


async function createMeetingAsIdentity({ uid, email, member = null, employee = null, category = "GENERAL" }) {
  const originalFetch = globalThis.fetch;
  let meetingWrites = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const documentPath = url.pathname.split("/documents/")[1] || "";
    if (init.method === "POST") {
      if (documentPath === "meetings") meetingWrites += 1;
      return new Response(JSON.stringify({ name: url.pathname + "/test-record", fields: {} }), { status: 200 });
    }
    const collection = documentPath.split("/")[0];
    const id = documentPath.split("/")[1];
    const record = collection === "adminProfiles" ? null
      : collection === "members" ? member
      : collection === "employees" ? employee
      : null;
    if (id !== uid || !record) return new Response("{}", { status: 404 });
    const fields = Object.fromEntries(Object.entries(record).map(([key, value]) => [key, { stringValue: String(value) }]));
    return new Response(JSON.stringify({ name: url.pathname, fields }), { status: 200 });
  };
  try {
    const authenticatedContext = {
      ...ctx,
      authenticateFirebaseRequest: async () => ({ user_id: uid, email })
    };
    const response = await post(createMeetingServicesRouter(authenticatedContext), "/api/meeting-register/create", {
      data: {
        title: "Member-initiated governance meeting",
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

test("active staff can initiate a governance-level meeting through the Worker", async () => {
  const result = await createMeetingAsIdentity({
    uid: "staff-initiator", email: "staff@example.test",
    employee: { uid: "staff-initiator", email: "staff@example.test", status: "Active", role: "Staff" },
    category: "GOVERNANCE"
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.meetingWrites, 1);
});

test("active members can initiate meetings through the Worker without a management title", async () => {
  const result = await createMeetingAsIdentity({
    uid: "member-initiator", email: "member@example.test",
    member: { uid: "member-initiator", email: "member@example.test", status: "Active", role: "Member" },
    category: "ADMINISTRATIVE"
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.meetingWrites, 1);
});

test("inactive or unregistered identities cannot initiate meetings through the Worker", async () => {
  const result = await createMeetingAsIdentity({
    uid: "inactive-user", email: "inactive@example.test",
    employee: { uid: "inactive-user", email: "inactive@example.test", status: "Suspended", role: "Staff" },
    category: "GENERAL"
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(result.meetingWrites, 0);
});
