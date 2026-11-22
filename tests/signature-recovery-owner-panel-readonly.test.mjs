import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/pages/SignatureRecoveryOwnerPanel.jsx", import.meta.url), "utf8");
const ownerView = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");

test("owner recovery panel performs only authenticated GET requests", () => {
  assert.match(source, /fetch\(gateway\+path,\{method:"GET"/);
  assert.doesNotMatch(source, /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(source, /fetch\([^\n]*method\s*:\s*(?!["']GET["'])/i);
});

test("owner recovery panel exposes only evidence and non-authoritative preview reads", () => {
  assert.match(source, /\/api\/recovery\/envelopes\//);
  assert.match(source, /\/evidence/);
  assert.match(source, /\/preview\.pdf/);
  assert.doesNotMatch(source, /\/stamps\/reassign|\/retry(?:\/|["'])|\/complete(?:\/|["'])|\/repair(?:\/|["'])|\/send-link/i);
});

test("owner recovery panel contains no signature or envelope persistence API", () => {
  for (const forbidden of [
    "setDoc(", "updateDoc(", "deleteDoc(", "addDoc(", "writeBatch(",
    "runTransaction(", "signDocument(", "reassignSigner(", "retryFinalisation(",
    "finalizeEnvelope(", "completeEnvelope("
  ]) assert.equal(source.includes(forbidden), false, "Unexpected persistence/action API: " + forbidden);
});

test("owner recovery panel renders bilingual report sections and no completion action", () => {
  assert.doesNotMatch(source, /\.status\s*=\s*["']Completed["']/);
  assert.doesNotMatch(source, /status\s*:\s*["']Completed["']/);
  assert.match(source, /No signing or completion action is available here/);
  for (const heading of ["WHAT HAPPENED / KILICHOTOKEA", "WHAT IS FINE / KILICHO SAWA", "WHAT NEEDS FIXING / KINACHOHITAJI KUREKEBISHWA", "WHAT YOU CAN DO NOW / UNACHOWEZA KUFANYA SASA"]) assert.ok(source.includes(heading));
  assert.match(source, /Copy report \/ Nakili ripoti/);
});

test("owner Envelopes view exposes Check this document only for non-completed owned envelopes", () => {
  assert.match(ownerView, /My Created Envelopes/);
  assert.match(ownerView, /e\.ownerUid===auth\.currentUser\?\.uid/);
  assert.match(ownerView, /e\.status!==\"Completed\"/);
  assert.match(ownerView, /Check this document/);
});
