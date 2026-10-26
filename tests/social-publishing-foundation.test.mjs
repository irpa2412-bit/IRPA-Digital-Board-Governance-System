import test from "node:test";
import assert from "node:assert/strict";
import { formatSocialContent, getSocialPublishingSelfTest, SOCIAL_PLATFORM_CONFIG } from "../drive-gateway/src/socialPublishing.mjs";

test("all requested platforms fail closed to manual export until adapters are verified", () => {
  const results = getSocialPublishingSelfTest({});
  assert.equal(results.length, 6);
  assert.ok(results.every(result => result.status === "FAIL"));
  assert.ok(results.every(result => /No automatic publishing adapter/.test(result.reason)));
});

test("platform-specific character limits are enforced", () => {
  assert.equal(formatSocialContent("x", { text: "a".repeat(280) }).length, 280);
  assert.throws(() => formatSocialContent("x", { text: "a".repeat(281) }), /280-character limit/);
  assert.throws(() => formatSocialContent("instagram", { text: "a".repeat(2201) }), /2200-character limit/);
});

test("manual export formats clean text and permitted hashtags without claiming publication", () => {
  const value = formatSocialContent("facebook", { text: "IRPA update", url: "https://irpa.or.tz", hashtags: ["#IRPA", "bad tag", "#PastoralCommunities"] });
  assert.equal(value, "IRPA update\n\n#IRPA #PastoralCommunities\n\nhttps://irpa.or.tz");
});

test("required secret names are explicit but values are never returned", () => {
  const facebook = getSocialPublishingSelfTest({ META_APP_ID: "configured" }).find(item => item.name === "Facebook Pages adapter");
  assert.ok(facebook.missingSecrets.includes("META_APP_SECRET"));
  assert.ok(!JSON.stringify(facebook).includes("configured"));
  assert.deepEqual(SOCIAL_PLATFORM_CONFIG.x.required, ["X_CLIENT_ID", "X_CLIENT_SECRET"]);
});
