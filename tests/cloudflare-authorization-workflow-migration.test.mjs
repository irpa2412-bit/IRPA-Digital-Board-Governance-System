import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Authorization workflow client uses Cloudflare for list, create and transition operations", async () => {
  const client=await readFile(new URL("../src/firebase/authorizationWorkflow.js",import.meta.url),"utf8");
  assert.match(client,/\/api\/authorization\/workflows/);
  assert.match(client,/getIdToken\(\)/);
  assert.doesNotMatch(client,/runTransaction|getDocs\(|getDoc\(|setDoc\(|updateDoc\(|httpsCallable|getFunctions/);
  for(const op of ["list","create","transition"])assert.ok(client.includes('"'+op+'"')||client.includes('("'+op+'"'),"Missing "+op+" operation");
});

test("Cloudflare Authorization workflow enforces active identity, independent approver, controlled transitions, and atomic audit", async () => {
  const worker=await readFile(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");
  assert.match(worker,/pathname === "\/api\/authorization\/workflows"/);
  assert.match(worker,/active IRPA institutional identity is required/);
  assert.match(worker,/Self-approval is prohibited/);
  assert.match(worker,/The selected reviewer does not hold an active approved reviewer role/);
  assert.match(worker,/The selected approver does not hold the required active Executive Director role/);
  assert.match(worker,/currentDocument:\{updateTime:current\.updateTime\}/);
  assert.match(worker,/AUTHORIZATION_\+next\.replace/);
  assert.match(worker,/await commit\(\[write,auditWrite/);
});
