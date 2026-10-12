import assert from "node:assert/strict";
import test from "node:test";
import { PORTAL_ROLLER_GROUPS } from "../src/config/portalRegistry.js";

test("portal registry has unique parent portals and sub-portal entries", () => {
  const parents = PORTAL_ROLLER_GROUPS.map(([parent]) => parent);
  const children = PORTAL_ROLLER_GROUPS.flatMap(([, items]) => items);

  assert.equal(new Set(parents).size, parents.length, "parent portal names must be unique");
  assert.equal(new Set(children).size, children.length, "sub-portal names must be unique");
  assert.equal(children.some(child => parents.includes(child)), false, "parent portals must not also be sub-portals");
  assert.deepEqual(parents, ["Meetings", "Documents", "Induction and Orientation"]);
});

test("portal registry children remain attached to their approved parent", () => {
  const byParent = Object.fromEntries(PORTAL_ROLLER_GROUPS);
  assert.deepEqual(byParent.Meetings, ["Meeting Room", "Participants", "Resolutions", "Voting", "Actions", "Decisions"]);
  assert.ok(byParent.Documents.includes("Upload Document"));
  assert.ok(byParent.Documents.includes("Retrieve Archived Documents"));
  assert.deepEqual(byParent["Induction and Orientation"], ["Induction Applications"]);
});
