import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = (code, message) => { const error = new Error(message); error.check = code; throw error; };

export function createManifest(root) {
  const files = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name !== "deploy-manifest.json") {
        const rel = path.relative(root, full).split(path.sep).join("/");
        files[rel] = { sha256: sha256(fs.readFileSync(full)), size: fs.statSync(full).size };
      }
    }
  };
  walk(root);
  return { schemaVersion: 1, files };
}

export async function verifyHostAssets({ baseUrl, manifest, fetchImpl = fetch, retries = 10, retryDelayMs = 30000 }) {
  const base = new URL(baseUrl);
  const get = async (assetPath, check) => {
    let last;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const url = new URL(assetPath, base);
        url.searchParams.set("__irpa_asset_verify", String(Date.now()) + "-" + attempt);
        const response = await fetchImpl(url, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
        if (response.status === 200) return new Uint8Array(await response.arrayBuffer());
        last = new Error(`${assetPath} returned HTTP ${response.status}`);
      } catch (error) { last = error; }
      if (attempt + 1 < retries) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
    fail(check, last?.message || `Unable to fetch ${assetPath}`);
  };

  const htmlBytes = await get("/", "b");
  const html = new TextDecoder().decode(htmlBytes);
  const entryMatch = html.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>/i)
    || html.match(/<script\b[^>]*src=["']([^"']+)["'][^>]*type=["']module["'][^>]*>/i);
  if (!entryMatch) fail("b", "Live index.html does not reference a module entry bundle.");
  const entryPath = new URL(entryMatch[1], base).pathname;
  const entryRelative = entryPath.replace(/^\//, "");
  if (!manifest.files?.[entryRelative]) fail("b", `Entry bundle ${entryRelative} is absent from this host's deploy manifest.`);
  await get(entryPath, "b");

  const moduleName = Object.keys(manifest.files).find(name => /DocumentLifecycleModule.*\.js$/i.test(name));
  if (!moduleName) fail("a", "Deploy manifest has no DocumentLifecycleModule JavaScript asset.");
  const moduleBytes = await get("/" + moduleName, "a");
  const actualHash = sha256(moduleBytes);
  if (actualHash !== manifest.files[moduleName].sha256) fail("a", `DocumentLifecycleModule SHA-256 mismatch for ${moduleName}: expected ${manifest.files[moduleName].sha256}, received ${actualHash}`);
  const moduleSource = new TextDecoder().decode(moduleBytes);
  const imports = [...moduleSource.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g)].map(m => m[1]);
  for (const specifier of imports) {
    if (/^(https?:|data:)/i.test(specifier)) continue;
    const resolved = new URL(specifier, new URL("/" + moduleName, base));
    const rel = resolved.pathname.replace(/^\//, "");
    if (!manifest.files[rel]) fail("d", `Imported asset ${rel} is absent from the deploy manifest.`);
    await get(resolved.pathname, "d");
  }
  const entrySource = new TextDecoder().decode(await get(entryPath, "b"));
  const entryImport = [...entrySource.matchAll(/(?:from\s*|import\s*\()["']([^"']+DocumentLifecycleModule[^"']*\.js(?:\?[^"']*)?)["']/g)][0]?.[1];
  if (!entryImport) fail("c", "Live entry bundle does not import DocumentLifecycleModule.");
  const importedPath = new URL(entryImport, new URL(entryPath, base)).pathname;
  if (importedPath !== "/" + moduleName) fail("c", `Entry bundle imports ${importedPath}, but the manifest module is /${moduleName}.`);
  return { host: base.host, module: moduleName, moduleSha256: actualHash, entryBundle: entryRelative, importedAssets: imports.length, checks: ["a", "b", "c", "d"] };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv[2] === "--write-manifest") {
    const root = path.resolve(process.argv[3] || "dist");
    fs.writeFileSync(path.join(root, "deploy-manifest.json"), JSON.stringify(createManifest(root), null, 2) + "\n");
  } else {
    const baseUrl = process.argv[2];
    const manifestPath = process.argv[3];
    if (!baseUrl || !manifestPath) throw new Error("Usage: node scripts/verify-document-lifecycle-host.mjs <host-url> <manifest.json>");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    verifyHostAssets({ baseUrl, manifest }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
      console.error(JSON.stringify({ check: error.check || "unknown", error: error.message }));
      process.exit(1);
    });
  }
}
