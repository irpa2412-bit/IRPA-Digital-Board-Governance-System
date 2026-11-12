const admin = require("../functions/node_modules/firebase-admin");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-irpa-dgbs";
const email = "irpa-browser-fixture-admin@example.test";
const password = "FixtureOnly-Password-2026!";

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
  await db.collection("institutionalDepartments").doc("browser-fixture-research").set({
    recordType: "Institutional Department",
    name: "Browser Fixture Research Department",
    code: "BFRD",
    status: "Active",
    fixtureOnly: true
  });
  process.stdout.write("Seeded isolated Firebase Emulator administrator and active department fixtures: " + email + "\n");
  await db.terminate();
  await admin.app().delete();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
