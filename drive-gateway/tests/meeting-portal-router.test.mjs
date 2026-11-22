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
const ctxFor = ({ meeting, participant, pass, admin = false, user = { user_id: "organizer-1", email: "organizer@example.org" }, onCommit = () => {} } = {}) => {
  const calls = [];
  const ctx = {
    authenticateFirebaseRequest: async () => user,
    getFirebaseProjectId: () => "test-project",
    getFirestoreAdminAccessToken: async () => "test-admin-token",
    json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }),
    corsHeaders: () => ({ "content-type": "application/json" }),
    sendEmail: async (env, message) => { ctx.sentEmail = message; return "250 accepted"; },
    enforceMailRateLimit: async (env, uid) => { ctx.rateLimitedUid = uid; }
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
      if (collection === "meetingAccessTokens" && pass && id === pass.id) return new Response(JSON.stringify(document(collection, id, pass.data)), { status: 200 });
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
}), { FIREBASE_PROJECT_ID: "test-project", IRPA_APP_URL: "https://app.example.test" }, path);
test("meeting invitation dispatch uses the injected SMTP worker and writes only meeting participant delivery metadata", async () => {
  const accessToken = "test-meeting-access-token-0123456789";
  const meetingPassword = "ABCD1234WXYZ";
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, "0")).join("");
  let committed;
  const { ctx, calls } = ctxFor({
    meeting: { id: "meeting-1", data: { initiatorUid: "organizer-1", title: "Board Meeting", reference: "IRPA-MTG-001", status: "Scheduled", platformAccessUrl: "https://meet.example.org/board", platformMeetingId: "ROOM-123", platformPasscode: "ROOM-PASS", agenda: "Approve minutes", invitedEmails:[], participantEmails:[] } },
    participant: { id: "participant-1", data: { meetingId: "meeting-1", participantName: "Test Participant", participantEmail: "participant@example.org" } },
    pass: { id: "access-1", data: {
      meetingId: "meeting-1", participantId: "participant-1", participantEmail: "participant@example.org",
      tokenHash: await digest(accessToken), passwordHash: await digest(meetingPassword), status: "Active",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    } },
    onCommit: value => { committed = value; }
  });
  const response = await post(createMeetingPortalRouter(ctx), "/api/meeting-invitations/dispatch", {
    accessId: "access-1", accessToken, meetingPassword
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.meetingAccessSent, true);
  assert.equal(ctx.sentEmail.to, "participant@example.org");
  assert.equal(ctx.rateLimitedUid, "organizer-1");
  assert.match(ctx.sentEmail.subject, /IRPA Meeting Invitation/);
  assert.match(ctx.sentEmail.text, /Gate password: ABCD1234WXYZ/);
  assert.match(ctx.sentEmail.text, /Online meeting link: https:\/\/meet\.example\.org\/board/);
  assert.match(ctx.sentEmail.html, /Join online meeting/);
  assert.match(ctx.sentEmail.text, /Agenda: Approve minutes/);
  assert.match(ctx.sentEmail.text, /meetingToken=/);
  assert.ok(committed.writes.some(write => write.update?.fields?.meetingAccessDispatched?.booleanValue === true && write.update?.fields?.meetingAccessRevoked?.booleanValue === false));
  assert.ok(committed.writes.some(write => write.update?.fields?.participantEmails?.arrayValue?.values?.some(value => value.stringValue === "participant@example.org")));
  assert.ok(calls.some(call => call.url.pathname.endsWith("/documents/audit")));
});


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
  assert.equal(committed.writes.length, 3);
  assert.equal(committed.writes[0].currentDocument.exists, false);
  assert.equal(committed.writes[1].currentDocument.updateTime, "2026-10-10T00:00:00.000Z");
  assert.equal(committed.writes[0].update.fields.tokenHash.stringValue.length, 64);
  assert.equal(committed.writes[0].update.fields.passwordHash.stringValue.length, 64);
  assert.equal(committed.writes[1].update.fields.invitedParticipantCount.integerValue, "1");
  assert.equal(committed.writes[1].update.fields.invitedEmails.arrayValue.values.length, 0);
  assert.equal(committed.writes[1].update.fields.participantEmails.arrayValue.values.length, 0);
  assert.equal(committed.writes[2].update.fields.meetingAccessRevoked.booleanValue, true);
  assert.equal(committed.writes[2].update.fields.meetingAccessDispatched.booleanValue, false);
  assert.equal(calls.filter(call => call.url.pathname.endsWith("/documents:commit")).length, 1);
});


test("revoking the last active meeting access pass removes meeting read access atomically", async () => {
  let committed;
  const { ctx } = ctxFor({
    meeting: { id:"meeting-1", data:{initiatorUid:"organizer-1",invitedEmails:["participant@example.org"],participantEmails:["participant@example.org"]} },
    participant: { id:"participant-1", data:{meetingId:"meeting-1",participantEmail:"participant@example.org",meetingAccessDispatched:true,meetingAccessRevoked:false} },
    pass: { id:"access-1", data:{meetingId:"meeting-1",participantId:"participant-1",participantEmail:"participant@example.org",status:"Active",createdByUid:"organizer-1",expiresAt:new Date(Date.now()+3600000).toISOString()} },
    onCommit: value => { committed = value; }
  });
  const response = await post(createMeetingPortalRouter(ctx), "/api/meeting-access/revoke", {accessId:"access-1"});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.status,"Revoked");
  assert.equal(body.participantAccessRemoved,true);
  assert.ok(committed.writes.some(write=>write.update?.fields?.status?.stringValue==="Revoked"));
  assert.ok(committed.writes.some(write=>write.update?.fields?.invitedEmails?.arrayValue?.values?.length===0&&write.update?.fields?.participantEmails?.arrayValue?.values?.length===0));
  assert.ok(committed.writes.some(write=>write.update?.fields?.meetingAccessRevoked?.booleanValue===true&&write.update?.fields?.meetingAccessDispatched?.booleanValue===false));
});
