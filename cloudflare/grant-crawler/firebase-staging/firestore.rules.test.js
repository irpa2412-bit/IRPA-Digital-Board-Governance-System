import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

const projectId = "demo-irpa-grant-crawler-staging-test";
const rules = await readFile(new URL("./firestore.rules", import.meta.url), "utf8");
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
});
after(async () => { await testEnv?.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

function crawlerDb() {
  return testEnv.authenticatedContext("staging-crawler-uid", {
    email: "irpa-grant-crawler@irpa.or.tz",
    email_verified: true
  }).firestore();
}
function payload() {
  return {
    title: "Pastoral resilience grant",
    description: "Support community-led rangeland restoration.",
    url: "https://donor.example/calls/pastoral-resilience",
    sourceUrl: "https://donor.example/feed.xml",
    publishedAt: "2026-10-10T00:00:00Z",
    firstSeenAt: new Date(),
    lastSeenAt: new Date()
  };
}

test("verified crawler identity can create and update only valid grant opportunities", async () => {
  const db = crawlerDb();
  const ref = doc(db, "grantOpportunities", "opportunity-1");
  await assertSucceeds(setDoc(ref, payload()));
  await assertSucceeds(updateDoc(ref, { title: "Updated pastoral resilience grant", lastSeenAt: new Date() }));
  const snapshot = await assertSucceeds(getDoc(ref));
  assert.equal(snapshot.data().title, "Updated pastoral resilience grant");
});

test("crawler cannot read or write governance and finance collections", async () => {
  const db = crawlerDb();
  await assertFails(setDoc(doc(db, "financeGrants", "blocked"), { amount: 100 }));
  await assertFails(setDoc(doc(db, "financeTransactions", "blocked"), { amount: 100 }));
  await assertFails(setDoc(doc(db, "members", "blocked"), { status: "Active" }));
  await assertFails(setDoc(doc(db, "meetings", "blocked"), { title: "blocked" }));
  await assertFails(setDoc(doc(db, "documents", "blocked"), { title: "blocked" }));
  await assertFails(setDoc(doc(db, "adminProfiles", "blocked"), { active: true }));
  await assertFails(getDoc(doc(db, "financeGrants", "blocked")));
});

test("unverified and unrelated identities are denied", async () => {
  const unverified = testEnv.authenticatedContext("unverified", {
    email: "irpa-grant-crawler@irpa.or.tz",
    email_verified: false
  }).firestore();
  const unrelated = testEnv.authenticatedContext("unrelated", {
    email: "person@example.org",
    email_verified: true
  }).firestore();
  await assertFails(setDoc(doc(unverified, "grantOpportunities", "x"), payload()));
  await assertFails(setDoc(doc(unrelated, "grantOpportunities", "x"), payload()));
});

test("invalid URLs, unknown fields, deletes, and run mutation are denied", async () => {
  const db = crawlerDb();
  const invalid = { ...payload(), url: "http://not-https.example/call", admin: true };
  await assertFails(setDoc(doc(db, "grantOpportunities", "invalid"), invalid));
  await assertFails(setDoc(doc(db, "grantCrawlerRuns", "bad"), {
    status: "success", itemsSeen: 1, itemsChanged: 1, finishedAt: new Date(), extra: "no"
  }));
  const ref = doc(db, "grantOpportunities", "valid");
  await assertSucceeds(setDoc(ref, payload()));
  await assertFails(deleteDoc(ref));
  const runRef = doc(db, "grantCrawlerRuns", "run-1");
  await assertSucceeds(setDoc(runRef, {
    status: "success", itemsSeen: 1, itemsChanged: 1, finishedAt: new Date()
  }));
  await assertFails(updateDoc(runRef, { status: "failed" }));
});
