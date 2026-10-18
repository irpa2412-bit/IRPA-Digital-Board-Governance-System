import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("application login-context client no longer calls Firebase Cloud Functions", async () => {
  const data=await readFile(new URL("../src/firebase/data.js",import.meta.url),"utf8");
  const start=data.indexOf("export async function resolveAuthenticatedLoginContext()");
  const end=data.indexOf("\n",start);
  assert.notEqual(start,-1);
  const fn=data.slice(start,end<0?data.length:end);
  assert.match(fn,/\/api\/session\/login-context/);
  assert.match(fn,/No Firebase callable fallback was used/);
  assert.doesNotMatch(fn,/httpsCallable|getFunctions/);
});

test("Cloudflare login-context resolver preserves authenticated identity, roles, authorities and fallback matching", async () => {
  const worker=await readFile(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");
  assert.match(worker,/url\.pathname === "\/api\/session\/login-context"/);
  assert.match(worker,/authenticateFirebaseRequest\(request,env,\{skipActivation:true\}\)/);
  assert.match(worker,/configuredRoles/);
  assert.match(worker,/administrator:admin\?\.active===true/);
  assert.match(worker,/identityResolution:/);
  assert.match(worker,/firebaseAuthEmail/);
});
