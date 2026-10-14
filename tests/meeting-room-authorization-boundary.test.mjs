import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/MeetingRoom.jsx", import.meta.url), "utf8");

test("participant invitation context grants media entry but not host governance control", () => {
  assert.match(source, /hostController=!!admin\?\.active\|\|String\(selected\?\.initiatorUid\|\|""\)===String\(auth\.currentUser\?\.uid\|\|""\)\|\|roleControl\(member,selected\),controller=hostController/);
  assert.doesNotMatch(source, /controller=!!admin\?\.active\|\|roleControl\(member,selected\)\|\|Boolean\(entryContext\?\.participantId/);
  assert.match(source, /controller=\{Boolean\(hostController\|\|\(auth\.currentUser&&entryContext\?\.participantId&&entryContext\?\.meetingId===selected\?\.id\)\)\}/);
});

test("host governance mutations retain the explicit controller guard", () => {
  for (const name of ["openLive", "pauseLive", "closeLive", "addMeetingField"]) {
    const start = source.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `expected ${name} handler`);
    const body = source.slice(start, start + 500);
    assert.match(body, /if\(!controller\)return deny\(\)/, `${name} must fail closed without host control`);
  }
});

test("meeting room UI describes host restrictions accurately", () => {
  assert.match(source, /Governance controls are restricted to the active administrator, meeting initiator, chairperson or secretary/);
});
