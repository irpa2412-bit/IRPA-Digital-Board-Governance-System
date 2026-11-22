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


const fsGetDocument = (collection,id,data) => ({
  name:`projects/test-project/databases/(default)/documents/${collection}/${id}`,
  fields:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,fsValue(value)]))
});

test("active Executive Director authority can create, edit, open voting, record decisions/actions and mark attendance",async()=>{
  const previousFetch=globalThis.fetch;
  const employee=fsDocument("employees","ed-user",{uid:"ed-user",email:"ed@example.test",employeeNumber:"IRPA-EMP-00101",status:"Active",role:"Executive Director"});
  const meeting=fsGetDocument("meetings","meeting-1",{title:"Seeded meeting",meetingCategory:"GOVERNANCE",meetingPolicyId:"GOVERNANCE",status:"Scheduled",registerStatus:"Registered",initiatorUid:"other-user"});
  const participant=fsGetDocument("participants","participant-1",{meetingId:"meeting-1",participantUid:"member-1",status:"Active"});
  const calls=[];
  globalThis.fetch=async(url,init={})=>{
    const parsed=new URL(url),method=init.method||"GET";
    if(parsed.pathname.endsWith(":runQuery")){
      const collection=JSON.parse(init.body).structuredQuery.from[0].collectionId;
      const rows=collection==="employees"?[employee]:collection==="participants"&&JSON.parse(init.body).structuredQuery.where?[participant]:[];
      return new Response(JSON.stringify(rows),{status:200,headers:{"content-type":"application/json"}});
    }
    if(parsed.pathname.endsWith("/adminProfiles/ed-user"))return new Response("{}",{status:404});
    if(parsed.pathname.endsWith("/meetings/meeting-1")&&method==="GET")return new Response(JSON.stringify(meeting),{status:200,headers:{"content-type":"application/json"}});
    if(parsed.pathname.endsWith("/participants/participant-1")&&method==="GET")return new Response(JSON.stringify(participant),{status:200,headers:{"content-type":"application/json"}});
    if(method==="POST"||method==="PATCH"){calls.push({method,path:parsed.pathname});return new Response("{}",{status:200,headers:{"content-type":"application/json"}});}
    return new Response("{}",{status:404});
  };
  const authed={...ctx,authenticateFirebaseRequest:async()=>({user_id:"ed-user",email:"ed@example.test",admin:false})};
  try{
    const router=createMeetingServicesRouter(authed);
    const created=await post(router,"/api/meeting-register/create",{data:{title:"New governance meeting",meetingCategory:"GOVERNANCE",initiatorUid:"ed-user",date:"2026-12-01"}});
    assert.equal(created.status,200,"Executive Director must create governance meetings");
    const edited=await post(router,"/api/meeting-register/update",{meetingId:"meeting-1",data:{title:"Updated by ED"}});
    assert.equal(edited.status,200,"Executive Director must edit registered meetings");
    const opened=await post(router,"/api/meeting-voting/open",{meetingId:"meeting-1",votingReference:"VOTE-ED-1"});
    assert.equal(opened.status,200,"Executive Director must control voting");
    const action=await post(router,"/api/meeting-actions/create",{data:{meetingId:"meeting-1",title:"ED action"}});
    assert.equal(action.status,200,"Executive Director must record actions");
    const decision=await post(router,"/api/meeting-decisions/create",{data:{meetingId:"meeting-1",title:"ED decision"}});
    assert.equal(decision.status,200,"Executive Director must record decisions");
    const attendance=await post(router,"/api/meeting-attendance/mark",{meetingId:"meeting-1",participantId:"participant-1",attendanceStatus:"Present"});
    assert.equal(attendance.status,200,"Executive Director must record attendance");
    assert.ok(calls.some(call=>call.method==="PATCH"&&call.path.endsWith("/meetings/meeting-1")));
  }finally{globalThis.fetch=previousFetch;}
});

test("inactive Executive Director authority is denied on the next Worker request with duty context",async()=>{
  const previousFetch=globalThis.fetch;
  const employee=fsDocument("employees","ed-user",{uid:"ed-user",email:"ed@example.test",employeeNumber:"IRPA-EMP-00101",status:"Inactive",role:"Executive Director"});
  globalThis.fetch=async(url,init={})=>{
    const parsed=new URL(url),method=init.method||"GET";
    if(parsed.pathname.endsWith(":runQuery")){const collection=JSON.parse(init.body).structuredQuery.from[0].collectionId;return new Response(JSON.stringify(collection==="employees"?[employee]:[]),{status:200,headers:{"content-type":"application/json"}});}
    if(parsed.pathname.endsWith("/adminProfiles/ed-user"))return new Response("{}",{status:404});
    return new Response("{}",{status:404});
  };
  const authed={...ctx,authenticateFirebaseRequest:async()=>({user_id:"ed-user",email:"ed@example.test",admin:false})};
  try{
    const response=await post(createMeetingServicesRouter(authed),"/api/meeting-register/create",{data:{title:"Denied meeting",meetingCategory:"GOVERNANCE",initiatorUid:"ed-user"}});
    assert.equal(response.status,403);
    const body=await response.json();
    assert.match(body.error,/Denied duty: create and register a meeting/);
    assert.match(body.error,/Roles allowed:.*Executive Director/);
  }finally{globalThis.fetch=previousFetch;}
});
