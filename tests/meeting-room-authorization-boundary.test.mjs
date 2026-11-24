import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/MeetingRoom.jsx", import.meta.url), "utf8");

test("participant invitation context grants media entry but not host governance control", () => {
  assert.match(source, /hostController=roleControl\(member,selected\)/);
  assert.match(source, /controller=Boolean\\(activeChair\\|\\|activeSecretary\\)/);
  assert.match(source, /activeAdministrator=transitionActive\\?canTransitionAdministrator:canMeetingAdministrator/);
  assert.doesNotMatch(source, /hostController=!!admin\?\.active/);
  assert.doesNotMatch(source, /controller=!!admin\?\.active\|\|roleControl\(member,selected\)\|\|Boolean\(entryContext\?\.participantId/);
  assert.match(source, /controller=\{Boolean\(hostController\|\|\(auth\.currentUser&&entryContext\?\.participantId&&entryContext\?\.meetingId===selected\?\.id\)\)\}/);
});

test("host governance mutations retain the explicit controller guard", () => {
  for (const name of ["openLive", "pauseLive", "closeLive"]) {
    const start = source.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `expected ${name} handler`);
    const body = source.slice(start, start + 500);
    assert.match(body, /if\(!canChair\)/, `${name} must be restricted to the permanent meeting Chairperson`);
  }
  const fieldStart = source.indexOf("async function addMeetingField(");
  assert.notEqual(fieldStart, -1, "expected addMeetingField handler");
  assert.match(source.slice(fieldStart, fieldStart + 500), /if\(!controller\)return deny\(\)/, "governance field changes must require the active chair or secretary");
});

test("meeting room UI describes host restrictions accurately", () => {
  assert.match(source, /Meeting controls derive from the three appointments recorded for this meeting/);
  assert.match(source, /Only its Chairperson may commence, pause or close formal proceedings/);
});
