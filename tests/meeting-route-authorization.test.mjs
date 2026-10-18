import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingServicesRouter } from "../drive-gateway/src/meetingServices.mjs";

const env = { FIREBASE_PROJECT_ID: "test-project" };
const path = "/api/meeting-working-documents/register";
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" }
});
const fsValue = value => {
  if (Array.isArray(value)) return { arrayValue: { values: value.map(item => fsValue(item)) } };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: value };
  return { stringValue: String(value) };
};
const fsDoc = (collection, id, fields) => ({
  name: `projects/test-project/databases/(default)/documents/${collection}/${id}`,
  fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fsValue(value)]))
});

function makeContext(claims, { authenticated = true } = {}) {
  return {
    authenticateFirebaseRequest: async () => {
      if (!authenticated) throw new Error("Missing/invalid token");
      return claims;
    },
    getFirebaseProjectId: () => "test-project",
    getFirestoreAdminAccessToken: async () => "test-token",
    sendEmail: async () => "test-message-id",
    json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }),
    corsHeaders: () => ({ "content-type": "application/json" })
  };
}

function mockFirestore(t, { meeting, document, activeMemberUid = "" }) {
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(String(input));
    const pathname = url.pathname;
    if (pathname.endsWith("/documents:runQuery")) return response([]);
    if (pathname.endsWith("/documents/meetings/meeting-1")) {
      return meeting ? response(fsDoc("meetings", "meeting-1", meeting)) : response({ error: "missing" }, 404);
    }
    if (pathname.endsWith("/documents/documents/doc-1")) {
      return document ? response(fsDoc("documents", "doc-1", document)) : response({ error: "missing" }, 404);
    }
    if (activeMemberUid && pathname.endsWith("/documents/members/" + activeMemberUid)) {
      return response(fsDoc("members", activeMemberUid, {
        uid: activeMemberUid, email: "host@example.org", role: "Board Member", status: "Active", active: true
      }));
    }
    if (/\/documents\/(adminProfiles|members|employees)\//.test(pathname)) return response({ error: "missing" }, 404);
    if (pathname.endsWith("/documents/meetingWorkingDocuments") ||
        pathname.endsWith("/documents/audit")) {
      return response({ name: pathname, fields: {} });
    }
    if (pathname.includes("/documents/meetingWorkingDocuments/")) return response({ error: "missing" }, 404);
    if (init.method === "POST") return response({ name: pathname, fields: {} });
    return response({ error: "unexpected Firestore request", path: pathname }, 500);
  });
}

const post = (router, body = {}) => router(new Request("https://worker.test" + path, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer test-token" },
  body: JSON.stringify({ meetingId: "meeting-1", documentId: "doc-1", ...body })
}), env, path);

test("meeting document registration rejects a missing or invalid Firebase token", async t => {
  mockFirestore(t, { meeting: { createdByUid: "host-1", participantUids: ["host-1"] }, document: { meetingId: "meeting-1" } });
  const router = createMeetingServicesRouter(makeContext({ user_id: "host-1" }, { authenticated: false }));
  const result = await post(router);
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), { ok: false, error: "A valid IRPA sign-in is required." });
});

test("meeting document registration rejects an authenticated participant without manager authority", async t => {
  mockFirestore(t, { meeting: { participantUids: ["participant-1"] }, document: { meetingId: "meeting-1" } });
  const router = createMeetingServicesRouter(makeContext({ user_id: "participant-1", email: "participant@example.org" }));
  const result = await post(router);
  assert.equal(result.status, 403);
  assert.match((await result.json()).error, /meeting host, chairperson or secretary/i);
});

test("meeting document registration rejects a document belonging to another meeting", async t => {
  mockFirestore(t, {
    meeting: { createdByUid: "host-1", participantUids: ["host-1"] },
    document: { meetingId: "different-meeting", title: "Wrong meeting document" },
    activeMemberUid: "host-1"
  });
  const router = createMeetingServicesRouter(makeContext({ user_id: "host-1", email: "host@example.org" }));
  const result = await post(router);
  assert.equal(result.status, 409);
  assert.match((await result.json()).error, /explicitly linked to this meeting/i);
});

test("meeting host can register a document linked to the requested meeting", async t => {
  mockFirestore(t, {
    meeting: { createdByUid: "host-1", title: "Test meeting" },
    document: { meetingId: "meeting-1", title: "Valid meeting document", fileName: "minutes.pdf" },
    activeMemberUid: "host-1"
  });
  const router = createMeetingServicesRouter(makeContext({ user_id: "host-1", email: "host@example.org" }));
  const result = await post(router);
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.workingDocumentId, "string");
  assert.ok(body.workingDocumentId.length > 0);
});
