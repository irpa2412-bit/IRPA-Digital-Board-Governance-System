import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy } from "../scripts/portal-protection-check.mjs";
import registry from "../docs/portal-protection/portal-register.json" with { type: "json" };

const portal = "Signature Portal";
const now = Date.parse("2026-11-19T20:00:00Z");
const file = "src/pages/SignaturePlatform.jsx";
const valid = {
  status: "complete",
  declaration: { affectedPortals: [portal], reason: "Repair", files: [file], expectedEffect: "Fix scoped defect", prohibitedChanges: ["No signing rule changes"] },
  baseline: { commit: "b766e772", rollbackCommit: "b766e772" },
  validation: { baselineSmoke: "PASS", fullRegression: "PASS", portalSmoke: { [portal]: "PASS" }, behaviourDifferences: [] }
};
const windowState = { status: "open", openedAt: "2026-11-19T18:00:00Z", scope: [file] };
const run = (changedFiles, record = valid, win = windowState, activity = "2026-11-19T19:59:00Z") =>
  evaluatePolicy({ changedFiles, registry, record, windowState: win, latestActivityAt: activity, now });

test("protected change without Change Record fails", () => assert.equal(run([file], null).ok, false));
test("valid record and active scoped window pass", () => assert.equal(run([file]).ok, true));
test("24-hour inactivity closes the window", () => assert.equal(run([file], valid, windowState, "2026-11-18T19:59:00Z").ok, false));
test("out-of-scope protected change fails", () => assert.equal(run([file], valid, { ...windowState, scope: ["src/pages/Invitations.jsx"] }).ok, false));
test("shared dependency fans out to every dependent portal", () => {
  const result = run(["src/App.jsx"], { ...valid, declaration: { ...valid.declaration, affectedPortals: Object.keys(registry.portals), files: ["src/App.jsx"] }, validation: { ...valid.validation, portalSmoke: Object.fromEntries(Object.keys(registry.portals).map(p => [p, "PASS"])) } }, { ...windowState, scope: ["src/App.jsx"] });
  assert.equal(result.affected.length, 6);
  assert.equal(result.ok, true);
});
test("unrelated change passes without a repair window", () => assert.equal(run(["README.md"], null, null).ok, true));
