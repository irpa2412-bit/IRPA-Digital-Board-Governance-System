import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const activation = source.slice(
  source.indexOf("async function assertActivatedPortalUser"),
  source.indexOf("async function queryFirestoreByEmail")
);
const auth = source.slice(
  source.indexOf("async function authenticateFirebaseRequest"),
  source.indexOf("async function assertActivatedPortalUser")
);

test("portal activation passes the privileged Firestore token to institutional lookup", () => {
  assert.match(activation, /getInstitutionalProfileForUser\(env, claims, adminToken\)/);
});

test("an active personal signature profile is an accepted activation record", () => {
  assert.match(activation, /signatureProfiles\/\$\{claims\.user_id\}/);
  assert.match(activation, /getFirestoreDocumentsByEmail\(env, "signatureProfiles", claims\.email, adminToken\)/);
  assert.match(activation, /activeStatus\(personal\.fields\?\.status\?\.stringValue\)/);
});

test("activation failures have distinct stable codes and request IDs", () => {
  assert.match(activation, /code = "NOT_ACTIVATED"/);
  assert.match(activation, /code = "PROFILE_LOOKUP_FAILED"/);
  assert.match(activation, /requestId = requestId/g);
});

test("Firebase token cryptographic verification policy remains unchanged", () => {
  assert.match(auth, /jwtVerify\(match\[1\], keySet/);
  assert.match(auth, /issuer: `https:\/\/securetoken\.google\.com\/\$\{getFirebaseProjectId\(env\)\}`/);
  assert.match(auth, /audience: getFirebaseProjectId\(env\)/);
  assert.match(auth, /algorithms: \["RS256"\]/);
  assert.match(auth, /requiredClaims: \["exp", "sub", "aud", "iss"\]/);
});

test("signing-link router wiring remains present and separate from activation repair", () => {
  assert.match(source, /import \{ route as esignRoute \} from "\.\/router\.mjs"/);
  assert.match(source, /if \(isEsignPath\(pathname\)\)/);
  assert.match(source, /openGatewayEmailSigning/);
  assert.match(source, /getGatewaySigningPdf/);
});
