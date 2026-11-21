import test from "node:test";
import assert from "node:assert/strict";
import { isTrialMeeting, meetingEnvironment } from "../src/meetingEnvironment.mjs";
import { readFile } from "node:fs/promises";

test("only an explicit TRIAL environment is classified as deletable", () => {
  assert.equal(meetingEnvironment("TRIAL"), "TRIAL");
  assert.equal(meetingEnvironment("trial"), "REAL");
  assert.equal(meetingEnvironment(" TRIAL "), "REAL");
  assert.equal(meetingEnvironment(undefined), "REAL");
  assert.equal(meetingEnvironment(null), "REAL");
  assert.equal(meetingEnvironment(""), "REAL");
  assert.equal(meetingEnvironment("PRODUCTION"), "REAL");
  assert.equal(meetingEnvironment("REAL"), "REAL");
  assert.equal(isTrialMeeting({ environment: "TRIAL" }), true);
  assert.equal(isTrialMeeting({}), false);
});

test("meeting deletion and record purge routes require the TRIAL classifier", async () => {
  const source = await readFile(new URL("../src/meetingServices.mjs", import.meta.url), "utf8");
  assert.match(source, /if\(!isTrialMeeting\(c\.meeting\)\)return fail\(ctx,request,"Only an explicitly TRIAL meeting may be deleted/);
  assert.match(source, /if\(!isTrialMeeting\(c\.meeting\)\)return fail\(ctx,request,"Meeting records linked to REAL or unclassified meetings cannot be purged/);
  assert.ok(source.includes('["id","updateTime","createdAt","environment"].includes(key)'));
  assert.match(source, /environment:isAdmin&&meetingEnvironment\(incoming\.environment\)==="TRIAL"\?"TRIAL":"REAL"/);
});
