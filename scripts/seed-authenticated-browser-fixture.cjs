const admin = require("../functions/node_modules/firebase-admin");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-irpa-dgbs";
const email = "irpa-browser-fixture-admin@example.test";
const password = "FixtureOnly-Password-2026!";
const primaryAdminEmail = "irpa-primary-admin-fixture@example.test";
const primaryAdminPassword = "FixtureOnly-Primary-Admin-2026!";

async function main() {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Refusing to seed the browser fixture unless both Firebase emulators are active.");
  }
  admin.initializeApp({ projectId });
  const auth = admin.auth();
  const db = admin.firestore();
  const user = await auth.createUser({ email, password, emailVerified: true, displayName: "IRPA Browser Fixture Administrator" });
  await db.collection("adminProfiles").doc(user.uid).set({
    uid: user.uid,
    email,
    name: "IRPA Browser Fixture Administrator",
    role: "Administrator",
    active: true,
    status: "active",
    createdAt: new Date().toISOString(),
    fixtureOnly: true
  });
  const primaryAdmin = await auth.createUser({ email: primaryAdminEmail, password: primaryAdminPassword, emailVerified: true, displayName: "IRPA Primary Administrator Claim Fixture" });
  await auth.setCustomUserClaims(primaryAdmin.uid, { admin: true });
  process.stdout.write("Seeded isolated Firebase Emulator admin-profile and primary-admin-claim fixtures.\n");
  await db.terminate();
  await admin.app().delete();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
