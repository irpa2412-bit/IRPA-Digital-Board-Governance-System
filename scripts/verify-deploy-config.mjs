#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const PRODUCTION_PROJECT = "irpa-digital-board-governance";
const PRODUCTION_ORIGINS = [
  "https://irpa.or.tz",
  "https://www.irpa.or.tz",
  "https://irpa-digital-board-governance.web.app",
  "https://irpa-digital-board-governance.firebaseapp.com",
];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const environment = arg("--environment");
const configPath = arg("--config", "drive-gateway/wrangler.toml");
if (!["staging", "production"].includes(environment)) {
  throw new Error("Usage: node scripts/verify-deploy-config.mjs --environment staging|production [--config path]");
}

const raw = fs.readFileSync(configPath, "utf8");
const config = configPath.endsWith(".json") ? JSON.parse(raw) : null;

function tomlSection(section) {
  const marker = "[" + section + "]";
  const start = raw.indexOf(marker);
  if (start < 0) return "";
  const body = raw.slice(start + marker.length);
  const next = body.search(/^\[/m);
  return next >= 0 ? body.slice(0, next) : body;
}

function tomlValue(name, section) {
  const block = tomlSection(section);
  const match = block.match(new RegExp("^" + name + "\\s*=\\s*\"([^\"]*)\"\\s*$", "m"));
  return match ? match[1] : "";
}

function value(name, section) {
  return config ? String(config?.vars?.[name] ?? "") : tomlValue(name, section);
}

function originsFromConfig(section) {
  return (process.env.ALLOWED_ORIGINS || value("ALLOWED_ORIGINS", section))
    .split(",")
    .map(x => x.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

const section = environment === "staging" ? "env.staging.vars" : "vars";
const projectId = process.env.FIREBASE_PROJECT_ID || value("FIREBASE_PROJECT_ID", section);
const origins = originsFromConfig(section);

if (!projectId) throw new Error(environment + ": FIREBASE_PROJECT_ID is missing.");
if (!origins.length) throw new Error(environment + ": ALLOWED_ORIGINS is missing.");

if (environment === "staging") {
  if (projectId === PRODUCTION_PROJECT) {
    throw new Error("staging: FIREBASE_PROJECT_ID must not equal the production project.");
  }
  const productionOrigin = origins.find(origin => PRODUCTION_ORIGINS.includes(origin));
  if (productionOrigin) {
    throw new Error("staging: production origin is forbidden in ALLOWED_ORIGINS: " + productionOrigin);
  }
  console.log("STAGING_DEPLOY_CONFIG_OK");
  console.log("FIREBASE_PROJECT_ID is isolated from production.");
  console.log("ALLOWED_ORIGINS contains no production origin.");
  process.exit(0);
}

if (projectId !== PRODUCTION_PROJECT) {
  throw new Error("production: FIREBASE_PROJECT_ID must equal the controlled production project.");
}
for (const origin of PRODUCTION_ORIGINS) {
  if (!origins.includes(origin)) {
    throw new Error("production: required ALLOWED_ORIGINS entry is missing: " + origin);
  }
}

if (config) {
  const kv = Array.isArray(config.kv_namespaces) ? config.kv_namespaces : [];
  if (!kv.some(x => x?.binding === "DRIVE_KV" && /^[a-f0-9]{32}$/i.test(String(x?.id || "")))) {
    throw new Error("production: DRIVE_KV binding is missing or invalid.");
  }
  const dos = config?.durable_objects?.bindings || [];
  if (!dos.some(x => x?.name === "ESIGN_DO" && x?.class_name === "EsignRecordDurableObject")) {
    throw new Error("production: ESIGN_DO binding is missing or invalid.");
  }
  const migrations = Array.isArray(config.migrations) ? config.migrations : [];
  if (!migrations.some(x =>
    x?.tag === "esign-do-v1" &&
    Array.isArray(x?.new_sqlite_classes) &&
    x.new_sqlite_classes.includes("EsignRecordDurableObject")
  )) {
    throw new Error("production: ESIGN_DO migration is missing.");
  }
}

console.log("PRODUCTION_DEPLOY_CONFIG_OK");
console.log("FIREBASE_PROJECT_ID and required production ALLOWED_ORIGINS are present.");
console.log("Production Worker bindings/migrations are present when a Wrangler JSON config is supplied.");
