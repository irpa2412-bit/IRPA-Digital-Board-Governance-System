import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const BILLING_REQUIRED_PACKAGES = new Set([
  "firebase-functions",
  "firebase-admin",
  "@google-cloud/functions-framework",
  "@google-cloud/cloudbuild",
  "@google-cloud/artifact-registry",
  "@google-cloud/cloudfunctions",
  "@google-cloud/run"
]);

// This gate protects the browser application package and src bundle. The
// separately packaged legacy Functions runtime is not a browser dependency.
export function findBillingDependencyViolations(manifest, lockfile) {
  const declared = [
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {})
  ];
  const lockedRoot = lockfile.packages?.[""] || {};
  const locked = [
    ...Object.keys(lockedRoot.dependencies || {}),
    ...Object.keys(lockedRoot.devDependencies || {})
  ];
  return [...new Set([...declared, ...locked])]
    .filter(name => BILLING_REQUIRED_PACKAGES.has(name))
    .sort();
}

export function findBillingImportViolations(source) {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](?:firebase-functions|firebase-admin|@google-cloud\/(?:functions-framework|cloudbuild|artifact-registry|cloudfunctions|run))(?:\/[^"']*)?["']/g;
  return [...source.matchAll(pattern)].map(match => match[0]);
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:[cm]?js|jsx|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function run() {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const lockfile = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const dependencies = findBillingDependencyViolations(manifest, lockfile);
  const imports = sourceFiles(join(ROOT, "src"))
    .flatMap(path => findBillingImportViolations(readFileSync(path, "utf8")).map(value => path + ": " + value));
  const violations = [
    ...dependencies.map(name => "root app dependency: " + name),
    ...imports.map(value => "browser source import: " + value)
  ];
  if (violations.length) {
    console.error("FAIL: billing-required server dependencies are present in the browser application.");
    for (const violation of violations) console.error("- " + violation);
    process.exitCode = 1;
    return;
  }
  console.log("PASS: browser application has no direct Firebase Functions/Admin or Google Cloud Functions/Build runtime dependency.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
