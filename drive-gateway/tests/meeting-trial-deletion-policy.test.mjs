import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { meetingDeletionPolicy, meetingEnvironmentAtCreation, meetingUpdateChanges } from "../src/meetingServices.mjs";

test("REAL meeting cannot be deleted by an administrator", () => {
  const result = meetingDeletionPolicy({ environment: "REAL" }, true);
  assert.equal(result.allowed, false);
  assert.equal(result.status, 409);
});

test("missing environment is protected as REAL", () => {
  const result = meetingDeletionPolicy({}, true);
  assert.equal(result.allowed, false);
  assert.equal(result.status, 409);
});

test("invalid environment is protected as REAL", () => {
  const result = meetingDeletionPolicy({ environment: "trial" }, true);
  assert.equal(result.allowed, false);
  assert.equal(result.status, 409);
});

test("TRIAL meeting can be deleted only by an administrator", () => {
  assert.equal(meetingDeletionPolicy({ environment: "TRIAL" }, true).allowed, true);
  const nonAdmin = meetingDeletionPolicy({ environment: "TRIAL" }, false);
  assert.equal(nonAdmin.allowed, false);
  assert.equal(nonAdmin.status, 403);
});

test("environment is assigned once at creation from trusted administrator intent", () => {
  assert.equal(meetingEnvironmentAtCreation({ environment: "TRIAL" }, true), "TRIAL");
  assert.equal(meetingEnvironmentAtCreation({ environment: "TRIAL" }, false), "REAL");
  assert.equal(meetingEnvironmentAtCreation({ environment: "INVALID" }, true), "REAL");
  assert.equal(meetingEnvironmentAtCreation({}, true), "REAL");
});

test("attempted environment change is ignored on update", () => {
  const changed = meetingUpdateChanges({ environment: "REAL", title: "Existing" }, { environment: "TRIAL", title: "Updated" }, true);
  assert.deepEqual(changed, { title: "Updated" });
  assert.equal(Object.hasOwn(changed, "environment"), false);
});

test("both physical deletion entry points enforce the parent meeting TRIAL policy", () => {
  const source = readFileSync(new URL("../src/meetingServices.mjs", import.meta.url), "utf8");
  const checks = source.match(/meetingDeletionPolicy\(c\.meeting,c\.isAdmin\)/g) || [];
  assert.equal(checks.length, 2, "meeting-register deletion and meeting-record PURGE must both apply the same fail-closed policy");
  const purgeStart = source.indexOf('if(op==="PURGE"){');
  const translateStart = source.indexOf('if(pathname==="/api/meeting-transcripts/translate")', purgeStart);
  assert.ok(purgeStart >= 0 && translateStart > purgeStart, "meeting-record PURGE route must be located");
  assert.match(source.slice(purgeStart, translateStart), /meetingDeletionPolicy/);
});
