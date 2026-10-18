#!/usr/bin/env node
/**
 * Static inventory of billing-sensitive integrations. This is intentionally an
 * inventory, not a false claim that legacy integrations have already been removed.
 * Output is stable path:line:category:source for CI artifacts/review.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const roots = ["src", "functions", "drive-gateway", "cloudflare", ".github", "package.json", "firebase.json"];
const rules = [
  ["Cloud Functions", /firebase-functions|httpsCallable|\bonCall\s*\(|\bonRequest\s*\(|functions\.httpsCallable|cloudfunctions\.net|firebase deploy\s+--only\s+functions/i],
  ["Firebase Storage", /firebase\/storage|getStorage\s*\(|uploadBytes\s*\(|uploadString\s*\(|getDownloadURL\s*\(|storageBucket|firebasestorage\.googleapis\.com/i],
  ["Google Weather/Maps API", /maps\.googleapis\.com|maps\.google\.com\/maps\/api|weather\.googleapis\.com|Google Maps JavaScript API|google\.maps\.|PlacesService|DirectionsService|Geocoder\s*\(/i],
  ["SMS/phone authentication", /signInWithPhoneNumber|PhoneAuthProvider|RecaptchaVerifier|phoneNumber\s*[:=]|SMS.?auth|SMS.?verification|sendSMS|twilio/i]
];
const files = [];
function walk(path) {
  let entries;
  try { entries = readdirSync(path); } catch { return; }
  for (const name of entries) {
    if (["node_modules", ".git", "dist", "build", "coverage"].includes(name)) continue;
    const full = join(path, name);
    let info; try { info = statSync(full); } catch { continue; }
    if (info.isDirectory()) walk(full);
    else if (/\.(?:[cm]?js|jsx|ts|tsx|json|yml|yaml|toml|html)$/.test(name) || ["package.json","firebase.json"].includes(name)) files.push(full);
  }
}
for (const root of roots) {
  try { if (statSync(root).isDirectory()) walk(root); else files.push(root); } catch {}
}
const unique = [...new Set(files)].sort();
let count = 0;
for (const file of unique) {
  let lines; try { lines = readFileSync(file, "utf8").split(/\r?\n/); } catch { continue; }
  lines.forEach((line, i) => {
    for (const [category, pattern] of rules) {
      if (pattern.test(line)) {
        console.log(`${relative(process.cwd(), file)}:${i + 1}: [${category}] ${line.trim()}`);
        count++;
      }
    }
  });
}
console.log(`Billing dependency inventory: ${count} match(es) across ${unique.length} scanned files.`);
