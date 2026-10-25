import test from "node:test";
import assert from "node:assert/strict";
import { buildEsignContext } from "../src/esignContext.mjs";

test("buildEsignContext preserves injected function properties", () => {
  const ctx = buildEsignContext({
    env: { DRIVE_MOCK: "true" },
    verifyUser() {},
    verifySigningAuthority() {},
    persistCompletedSignatureEnvelope() {},
    sendInvitation() {},
  });

  assert.equal(typeof ctx.verifyUser, "function");
  assert.equal(typeof ctx.verifySigningAuthority, "function");
  assert.equal(typeof ctx.persistCompletedSignatureEnvelope, "function");
  assert.equal(typeof ctx.sendInvitation, "function");
});
