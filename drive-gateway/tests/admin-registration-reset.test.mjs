import test from "node:test";
import assert from "node:assert/strict";
import { handleAdminRegistrationReset, ADMIN_RESET_CONFIRMATION } from "../src/adminRegistrationReset.mjs";

const secret = "a".repeat(64);
const operationId = "123e4567-e89b-42d3-a456-426614174000";
const actor = { user_id: "operator-uid", email: "irpa2412@gmail.com", auth_time: Math.floor(Date.now()/1000), token: "test-id-token" };
const reason = "Recover the designated administrator registration after verified lockout.";
const env = { ADMIN_REGISTRATION_RESET_ENABLED: "true", IRPA_RESET_DEVELOPER_SECRET: secret };

function setup(overrides = {}) {
  const state = {
    target: { updateTime: "2026-10-15T06:00:00.000000Z", fields: { active: { booleanValue: true }, email: { stringValue: "target@example.org" } } },
    audit: null,
    writes: []
  };
  const deps = {
    authenticate: async () => actor,
    getFirebaseProjectId: () => "demo-irpa-reset-staging",
    getFirestoreDocument: async (_env, path) => path.startsWith("adminProfiles/") ? state.target : state.audit,
    commitWrites: async ({ writes }) => {
      state.writes.push(writes);
      for (const write of writes) {
        if (write.update.name.endsWith("/adminProfiles/target-uid")) state.target = { ...state.target, fields: { ...state.target.fields, active: { booleanValue: false } } };
        if (write.update.name.includes("/audit/")) state.audit = { fields: write.update.fields };
      }
      return {};
    },
    json: (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers }),
    corsHeaders: () => ({ "cache-control": "no-store" })
  };
  return { state, deps: { ...deps, ...overrides } };
}
function request({key=secret, body={}, method="POST"}={}) {
  return new Request("https://staging.example.workers.dev/api/admin-registration/reset", {
    method,
    headers: { "content-type":"application/json", authorization:"Bearer test", "x-irpa-reset-secret":key },
    body: method==="POST" ? JSON.stringify({targetUid:"target-uid",operationId,confirmation:ADMIN_RESET_CONFIRMATION,reason,...body}) : undefined
  });
}

test("updates only the target active flag and appends a hashed audit record", async () => {
  const {state,deps}=setup();
  const response=await handleAdminRegistrationReset(request(),env,deps);
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.status,"COMPLETED");
  assert.equal(state.target.fields.active.booleanValue,false);
  assert.equal(state.target.fields.email.stringValue,"target@example.org");
  assert.equal(state.writes.length,1);
  assert.equal(state.writes[0].length,2);
  assert.deepEqual(state.writes[0][0].updateMask.fieldPaths,["active"]);
  assert.match(state.writes[0][1].update.name,/\/audit\/admin-registration-reset-/);
  const writtenDocumentPaths = state.writes[0].map(w => w.update.name.split("/documents/")[1] || "");
  assert.deepEqual(writtenDocumentPaths, [
    "adminProfiles/target-uid",
    `audit/admin-registration-reset-${operationId}`
  ]);
  assert.equal(state.audit.fields.eventHash.stringValue,body.eventHash);
});

test("rejects wrong secret, non-operator, stale authentication, and self-reset", async () => {
  const wrong=setup();
  assert.equal((await handleAdminRegistrationReset(request({key:"b".repeat(64)}),env,wrong.deps)).status,403);
  assert.equal(wrong.state.writes.length,0);
  const other=setup({authenticate:async()=>({...actor,email:"other@example.org"})});
  assert.equal((await handleAdminRegistrationReset(request(),env,other.deps)).status,403);
  const stale=setup({authenticate:async()=>({...actor,auth_time:actor.auth_time-601})});
  assert.equal((await handleAdminRegistrationReset(request(),env,stale.deps)).status,403);
  const self=setup();
  assert.equal((await handleAdminRegistrationReset(request({body:{targetUid:actor.user_id}}),env,self.deps)).status,403);
  assert.equal(self.state.writes.length,0);
});

test("requires explicit confirmation and a valid operation ID", async () => {
  const a=setup();
  assert.equal((await handleAdminRegistrationReset(request({body:{confirmation:"yes"}}),env,a.deps)).status,400);
  const b=setup();
  assert.equal((await handleAdminRegistrationReset(request({body:{operationId:"reuse-me"}}),env,b.deps)).status,400);
  assert.equal(b.state.writes.length,0);
});

test("repeated request is idempotent and audit integrity is checked", async () => {
  const {state,deps}=setup();
  const first=await (await handleAdminRegistrationReset(request(),env,deps)).json();
  const second=await (await handleAdminRegistrationReset(request(),env,deps)).json();
  assert.equal(first.status,"COMPLETED");
  assert.equal(second.status,"ALREADY_APPLIED");
  assert.equal(second.eventHash,first.eventHash);
  assert.equal(state.writes.length,1);
  const tampered=setup();
  const created=await handleAdminRegistrationReset(request(),env,tampered.deps);
  await created.text();
  tampered.state.audit.fields.reason={stringValue:"tampered audit"};
  const denied=await handleAdminRegistrationReset(request(),env,tampered.deps);
  assert.equal(denied.status,409);
  assert.equal(tampered.state.writes.length,1);
});

test("feature flag and malformed secret fail closed", async () => {
  const {state,deps}=setup();
  assert.equal((await handleAdminRegistrationReset(request(),{IRPA_RESET_DEVELOPER_SECRET:secret},deps)).status,404);
  assert.equal((await handleAdminRegistrationReset(request(),{...env,IRPA_RESET_DEVELOPER_SECRET:"bad"},deps)).status,403);
  assert.equal(state.writes.length,0);
});
