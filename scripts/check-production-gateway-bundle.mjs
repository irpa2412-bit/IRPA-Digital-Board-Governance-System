import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const productionGateway = "https://irpa-google-drive-gateway.irpa-governance.workers.dev";
async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  }));
  return nested.flat();
}
const files = await filesUnder("dist");
assert.ok(files.length > 0, "production build output must not be empty");
const bundle = (await Promise.all(files.map(file => readFile(file, "utf8")))).join("\n");
assert.ok(bundle.includes(productionGateway), "production bundle must contain the Cloudflare Worker gateway URL");
console.log("PRODUCTION_WORKER_GATEWAY_BUNDLE=PASS");
