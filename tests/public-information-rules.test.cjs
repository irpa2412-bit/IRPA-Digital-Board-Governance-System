const assert = require("node:assert/strict");
const { before, after, beforeEach, test } = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { Timestamp } = require("firebase/firestore");
const fs = require("node:fs");

let testEnv;
const projectId = process.env.GCLOUD_PROJECT || "irpa-digital-board-governance";
before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") }
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("adminProfiles/admin-user").set({ active: true, email: "admin@example.test" });
    await db.doc("members/member-user").set({ uid: "member-user", status: "Active", role: "Board Member" });
    await db.doc("publicStats/memberCounters").set({
      activeMembers: 12, boardMembers: 7, updatedAt: Timestamp.fromDate(new Date("2026-10-10T00:00:00Z"))
    });
    await db.doc("publicReports/report-public").set({
      title: "Public Rangeland Report", summary: "Approved public summary", category: "Rangeland",
      reportDate: "2026-10-10", publicUrl: "https://example.org/report.pdf", documentUrl: "", url: "",
      published: true, visibility: "PUBLIC", publishedAt: Timestamp.fromDate(new Date("2026-10-10T00:00:00Z"))
    });
    await db.doc("publicReports/report-draft").set({
      title: "Draft Report", summary: "Internal draft", published: false, visibility: "PUBLIC",
      publishedAt: Timestamp.fromDate(new Date("2026-10-10T00:00:00Z"))
    });
    await db.doc("publicMeetings/event-public").set({
      title: "Public Pastoral Event", description: "Approved public event", date: "2026-11-10",
      startTime: "09:00", endTime: "12:00", venue: "Longido", publicUrl: "",
      published: true, visibility: "PUBLIC", publishedAt: Timestamp.fromDate(new Date("2026-10-10T00:00:00Z"))
    });
    await db.doc("meetings/board-private").set({
      title: "Restricted Board Meeting", meetingCategory: "GOVERNANCE", status: "Scheduled",
      platformPasscode: "private-passcode", transcript: "confidential"
    });
    await db.doc("reports/internal-report").set({ title: "Internal report", classification: "INTERNAL" });
  });
});

test("anonymous visitors can read only the aggregate public member counter", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  const snapshot = await assertSucceeds(db.doc("publicStats/memberCounters").get());
  assert.equal(snapshot.data().activeMembers, 12);
  assert.equal(snapshot.data().boardMembers, 7);
  await assertFails(db.collection("publicStats").get());
  await assertFails(db.doc("members/member-user").get());
});

test("anonymous visitors can list explicitly published public reports only", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  const { collection, getDocs, query, where } = require("firebase/firestore");
  const publicQuery = query(collection(db, "publicReports"), where("published", "==", true), where("visibility", "==", "PUBLIC"));
  const snapshot = await assertSucceeds(getDocs(publicQuery));
  assert.equal(snapshot.size, 1);
  assert.equal(snapshot.docs[0].id, "report-public");
  await assertFails(getDocs(collection(db, "reports")));
});

test("anonymous visitors can list public meeting notices but not private meeting records", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  const { collection, getDocs, query, where } = require("firebase/firestore");
  const publicQuery = query(collection(db, "publicMeetings"), where("published", "==", true), where("visibility", "==", "PUBLIC"));
  const snapshot = await assertSucceeds(getDocs(publicQuery));
  assert.equal(snapshot.size, 1);
  assert.equal(snapshot.docs[0].id, "event-public");
  await assertFails(db.doc("meetings/board-private").get());
});

test("public publishing is restricted to authorised publisher roles and sanitized fields", async () => {
  const anonymous = testEnv.unauthenticatedContext().firestore();
  await assertFails(anonymous.doc("publicReports/unauthorized").set({
    title: "Unauthorized", published: true, visibility: "PUBLIC",
    publishedAt: Timestamp.fromDate(new Date("2026-10-10T00:00:00Z"))
  }));
  const member = testEnv.authenticatedContext("member-user", { email: "member@example.test" }).firestore();
  await assertFails(member.doc("publicReports/member-write").set({
    title: "Member write", published: true, visibility: "PUBLIC",
    publishedAt: Timestamp.fromDate(new Date("2026-10-10T00:00:00Z"))
  }));
  const admin = testEnv.authenticatedContext("admin-user", { email: "admin@example.test" }).firestore();
  await assertSucceeds(admin.doc("publicReports/approved").set({
    title: "Approved", summary: "Public summary", category: "General", reportDate: "2026-10-10",
    publicUrl: "https://example.org/approved.pdf", documentUrl: "", url: "",
    published: true, visibility: "PUBLIC", publishedAt: Timestamp.fromDate(new Date("2026-10-10T00:00:00Z"))
  }));
  await assertFails(admin.doc("publicReports/leak").set({
    title: "Should not publish", published: true, visibility: "PUBLIC",
    publishedAt: Timestamp.fromDate(new Date("2026-10-10T00:00:00Z")),
    confidentialNotes: "This must be rejected"
  }));
});
