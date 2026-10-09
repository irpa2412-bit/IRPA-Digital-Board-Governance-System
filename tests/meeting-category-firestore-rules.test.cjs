const assert = require("node:assert/strict");
const { before, after, beforeEach, test } = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
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
    await db.doc("employees/departmental-director").set({
      uid: "departmental-director",
      email: "director@example.test",
      status: "Active",
      role: "Departmental Director"
    });
    await db.doc("members/board-member").set({
      uid: "board-member",
      email: "board@example.test",
      status: "Active",
      role: "Board Member"
    });
    await db.doc("employees/staff-user").set({
      uid: "staff-user",
      email: "staff@example.test",
      status: "Active",
      role: "Staff"
    });
    await db.doc("adminProfiles/admin-user").set({ active: true, email: "admin@example.test" });
  });
});
function meeting(overrides = {}) {
  return {
    title: "Policy test meeting",
    meetingCategory: "ADMINISTRATIVE",
    meetingPolicyId: "ADMINISTRATIVE",
    meetingType: "Management Meeting",
    initiatorUid: "departmental-director",
    initiatorEmail: "director@example.test",
    registerStatus: "Draft",
    status: "Scheduled",
    ...overrides
  };
}
test("active designated departmental director can create a categorized meeting", async () => {
  const db = testEnv.authenticatedContext("departmental-director", {
    email: "director@example.test"
  }).firestore();
  await assertSucceeds(db.doc("meetings/departmental-meeting").set(meeting()));
});
test("designated initiator can complete initial registration release exactly once", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("meetings/departmental-meeting").set(meeting());
  });
  const db = testEnv.authenticatedContext("departmental-director", {
    email: "director@example.test"
  }).firestore();
  await assertSucceeds(db.doc("meetings/departmental-meeting").update({
    registerStatus: "Registered",
    registeredAt: "2026-10-09T17:00:00.000Z"
  }));
});
test("departmental registrar cannot edit a released meeting", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("meetings/departmental-meeting").set(meeting({
      registerStatus: "Registered",
      registeredAt: "2026-10-09T17:00:00.000Z"
    }));
  });
  const db = testEnv.authenticatedContext("departmental-director", {
    email: "director@example.test"
  }).firestore();
  await assertFails(db.doc("meetings/departmental-meeting").update({ title: "Unauthorised edit" }));
});
test("only administrator can delete a meeting", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("meetings/departmental-meeting").set(meeting({
      registerStatus: "Registered",
      registeredAt: "2026-10-09T17:00:00.000Z"
    }));
  });
  const registrarDb = testEnv.authenticatedContext("departmental-director", {
    email: "director@example.test"
  }).firestore();
  await assertFails(registrarDb.doc("meetings/departmental-meeting").delete());
  const adminDb = testEnv.authenticatedContext("admin-user", {
    email: "admin@example.test"
  }).firestore();
  await assertSucceeds(adminDb.doc("meetings/departmental-meeting").delete());
});
test("meeting creation rejects missing or invalid category metadata", async () => {
  const db = testEnv.authenticatedContext("departmental-director", {
    email: "director@example.test"
  }).firestore();
  await assertFails(db.doc("meetings/invalid-category").set(meeting({
    meetingCategory: "SECRET",
    meetingPolicyId: "SECRET"
  })));
});


test("direct meeting reads enforce category roles server-side", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("meetings/governance-record").set(meeting({
      meetingCategory: "GOVERNANCE",
      meetingPolicyId: "GOVERNANCE",
      meetingType: "Board Meeting"
    }));
    await db.doc("meetings/staff-record").set(meeting({
      meetingCategory: "STAFF",
      meetingPolicyId: "STAFF",
      meetingType: "Staff Meeting"
    }));
  });
  const staffDb = testEnv.authenticatedContext("staff-user", {
    email: "staff@example.test"
  }).firestore();
  const boardDb = testEnv.authenticatedContext("board-member", {
    email: "board@example.test"
  }).firestore();
  await assertFails(staffDb.doc("meetings/governance-record").get());
  await assertSucceeds(boardDb.doc("meetings/governance-record").get());
  await assertSucceeds(staffDb.doc("meetings/staff-record").get());
});

test("category-constrained meeting queries are allowed only for the matching category role", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("meetings/governance-record").set(meeting({
      meetingCategory: "GOVERNANCE",
      meetingPolicyId: "GOVERNANCE",
      meetingType: "Board Meeting"
    }));
  });
  const staffDb = testEnv.authenticatedContext("staff-user", {
    email: "staff@example.test"
  }).firestore();
  const boardDb = testEnv.authenticatedContext("board-member", {
    email: "board@example.test"
  }).firestore();
  await assertFails(staffDb.collection("meetings").where("meetingCategory", "==", "GOVERNANCE").get());
  await assertSucceeds(boardDb.collection("meetings").where("meetingCategory", "==", "GOVERNANCE").get());
});

test("explicit category metadata overrides a conflicting legacy meeting type", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc("meetings/category-mismatch").set(meeting({
      meetingCategory: "STAFF",
      meetingPolicyId: "STAFF",
      meetingType: "Board Meeting"
    }));
  });
  const boardDb = testEnv.authenticatedContext("board-member", {
    email: "board@example.test"
  }).firestore();
  const staffDb = testEnv.authenticatedContext("staff-user", {
    email: "staff@example.test"
  }).firestore();
  await assertFails(boardDb.doc("meetings/category-mismatch").get());
  await assertSucceeds(staffDb.doc("meetings/category-mismatch").get());
});

test("explicitly listed external participant can read only the meeting they are listed on", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc("meetings/invited-record").set(meeting({ participantUids: ["external-user"] }));
    await db.doc("meetings/uninvited-record").set(meeting({ title: "Not invited" }));
  });
  const externalDb = testEnv.authenticatedContext("external-user", {
    email: "external@example.test"
  }).firestore();
  await assertSucceeds(externalDb.doc("meetings/invited-record").get());
  await assertFails(externalDb.doc("meetings/uninvited-record").get());
});


test("meeting invitee can read only the invited meeting and its participant register", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {const db=context.firestore();
    await db.doc("meetings/invited-meeting").set(meeting({meetingCategory:"GOVERNANCE",meetingPolicyId:"GOVERNANCE",meetingType:"Board Meeting",registerStatus:"Registered",invitedEmails:["invitee@example.test"],participantEmails:["invitee@example.test"]}));
    await db.doc("meetings/other-meeting").set(meeting({meetingCategory:"GOVERNANCE",meetingPolicyId:"GOVERNANCE",meetingType:"Board Meeting",registerStatus:"Registered",invitedEmails:["someone-else@example.test"]}));
    await db.doc("participants/invitee-record").set({meetingId:"invited-meeting",participantEmail:"invitee@example.test",participantName:"Invitee",attendanceStatus:"Invited"});
    await db.doc("participants/other-record").set({meetingId:"other-meeting",participantEmail:"someone-else@example.test",participantName:"Other",attendanceStatus:"Invited"});
  });
  const db=testEnv.authenticatedContext("invitee-user",{email:"invitee@example.test"}).firestore();
  await assertSucceeds(db.doc("meetings/invited-meeting").get()); await assertFails(db.doc("meetings/other-meeting").get());
  await assertSucceeds(db.doc("participants/invitee-record").get()); await assertSucceeds(db.collection("participants").where("meetingId","==","invited-meeting").get()); await assertFails(db.doc("participants/other-record").get());
});

test("invitee can check in only their own participant record", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {const db=context.firestore();
    await db.doc("meetings/invited-meeting").set(meeting({invitedEmails:["invitee@example.test"]}));
    await db.doc("meetings/closed-meeting").set(meeting({status:"Completed",invitedEmails:["invitee@example.test"]}));
    await db.doc("participants/invitee-record").set({meetingId:"invited-meeting",participantUid:"invitee-user",participantEmail:"invitee@example.test",attendanceStatus:"Invited"});
    await db.doc("participants/other-record").set({meetingId:"invited-meeting",participantUid:"other-user",participantEmail:"other@example.test",attendanceStatus:"Invited"});
    await db.doc("participants/closed-record").set({meetingId:"closed-meeting",participantUid:"invitee-user",participantEmail:"invitee@example.test",attendanceStatus:"Invited"});
  });
  const db=testEnv.authenticatedContext("invitee-user",{email:"invitee@example.test"}).firestore();
  await assertSucceeds(db.doc("participants/invitee-record").update({attendanceStatus:"Present",attendanceRecordedAt:"2026-10-09T18:00:00.000Z",attendanceRecordedByUid:"invitee-user"}));
  await assertFails(db.doc("participants/other-record").update({attendanceStatus:"Present",attendanceRecordedAt:"2026-10-09T18:00:00.000Z",attendanceRecordedByUid:"invitee-user"}));
  await assertFails(db.doc("participants/closed-record").update({attendanceStatus:"Present",attendanceRecordedAt:"2026-10-09T18:00:00.000Z",attendanceRecordedByUid:"invitee-user"}));
  await assertFails(db.doc("participants/invitee-record").update({participantRole:"Board Member"}));
});


test("meeting initiator can register an invitee and create the linked invitation", async () => {
  await testEnv.withSecurityRulesDisabled(async context => {const db=context.firestore();await db.doc("meetings/organizer-meeting").set(meeting({initiatorUid:"departmental-director",initiatorEmail:"director@example.test",registerStatus:"Registered"}));});
  const db=testEnv.authenticatedContext("departmental-director",{email:"director@example.test"}).firestore();
  await assertSucceeds(db.doc("participants/new-invitee").set({meetingId:"organizer-meeting",participantEmail:"guest@example.test",participantName:"Guest",participantRole:"Invited Guest",attendanceStatus:"Invited"}));
  await assertSucceeds(db.doc("invitations/guest-invitation").set({meetingId:"organizer-meeting",participantId:"new-invitee",email:"guest@example.test",name:"Guest",status:"Pending"}));
});
