import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
globalThis.crypto = webcrypto;
const { default: worker } = await import("../src/index.js");
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
async function probe(authorization) {
  const headers = authorization === undefined ? {} : {Authorization:authorization};
  return worker.fetch(new Request("http://test.local/api/download",{method:"POST",headers,body:JSON.stringify({documentId:"D",fileId:"F"})}),{LOCAL_TEST_MODE:"false",ENVIRONMENT:"staging",FIRESTORE_COLLECTION_PREFIX:"staging_",FIREBASE_PROJECT_ID:"demo-irpa-staging",DRIVE_MOCK:"true",DRIVE_KV:{get:async()=>null,put:async()=>{},list:async()=>({keys:[]})}});
}
let response = await probe(); assert.equal(response.status,401); console.log(JSON.stringify({test:"missing-token",status:response.status,pass:true}));
response = await probe("Bearer not-a-jwt"); assert.equal(response.status,401); console.log(JSON.stringify({test:"malformed-token",status:response.status,pass:true}));
const expired = await signedFirebaseToken("expired-user",Math.floor(Date.now()/1000)-60); response = await probe("Bearer "+expired); assert.equal(response.status,401); console.log(JSON.stringify({test:"expired-token",status:response.status,pass:true}));
const validDifferentUser = await signedFirebaseToken("different-user",Math.floor(Date.now()/1000)+3600);
globalThis.__IRPA_LOCAL_TEST_MODE = true;
response = await worker.fetch(new Request("http://test.local/api/download",{method:"POST",headers:{Authorization:"Bearer "+validDifferentUser},body:JSON.stringify({documentId:"D",fileId:"F"})}),{LOCAL_TEST_MODE:"true",ENVIRONMENT:"staging",FIRESTORE_COLLECTION_PREFIX:"staging_",FIREBASE_PROJECT_ID:"demo-irpa-staging",DRIVE_MOCK:"true",DRIVE_KV:{get:async()=>null,put:async()=>{},list:async()=>({keys:[]})}});
assert.equal(response.status,403); console.log(JSON.stringify({test:"valid-token-different-user",status:response.status,pass:true}));
globalThis.__IRPA_LOCAL_TEST_MODE = false;
response = await worker.fetch(new Request("http://test.local/api/download",{method:"POST",headers:{Authorization:"Bearer test:different-user:different@example.test"},body:JSON.stringify({documentId:"D",fileId:"F"})}),{LOCAL_TEST_MODE:"false",ENVIRONMENT:"production",FIRESTORE_COLLECTION_PREFIX:"",FIREBASE_PROJECT_ID:"irpa-digital-board-governance",DRIVE_MOCK:"true",DRIVE_KV:{get:async()=>null,put:async()=>{},list:async()=>({keys:[]})}});
assert.equal(response.status,401); console.log(JSON.stringify({test:"test-auth-rejected-when-disabled",status:response.status,pass:true}));
delete globalThis.__IRPA_LOCAL_TEST_JWKS;
console.log("AUTH TEST RESULT: PASS");