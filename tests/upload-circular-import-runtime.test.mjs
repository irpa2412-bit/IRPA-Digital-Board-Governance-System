import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { describeUploadFailure } from "../src/components/uploadRuntimeDiagnostics.mjs";

test("upload runtime report preserves the first five stack lines for a thrown error", () => {
  function uploadStep() {
    throw new ReferenceError("Cannot access 'Pe' before initialization");
  }
  let thrown;
  try { uploadStep(); } catch (error) { thrown = error; }
  const diagnostic = describeUploadFailure(thrown);
  assert.equal(diagnostic.message, "Cannot access 'Pe' before initialization");
  const lines = diagnostic.stack.split("\n");
  assert.equal(lines.length, 5);
  assert.match(lines[0], /ReferenceError: Cannot access 'Pe' before initialization/);
  assert.match(diagnostic.stack, /uploadStep/);
});

test("upload dependency path no longer imports auth through the data module", async () => {
  const [data, auth, delivery] = await Promise.all([
    readFile(new URL("../src/firebase/data.js", import.meta.url), "utf8"),
    readFile(new URL("../src/firebase/auth.js", import.meta.url), "utf8"),
    readFile(new URL("../src/firebase/employeeRegistrationEmail.js", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(data, /from ["']\.\/auth["']/);
  assert.match(data, /from ["']\.\/employeeRegistrationEmail["']/);
  assert.match(auth, /from ["']\.\/employeeRegistrationEmail["']/);
  assert.doesNotMatch(delivery, /from ["']\.\/(?:auth|data|invitationWorkflow)["']/);
});

test("real built upload module completes Create Drive file against a mocked Gateway", async () => {
  const root = process.cwd();
  const temp = await mkdtemp(path.join(os.tmpdir(), "irpa-upload-runtime-"));
  const authStub = "\\0upload-test-auth", configStub = "\\0upload-test-config", gatewayStub = "\\0upload-test-gateway";
  const plugin = {
    name: "upload-runtime-test-mocks",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "firebase/auth") return authStub;
      if (importer === path.join(root, "src/firebase/signatureStorage.js") && source === "./config") return configStub;
      if (importer === path.join(root, "src/firebase/signatureStorage.js") && source === "./gatewayUrl") return gatewayStub;
      return null;
    },
    load(id) {
      if (id === authStub) return 'export async function getIdToken(){return "mock-token";}';
      if (id === configStub) return 'export const auth={currentUser:{uid:"upload-test-user",email:"test@irpa.invalid"}};';
      if (id === gatewayStub) return 'export function getGoogleDriveGatewayUrl(){return "https://mock-gateway.invalid";}';
      return null;
    }
  };
  try {
    const outDir = path.join(temp, "bundle");
    await build({
      configFile: false, root, plugins: [plugin],
      build: { ssr: "src/firebase/signatureStorage.js", outDir, emptyOutDir: true, minify: false, sourcemap: true, rollupOptions: { output: { format: "es" } } }
    });
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\\/api\\/upload-controlled-document$/);
      const payload = JSON.parse(init.body);
      assert.ok(payload.base64);
      assert.equal(payload.fileSize, 8);
      return new Response(JSON.stringify({
        ok: true,
        categoryArchive: { folderId: "mock-folder", file: { fileId: "mock-drive-file", name: payload.fileName } },
        archivePath: payload.destinationKey
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const bundle = (await readFile(path.join(outDir, "signatureStorage.js")).catch(async () => {
      const files = await import("node:fs/promises").then(m => m.readdir(outDir));
      return files.find(name => name.endsWith(".js"));
    }));
    const bundleName = typeof bundle === "string" ? bundle : "signatureStorage.js";
    const mod = await import(pathToFileURL(path.join(outDir, bundleName)).href + "?test=" + Date.now());
    const result = await mod.uploadControlledDocumentRouted({
      documentId: "upload-test-document", title: "Upload runtime test", reference: "IRPA-UPLOAD-TEST",
      documentType: "Governance", archiveCategory: "Governance Documents", classification: "Public",
      uploadedAt: "2026-10-31T00:00:00.000Z",
      file: { name: "upload-runtime.pdf", type: "application/pdf", async arrayBuffer() {
        return Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 55]).buffer;
      } }
    });
    assert.equal(result.categoryArchive.file.fileId, "mock-drive-file");
  } catch (error) {
    assert.notEqual(error?.name, "ReferenceError", error?.stack || String(error));
    throw error;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
