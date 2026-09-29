import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
globalThis.crypto = webcrypto;
const { authenticateFirebaseRequest } = await import("../src/index.js");
function b64url(bytes) { return (typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes)).toString("base64url"); }
async function signedFirebaseToken(uid, exp) {
  const keyPair = await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const header = b64url(JSON.stringify({alg:"RS256",kid:"local-test-key",typ:"JWT"}));
  const payload = b64url(JSON.stringify({sub:uid,user_id:uid,email:uid+"@example.test",aud:"demo-irpa-staging",iss:"https://securetoken.google.com/demo-irpa-staging",exp}));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5",keyPair.privateKey,new TextEncoder().encode(header+"."+payload));
  globalThis.__IRPA_LOCAL_TEST_JWKS = {"local-test-key":jwk};
  return header+"."+payload+"."+b64url(signature);
}
async function probe(authorization, localMode=false) {
  globalThis.__IRPA_LOCAL_TEST_MODE = localMode;
  const headers = authorization === undefined ? {} : {Authorization:authorization};
  try {
    return {ok:true,claims:await authenticateFirebaseRequest(new Request("http://test.local",{headers}))};
  } catch (error) {
    return {ok:false,error:error.message};
  }
}
globalThis.__IRPA_LOCAL_TEST_MODE = false;
response = await probe("Bearer test:different-user:different@example.test",false);
assert.equal(response.ok,false);
assert.match(response.error,/Invalid Firebase ID token/);
console.log(JSON.stringify({test:"test-auth-rejected-when-disabled",status:401,pass:true}));
;