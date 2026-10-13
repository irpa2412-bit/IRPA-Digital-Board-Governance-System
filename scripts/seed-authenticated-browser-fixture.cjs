const { initializeApp } = require("../functions/node_modules/firebase-admin/app");
const { getAuth } = require("../functions/node_modules/firebase-admin/auth");
const { getFirestore } = require("../functions/node_modules/firebase-admin/firestore");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-irpa-dgbs";
const email = "irpa-browser-fixture-admin@example.test";
const password = "FixtureOnly-Password-2026!";

async function main() {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Refusing to seed the browser fixture unless both Firebase emulators are active.");
  }
  initializeApp({ projectId });
  const auth = getAuth();
  const db = getFirestore();
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
  process.stdout.write("Seeded isolated Firebase Emulator administrator fixture: " + email + "\n");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
