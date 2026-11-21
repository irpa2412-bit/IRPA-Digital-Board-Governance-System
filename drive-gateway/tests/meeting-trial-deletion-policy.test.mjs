import test from "node:test";
import assert from "node:assert/strict";
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
