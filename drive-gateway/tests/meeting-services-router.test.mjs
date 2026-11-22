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
    "/api/meeting-register/list",
    "/api/meeting-register/get",
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


const fsValue = value => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(fsValue) } };
  return { stringValue: String(value) };
};
const fsDocument = (collection, id, data) => ({
  document: {
    name: `projects/test-project/databases/(default)/documents/${collection}/${id}`,
    fields: Object.fromEntries(Object.entries(data).map(([key,value]) => [key,fsValue(value)]))
  }
});

test("server-side meeting register returns only category-authorized, initiator and invited meetings", async () => {
  const previousFetch = globalThis.fetch;
  const meetings = [
    fsDocument("meetings","governance",{meetingCategory:"GOVERNANCE",meetingPolicyId:"GOVERNANCE",meetingType:"Board Meeting",initiatorUid:"other-user"}),
    fsDocument("meetings","staff",{meetingCategory:"STAFF",meetingPolicyId:"STAFF",meetingType:"Staff Meeting",initiatorUid:"other-user"}),
    fsDocument("meetings","own",{meetingCategory:"GOVERNANCE",meetingPolicyId:"GOVERNANCE",meetingType:"Board Meeting",initiatorUid:"staff-user"}),
    fsDocument("meetings","invited",{meetingCategory:"GOVERNANCE",meetingPolicyId:"GOVERNANCE",meetingType:"Board Meeting",initiatorUid:"other-user",invitedEmails:["staff@example.test"]}),
    fsDocument("meetings","private",{meetingCategory:"GOVERNANCE",meetingPolicyId:"GOVERNANCE",meetingType:"Board Meeting",initiatorUid:"other-user"}),
    fsDocument("meetings","participant-only",{meetingCategory:"GOVERNANCE",meetingPolicyId:"GOVERNANCE",meetingType:"Board Meeting",initiatorUid:"other-user"}),
    fsDocument("meetings","revoked-participant",{meetingCategory:"GOVERNANCE",meetingPolicyId:"GOVERNANCE",meetingType:"Board Meeting",initiatorUid:"other-user"})
  ];
  const participants = [
    fsDocument("participants","active-participant",{meetingId:"participant-only",participantEmail:"staff@example.test",meetingAccessDispatched:true,meetingAccessRevoked:false,status:"Active"}),
    fsDocument("participants","revoked-participant",{meetingId:"revoked-participant",participantEmail:"staff@example.test",meetingAccessDispatched:true,meetingAccessRevoked:true,status:"Active"})
  ];
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith(":runQuery")) {
      const collection = JSON.parse(init.body).structuredQuery.from[0].collectionId;
      const rows = collection === "meetings" ? meetings : collection === "participants" ? participants : [];
      return new Response(JSON.stringify(rows), { status:200, headers:{"content-type":"application/json"} });
    }
    if (parsed.pathname.endsWith("/members/staff-user")) {
      return new Response(JSON.stringify({fields:{uid:fsValue("staff-user"),status:fsValue("Active"),role:fsValue("Staff")}}), {status:200,headers:{"content-type":"application/json"}});
    }
    return new Response(JSON.stringify({error:{message:"NOT_FOUND"}}), {status:404,headers:{"content-type":"application/json"}});
  };
  const authed = {
    ...ctx,
    authenticateFirebaseRequest: async () => ({user_id:"staff-user",email:"staff@example.test",admin:false})
  };
  try {
    const response = await post(createMeetingServicesRouter(authed), "/api/meeting-register/list");
    assert.equal(response.status,200);
    const body = await response.json();
    assert.equal(body.ok,true);
    assert.deepEqual(body.meetings.map(row=>row.id).sort(),["invited","own","participant-only","staff"]);
    assert.equal(body.accessMode,"SERVER_AUTHORIZED_CATEGORY_AND_PARTICIPANT_SCOPE");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
