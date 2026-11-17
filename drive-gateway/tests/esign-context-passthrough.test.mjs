import test from "node:test";
import assert from "node:assert/strict";
import { buildEsignContext } from "../src/esignContext.mjs";

test("buildEsignContext passes email verification, invitation, notice and completion services",()=>{
  const ctx=buildEsignContext({
    env:{DRIVE_MOCK:"true"},
    verifyUser(){},
    sendInvitation(){},
    sendEmailVerificationCode(){},
    sendWorkflowNotice(){},
    persistCompletedSignatureEnvelope(){}
  });
  assert.equal(typeof ctx.verifyUser,"function");
  assert.equal(typeof ctx.sendInvitation,"function");
  assert.equal(typeof ctx.sendEmailVerificationCode,"function");
  assert.equal(typeof ctx.sendWorkflowNotice,"function");
  assert.equal(typeof ctx.persistCompletedSignatureEnvelope,"function");
  assert.equal(ctx.verifySigningAuthority,undefined);
});
