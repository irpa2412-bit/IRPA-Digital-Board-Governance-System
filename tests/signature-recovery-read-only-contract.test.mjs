import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const panelPath = new URL("../src/pages/SignatureRecoveryOwnerPanel.jsx", import.meta.url);
const wrapperPath = new URL("../src/pages/SignaturePlatformWithUpload.jsx", import.meta.url);
const panel = fs.readFileSync(panelPath, "utf8");
const wrapper = fs.readFileSync(wrapperPath, "utf8");

test("owner recovery assessment uses GET only and exposes no mutation endpoint", () => {
  assert.match(panel, /fetch\(gateway\+path,\{method:"GET"/);
  assert.equal((panel.match(/\bfetch\s*\(/g) || []).length, 1, "all network access must pass through the single GET-only request helper");
  assert.doesNotMatch(panel, /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(panel, /\/stamps\/reassign|\/retry(?:\/|["'])|\/finali[sz]e|\/complete(?:\/|["'])/i);
});

test("owner recovery assessment cannot write or recreate signature evidence", () => {
  assert.doesNotMatch(panel, /\b(?:setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction|deleteObject|uploadBytes|uploadString)\s*\(/);
  assert.doesNotMatch(panel, /(?:signature|signer|stamp|envelope|archive|certificate|sourceHash)\s*\.\s*(?:set|update|delete|save|create)\s*\(/i);
  assert.doesNotMatch(panel, /(?:reassign|retry|finali[sz]e|forceComplete|markCompleted)\s*\(/i);
  assert.doesNotMatch(panel, /(?:POST|PUT|PATCH|DELETE)\s*[,}]/);
});

test("owner recovery assessment is mounted only in the non-signer view", () => {
  assert.match(wrapper, /import SignatureRecoveryOwnerPanel from["']\.\/SignatureRecoveryOwnerPanel["']/);
  assert.match(wrapper, /!signerOnly&&<SignatureRecoveryOwnerPanel\/>/);
});
