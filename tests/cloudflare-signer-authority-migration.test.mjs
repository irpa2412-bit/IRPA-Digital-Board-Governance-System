import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("signer authority changes use the Cloudflare API without a callable or client write fallback", async () => {
  const client = await readFile(new URL("../src/firebase/signerIdentity.js", import.meta.url), "utf8");
  const start = client.indexOf("export async function updateMySignerAuthority(data={})");
  const end = client.indexOf("\nexport async function recordSignerAuthenticationEvidence", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const fn = client.slice(start, end);
  assert.match(fn, /\/api\/signature\/authority/);
  assert.match(fn, /getIdToken\(\)/);
  assert.doesNotMatch(fn, /httpsCallable|getFunctions|updateDoc|setDoc/);
  assert.match(fn, /No Firebase callable or client-side authority-write fallback was used/);
});

test("Cloudflare signer authority endpoint verifies registered authority and atomically writes audit evidence", async () => {
  const worker = await readFile(new URL("../drive-gateway/src/index.js", import.meta.url), "utf8");
  assert.match(worker, /pathname === "\/api\/signature\/authority"/);
  assert.match(worker, /authenticateFirebaseRequest\(request, env\)/);
  assert.match(worker, /The selected signing authority is not registered/);
  assert.match(worker, /commitFirestoreDocumentAndAudit\(env,"signerIdentities\/"\+uid/);
  assert.match(worker, /"UPDATE_SIGNER_AUTHORITY"/);
});
