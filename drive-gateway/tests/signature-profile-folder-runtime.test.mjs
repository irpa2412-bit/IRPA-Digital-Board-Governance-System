import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const start = source.indexOf("async function ensureSignatureProfileFolder");
const end = source.indexOf("async function ", start + 20);
const handler = source.slice(start, end);

test("signature profile folder provisioning uses a defined active-admin authorization result", () => {
  assert.ok(start >= 0 && end > start, "signature profile folder handler must be present");
  assert.match(handler, /const isAdmin = Boolean\(adminRecord\?\.fields\?\.active\?\.booleanValue\)/);
  assert.match(handler, /if \(!isAdmin && requestedUid !== claims\.user_id\)/);
  assert.doesNotMatch(handler, /isAdminForRequest/);
});
