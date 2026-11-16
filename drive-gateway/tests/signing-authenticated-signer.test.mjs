import assert from "node:assert/strict";
import test from "node:test";
import {canAuthenticatedSignerAccess} from "../src/signing.mjs";

test("external signer tokens remain usable without an authenticated user",()=>{
  assert.equal(canAuthenticatedSignerAccess({uid:null},null),true);
  assert.equal(canAuthenticatedSignerAccess({uid:undefined},undefined),true);
});

test("UID-bound signer requires the matching authenticated UID",()=>{
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},null),false);
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"other-user"}),false);
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"member-123"}),true);
});

test("UID-bound signer comparison is exact and cannot be bypassed by email alone",()=>{
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"member-123",email:"different@example.com"}),true);
  assert.equal(canAuthenticatedSignerAccess({uid:"member-123"},{uid:"member-124",email:"member@example.com"}),false);
});

import {createHash} from "node:crypto";
import {sign} from "../src/signing.mjs";

test("email-link token access requires redemption while UID-bound access remains exact",()=>{
  assert.equal(canAuthenticatedSignerAccess({identityType:"email-link",emailLinkStatus:"issued"},null),false);
  assert.equal(canAuthenticatedSignerAccess({identityType:"email-link",emailLinkStatus:"opened"},null),true);
  assert.equal(canAuthenticatedSignerAccess({identityType:"legacy-token",uid:null},null),true);
  assert.equal(canAuthenticatedSignerAccess({uid:"staging-user"},null),false);
  assert.equal(canAuthenticatedSignerAccess({uid:"staging-user"},{uid:"other-user"}),false);
  assert.equal(canAuthenticatedSignerAccess({uid:"staging-user"},{uid:"staging-user"}),true);
});
