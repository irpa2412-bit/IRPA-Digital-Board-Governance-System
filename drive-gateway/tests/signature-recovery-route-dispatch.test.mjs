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
  assert.match(panel, /recoveryRequest\("\/api\/recovery\/envelopes\/"\+encodeURIComponent\(item\.envelopeId\)\+"\/evidence"\)/);
  assert.match(panel, /recoveryRequest\("\/api\/recovery\/envelopes\?limit=50&offset=/);
  const item = { envelopeId: "ENV-0000000000000000", documentId: "IRPA-ENV-2026-00000000", title: "synthetic test" };
  const path = "/api/recovery/envelopes/" + encodeURIComponent(item.envelopeId) + "/evidence";
  assert.equal(matchRecoveryEvidenceRoute("GET", path)?.[1], item.envelopeId);
  assert.notEqual(item.title, item.envelopeId);
});

test("recovery evidence route is GET-only and invalid paths are not dispatched", () => {
  assert.equal(matchRecoveryEvidenceRoute("POST", "/api/recovery/envelopes/ENV-0000000000000000/evidence"), null);
  assert.equal(matchRecoveryEvidenceRoute("GET", "/api/recovery/envelopes/x/evidence"), null);
  assert.equal(matchRecoveryEvidenceRoute("GET", "/api/recovery/envelopes/ENV-0000000000000000/evidence/extra"), null);
  assert.equal(isEsignPath("/api/recovery/envelopes"), true);
  assert.equal(isEsignPath("/api/recovery/envelopes/ENV-0000000000000000/evidence"), true);
  assert.equal(isEsignPath("/__not_a_recovery_route__"), false);
});
