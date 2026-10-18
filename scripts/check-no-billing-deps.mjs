import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ESLint } from "eslint";
import globals from "globals";

const root = process.cwd();
const roots = ["src", "functions", "drive-gateway/src", "public"];
const rootFiles = ["vite.config.js", "firebase.json", ".firebaserc", "package.json", "functions/package.json", "drive-gateway/package.json", "drive-gateway/wrangler.toml"];
const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".html", ".toml"]);
const ignore = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next"]);
const tick = String.fromCharCode(96);
const categories = [
  ["Cloud Functions", /firebase\/functions|firebase-functions|httpsCallable|httpsCallableFromURL|getFunctions\s*\(|\bonCall\s*\(|\bonRequest\s*\(/i],
  ["Firebase Storage", /firebase\/storage|getStorage\s*\(|uploadBytes(?:Resumable)?\s*\(|getDownloadURL\s*\(|deleteObject\s*\(|listAll\s*\(/i],
  ["Google Maps / Places API", /maps\.googleapis\.com|maps\.google\.com|google\.maps|places\.googleapis\.com|DirectionsService|Geocoder|AutocompleteService|DirectionsRenderer/i],
  ["Weather API", /weather\.googleapis\.com|api\.openweathermap\.org|openweathermap|weatherapi\.com|weatherstack\.com|VisualCrossing|WeatherAPI/i],
  ["SMS / phone authentication", /signInWithPhoneNumber|RecaptchaVerifier|PhoneAuthProvider|verifyPhoneNumber|phoneAuth|sendSMS|sendSms|twilio|smsGateway|SMS_PROVIDER|PHONE_AUTH|preparePasswordResetPhone|phone.{0,30}(?:auth|verification|reset|otp|sms)|(?:auth|verification|reset|otp|sms).{0,30}phone/i]
];

async function walk(dir) {
  let entries;
  try { entries = await readdir(path.join(root, dir), { withFileTypes: true }); } catch { return []; }
  const found = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignore.has(entry.name)) continue;
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await walk(rel));
    else if (extensions.has(path.extname(entry.name))) found.push(rel);
  }
  return found;
}

const files = [...new Set([...rootFiles, ...(await Promise.all(roots.map(walk))).flat()])];
const findings = [];
for (const file of files) {
  let content;
  try { content = await readFile(path.join(root, file), "utf8"); } catch { continue; }
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const [category, pattern] of categories) {
      if (pattern.test(lines[i])) findings.push({ category, file, line: i + 1, source: lines[i].trim().slice(0, 260) });
    }
  }
}

const grouped = new Map(categories.map(([name]) => [name, []]));
for (const finding of findings) grouped.get(finding.category).push(finding);
const report = [
  "# IRPA-DBGS static billing-dependency audit",
  "",
  "Generated: " + new Date().toISOString(),
  "",
  "This is a static source-and-manifest inventory, not proof that every match makes a live API call or incurs charges. Firebase Storage API references are distinguished as a compatibility surface because vite.config.js aliases firebase/storage to src/firebase/signatureStorage.js, which routes file operations through the Cloudflare/Google Drive gateway. Review each reported line before treating it as an active provider dependency. Backend definitions, package manifests, and unused imports are included so dependencies are not silently missed.",
  "",
  ...[...grouped.entries()].flatMap(([category, rows]) => [
    "## " + category + " (" + rows.length + " source-line matches)",
    "",
    ...(rows.length ? rows.map(x => "- " + tick + x.file + ":" + x.line + tick + " — " + tick + x.source.replaceAll(tick, "'") + tick) : ["- None detected."]),
    ""
  ])
].join("\n");
await mkdir(path.join(root, "artifacts"), { recursive: true });
await writeFile(path.join(root, "artifacts/billing-dependency-audit.md"), report, "utf8");
console.log(report);

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [{ files: ["src/firebase/*.js"], languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser, ...globals.node, ...globals.es2021 } }, rules: { "no-undef": "error" } }]
});
const results = await eslint.lintFiles(["src/firebase/*.js"]);
const formatter = await eslint.loadFormatter("stylish");
const lintOutput = formatter.format(results);
if (lintOutput) console.log(lintOutput);
const errors = results.reduce((sum, item) => sum + item.errorCount, 0);
const warnings = results.reduce((sum, item) => sum + item.warningCount, 0);
console.log("no-undef over src/firebase/*.js: " + errors + " errors, " + warnings + " warnings.");
if (errors) process.exitCode = 1;
