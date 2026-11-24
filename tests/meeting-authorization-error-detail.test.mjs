import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../drive-gateway/src/meetingServices.mjs", import.meta.url), "utf8");

test("meeting identity remains active when any authoritative status field is active", () => {
  assert.match(source, /\[r\.status,r\.registrationStatus,r\.employmentStatus, r\.memberStatus,r\.accountStatus\]\.some/);
  assert.doesNotMatch(source, /lower\(r\.status\s*\|\|\s*r\.registrationStatus\s*\|\|\s*r\.employmentStatus\)/);
});

test("meeting gateway preserves the specific safe authorization failure reason", () => {
  assert.match(source, /status===403\?\(clean\(error\?\.message\)\|\|"You are not authorised to perform this meeting operation\."\)/);
});
