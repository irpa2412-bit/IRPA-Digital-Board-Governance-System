const fs = require("fs");
const storage = fs.readFileSync("storage.rules","utf8");
const firebase = JSON.parse(fs.readFileSync("firebase.json","utf8"));
const functions = fs.readFileSync("functions/index.js","utf8");
const auth = fs.readFileSync("src/firebase/auth.js","utf8");

if (!firebase.storage || firebase.storage.rules !== "storage.rules") throw new Error("SECURITY GATE FAILED: Storage rules are not registered.");
if (!/allow\s+read,\s*write:\s*if\s+false\s*;/.test(storage)) throw new Error("SECURITY GATE FAILED: Storage is not deny-by-default.");
if (/allow\s+read,\s*write:\s*if\s+request\.auth\s*!=\s*null/.test(storage)) throw new Error("SECURITY GATE FAILED: broad authenticated-user Storage access remains.");
if (!functions.includes("exports.redeemInvitationToken")) throw new Error("SECURITY GATE FAILED: invitation redemption callable is missing.");
if (!functions.includes("invitationSecretHash") || !functions.includes("invitationExpiresAt")) throw new Error("SECURITY GATE FAILED: invitation expiry/hash controls are missing.");
if (!auth.includes("signInWithCustomToken") || !auth.includes("completeInvitationToken")) throw new Error("SECURITY GATE FAILED: client invitation redemption is missing.");
console.log("IRPA_SECURITY_BASELINE_GATE_OK");
