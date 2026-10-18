import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingPortalRouter } from "../src/meetingPortal.mjs";

const field = value => {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, field(v)])) } };
};
const document = (collection, id, data, updateTime = "2026-10-10T00:00:00.000Z") => ({
  name: `projects/test-project/databases/(default)/documents/${collection}/${id}`,
  updateTime,
  fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, field(v)]))
});
const ctxFor = ({ meeting, participant, admin = false, user = { user_id: "organizer-1", email: "organizer@example.org" }, onCommit = () => {} } = {}) => {
  const calls = [];
  const ctx = {
    authenticateFirebaseRequest: async () => user,
    getFirebaseProjectId: () => "test-project",
    getFirestoreAdminAccessToken: async () => "test-admin-token",
    json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }),
    corsHeaders: () => ({ "content-type": "application/json" })
  };
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(url);
    calls.push({ url: target, init });
    if (target.pathname.endsWith("/documents:commit")) {
      onCommit(JSON.parse(init.body));
      return new Response(JSON.stringify({ commitTime: new Date().toISOString() }), { status: 200 });
    }
    const match = target.pathname.match(/\/documents\/(meetings|participants|adminProfiles|meetingAccessTokens)\/([^/]+)$/);
    if (match) {
      const [, collection, id] = match;
      if (collection === "meetings" && meeting && id === meeting.id) return new Response(JSON.stringify(document(collection, id, meeting.data, meeting.updateTime)), { status: 200 });
      if (collection === "participants" && participant && id === participant.id) return new Response(JSON.stringify(document(collection, id, participant.data)), { status: 200 });
      if (collection === "adminProfiles" && admin && id === user.user_id) return new Response(JSON.stringify(document(collection, id, { active: true })), { status: 200 });
      return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  return { ctx, calls };
};
const post = (router, path, body = {}) => router(new Request(`https://worker.test${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer test-id-token" },
  body: JSON.stringify(body)
}), { FIREBASE_PROJECT_ID: "test-project" }, path);

test("meeting portal router ignores unrelated paths", async () => {
  const { ctx } = ctxFor();
  const router = createMeetingPortalRouter(ctx);
  assert.equal(await post(router, "/api/not-a-meeting-route"), null);
});

test("issue rejects a participant linked to a different meeting", async () => {
  const { ctx } = ctxFor({
    meeting: { id: "meeting-1", data: { initiatorUid: "organizer-1", status: "Scheduled" } },
    participant: { id: "participant-1", data: { meetingId: "meeting-other", participantEmail: "p@example.org" } }
  });
  const response = await post(createMeetingPortalRouter(ctx), "/api/meeting-access/issue", { meetingId: "meeting-1", participantId: "participant-1" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /not linked/i);
});

test("issue creates an access pass and updates invitee tally in one atomic Firestore commit", async () => {
  let committed;
  const { ctx, calls } = ctxFor({
    meeting: { id: "meeting-1", updateTime: "2026-10-10T00:00:00.000Z", data: { initiatorUid: "organizer-1", title: "Board Meeting", invitedParticipantIds: [], invitedEmails: [] } },
    participant: { id: "participant-1", data: { meetingId: "meeting-1", participantName: "Test Participant", participantEmail: "participant@example.org" } },
    onCommit: value => { committed = value; }
  });
  const response = await post(createMeetingPortalRouter(ctx), "/api/meeting-access/issue", { meetingId: "meeting-1", participantId: "participant-1" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(body.accessToken);
  assert.ok(body.meetingPassword);
  assert.equal(committed.writes.length, 2);
  assert.equal(committed.writes[0].currentDocument.exists, false);
  assert.equal(committed.writes[1].currentDocument.updateTime, "2026-10-10T00:00:00.000Z");
  assert.equal(committed.writes[0].update.fields.tokenHash.stringValue.length, 64);
  assert.equal(committed.writes[0].update.fields.passwordHash.stringValue.length, 64);
  assert.equal(committed.writes[1].update.fields.invitedParticipantCount.integerValue, "1");
  assert.equal(calls.filter(call => call.url.pathname.endsWith("/documents:commit")).length, 1);
});
