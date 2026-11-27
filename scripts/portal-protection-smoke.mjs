import fs from "node:fs";
import { spawnSync } from "node:child_process";

const registry = JSON.parse(fs.readFileSync("docs/portal-protection/portal-register.json", "utf8"));
const rows = [];
for (const [portal, entry] of Object.entries(registry.portals)) {
  const result = spawnSync(process.execPath, ["--test", ...(entry.tests ?? [])], { encoding: "utf8" });
  const output = (result.stderr || result.stdout || "test process failed").trim();
  const lines = output.split(/\r?\n/);
  const failureStart = lines.findIndex(line => /^not ok \\d+ - /.test(line));
  const detail = result.status === 0
    ? "registered regression tests passed"
    : (failureStart >= 0 ? lines.slice(failureStart, failureStart + 18) : lines.slice(-18)).join(" ").slice(0, 6000);
  rows.push({ portal, status: result.status === 0 ? "PASS" : "FAIL", detail });
}
const width = Math.max("PORTAL".length, ...rows.map(r => r.portal.length));
console.log("PORTAL".padEnd(width) + " | RESULT | EVIDENCE");
console.log("-".repeat(width + 32));
for (const row of rows) console.log(row.portal.padEnd(width) + " | " + row.status.padEnd(6) + " | " + row.detail);
if (rows.some(r => r.status !== "PASS")) process.exitCode = 1;
