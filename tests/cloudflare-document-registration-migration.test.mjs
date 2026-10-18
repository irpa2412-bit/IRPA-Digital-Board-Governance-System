import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Controlled Document Upload registers metadata through Cloudflare and has no direct Firestore write fallback", async () => {
  const [component,data]=await Promise.all([
    readFile(new URL("../src/components/ControlledDocumentUpload.jsx",import.meta.url),"utf8"),
    readFile(new URL("../src/firebase/data.js",import.meta.url),"utf8")
  ]);
  assert.match(component,/registerControlledDocument\(/);
  assert.doesNotMatch(component,/createRecord\(COLLECTIONS\.documents/);
  const start=data.indexOf("export async function registerControlledDocument(");
  const end=data.indexOf("\n}",start)+2;
  assert.notEqual(start,-1);assert.ok(end>start);
  const fn=data.slice(start,end);
  assert.match(fn,/\/api\/document-lifecycle\/register/);
  assert.match(fn,/No direct Firestore registration fallback was used/);
});

test("Cloudflare controlled-document registration verifies access policy and Drive archive provenance before atomic record/audit creation", async () => {
  const [router,index]=await Promise.all([
    readFile(new URL("../drive-gateway/src/documentLifecycle.mjs",import.meta.url),"utf8"),
    readFile(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8")
  ]);
  assert.match(router,/pathname==="\/api\/document-lifecycle\/register"/);
  assert.match(router,/canUpload\(identity/);
  assert.match(router,/description\.irpaGovernance!==true/);
  assert.match(router,/description\.uploadedByUid!==identity\.uid/);
  assert.match(router,/commitDocumentAndAudit\(deps,env,claims,id,record,"REGISTERED"/);
  assert.match(index,/getFirestoreAdminAccessToken: env => getFirestoreAdminAccessToken\(env\)/);
});
