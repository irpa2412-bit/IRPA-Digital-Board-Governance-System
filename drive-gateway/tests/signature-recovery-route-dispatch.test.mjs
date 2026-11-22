import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isEsignPath, matchRecoveryEvidenceRoute } from "../src/esignPathPolicy.mjs";

const ids = [
  "test-id",
  "ENV-0000000000000000",
  "IRPA-ENV-2026-00000000",
  "IRPA-ENV-2026-11501354"
];

test("evidence router accepts envelope IDs, document IDs and document references", () => {
  for (const id of ids) {
    const path = "/api/recovery/envelopes/" + encodeURIComponent(id) + "/evidence";
    assert.equal(matchRecoveryEvidenceRoute("GET", path)?.[1], id, id);
    assert.equal(isEsignPath(path), true, "top-level Worker must dispatch " + path);
  }
});

test("screen-generated evidence URL uses the queue envelopeId and matches the router", async () => {
  const panel = await readFile(new URL("../../src/pages/SignatureRecoveryOwnerPanel.jsx", import.meta.url), "utf8");
  const queue = await readFile(new URL("../../src/pages/SignatureRecoveryOwnerEnvelopes.jsx", import.meta.url), "utf8");
  assert.match(panel, /encodeURIComponent\(envelopeId\)/);
  assert.match(panel, /diagnose-finalisation/);
  assert.match(panel, /\/preview\.pdf/);
  assert.match(queue, /\/api\/recovery\/envelopes\?limit=50&offset=/);
  const item = { envelopeId: "ENV-0000000000000000", documentId: "IRPA-ENV-2026-00000000", title: "synthetic test" };
  const path = "/api/recovery/envelopes/" + encodeURIComponent(item.envelopeId) + "/evidence";
  assert.equal(matchRecoveryEvidenceRoute("GET", path)?.[1], item.envelopeId);
  assert.notEqual(item.title, item.envelopeId);
});

test("recovery evidence remains GET-only and finalisation diagnostics use a separate POST route", () => {
  assert.equal(matchRecoveryEvidenceRoute("POST", "/api/recovery/envelopes/ENV-0000000000000000/evidence"), null);
  assert.equal(isEsignPath("/api/envelopes/ENV-0000000000000000/diagnose-finalisation"), true);
  assert.equal(matchRecoveryEvidenceRoute("GET", "/api/recovery/envelopes/x/evidence"), null);
  assert.equal(matchRecoveryEvidenceRoute("GET", "/api/recovery/envelopes/ENV-0000000000000000/evidence/extra"), null);
  assert.equal(isEsignPath("/api/recovery/envelopes"), true);
  assert.equal(isEsignPath("/api/recovery/envelopes/ENV-0000000000000000/evidence"), true);
  assert.equal(isEsignPath("/__not_a_recovery_route__"), false);
});

test("recovery dispatch repair changes only its seven approved files relative to updated main", async () => {
  const { execFileSync } = await import("node:child_process");
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim() === "true";
  if (shallow) execFileSync("git", ["fetch", "--no-tags", "--unshallow", "origin", "main"]);
  else execFileSync("git", ["fetch", "--no-tags", "origin", "main"]);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const main = execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim();
  const subject = execFileSync("git", ["show", "-s", "--format=%s", "HEAD"], { encoding: "utf8" }).trim();
  const refName = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "";
  const isRecoveryRepairPr = refName === "fix/signature-recovery-route-dispatch-20261122";
  const isMergedRecoveryRepair = head === main && /^Merge pull request #905\b/.test(subject);
  // Enforce the seven-file boundary on #905's PR head and first main merge only.
  // Later unrelated PRs and main pushes must not re-compare this historical file list.
  if (!isRecoveryRepairPr && !isMergedRecoveryRepair) return;
  const baseRef = isMergedRecoveryRepair ? "HEAD^1" : "origin/main";
  const changed = execFileSync("git", [
    "diff", "--name-only", baseRef + "...HEAD"
  ], { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort();
  assert.deepEqual(changed, [
    "docs/signature-recovery/route-dispatch-change-record-2026-11-22.md",
    "drive-gateway/src/esignPathPolicy.mjs",
    "drive-gateway/src/index.js",
    "drive-gateway/src/router.mjs",
    "drive-gateway/src/signatureRecovery.mjs",
    "drive-gateway/tests/signature-recovery-route-dispatch.test.mjs",
    "tests/signature-workflow-policy.test.mjs"
  ].sort(), "the repair must not touch signing, envelope, Firestore, secrets, deployment settings, or branch-protection files");
});

test("isolated recovery router uses the shared bounded GET evidence matcher", async () => {
  const recovery = await readFile(new URL("../src/signatureRecovery.mjs", import.meta.url), "utf8");
  assert.match(recovery, /import \{ matchRecoveryEvidenceRoute \} from "\.\/esignPathPolicy\.mjs"/);
  assert.match(recovery, /matchRecoveryEvidenceRoute\(request\.method,pathname\)/);
  assert.match(recovery, /assessRecoveryEvidence\(ctx,user,decodeURIComponent\(evidence\[1\]\)\)/);
});
