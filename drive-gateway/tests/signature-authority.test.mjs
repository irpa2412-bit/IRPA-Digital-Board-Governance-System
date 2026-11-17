import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const signing=read("../src/signing.mjs");
const emailLinks=read("../src/emailSigningLinks.mjs");
const router=read("../src/router.mjs");
const gateway=read("../src/index.js");

test("email-link signing does not import or call the signature authority matrix",()=>{
  assert.doesNotMatch(signing,/signatureAuthority|verify.*Authority|authorityRole/);
  assert.doesNotMatch(emailLinks,/signatureAuthority|resolveEmailSignerAuthority|authorityRole/);
  assert.doesNotMatch(gateway,/verifyGatewaySigningAuthority|verifyGatewayEmailSignerAuthority|verifySigningAuthority/);
  assert.doesNotMatch(router,/signing-authority\/verify|authority\/verify/);
});

test("email possession and a declared name are the signer identity contract",()=>{
  assert.match(signing,/identityType:"email-link"/);
  assert.match(signing,/emailLinkStatus/);
  assert.match(signing,/if\(!declared\.name\)throw new HttpError\(400/);
  assert.doesNotMatch(signing,/declared\.occupation|declared\.capacity/);
});

test("email-link confirmation is required before opening the signing session",()=>{
  assert.match(signing,/requestEmailSigningCode/);
  assert.match(signing,/confirmEmailSigningCode/);
  assert.match(router,/\/api\/sign\/email\/confirm/);
  assert.match(signing,/Not your turn yet/);
});
