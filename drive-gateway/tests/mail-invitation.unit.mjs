import assert from "node:assert/strict";
import { normalizeRecipientEmail, validateMailHeader, escapeHtml, sendWithRetry, isAuthorizedInviteCaller } from "../src/mailDelivery.js";
const sleep = async () => {};
async function testSuccess() {
  let calls = 0;
  const result = await sendWithRetry(async () => { calls += 1; return "250 OK"; }, { onFailure: sleep });
  assert.equal(result, "250 OK"); assert.equal(calls, 1); console.log("PASS success");
}
async function testRetrySuccess() {
  let calls = 0;
  const result = await sendWithRetry(async () => { calls += 1; if (calls === 1) throw new Error("provider temporary failure"); return "250 OK"; }, { backoffMs: [0, 0], onFailure: sleep });
  assert.equal(result, "250 OK"); assert.equal(calls, 2); console.log("PASS provider failure then retry success");
}
async function testFinalFailure() {
  let calls = 0; const failures = [];
  await assert.rejects(() => sendWithRetry(async () => { calls += 1; throw new Error("provider final failure"); }, { backoffMs: [0, 0], onFailure: async (error, attempt) => failures.push({error, attempt}) }));
  assert.equal(calls, 3); assert.deepEqual(failures.map(x => x.attempt), [1, 2, 3]); console.log("PASS final failure after 3 attempts");
}
async function testValidation() {
  assert.equal(normalizeRecipientEmail(" Test@Example.COM "), "test@example.com");
  assert.throws(() => normalizeRecipientEmail("bad"), /valid recipient/);
  assert.throws(() => normalizeRecipientEmail("a\nb@example.com"), /valid recipient/);
  assert.throws(() => validateMailHeader("x\r\ny", "Subject"), /newline/);
  assert.equal(escapeHtml('<b>"x"&'), "&lt;b&gt;&quot;x&quot;&amp;");
  console.log("PASS invalid recipient and header injection rejection");
}
async function testAuthorization() {
  assert.equal(isAuthorizedInviteCaller({user_id:"u1"}, {senderUid:"u1"}), true);
  assert.equal(isAuthorizedInviteCaller({user_id:"u2"}, {senderUid:"u1"}), false);
  console.log("PASS unauthorized caller denied");
}
await testSuccess(); await testRetrySuccess(); await testFinalFailure(); await testValidation(); await testAuthorization();
console.log("ALL MAIL INVITATION TESTS PASSED");
