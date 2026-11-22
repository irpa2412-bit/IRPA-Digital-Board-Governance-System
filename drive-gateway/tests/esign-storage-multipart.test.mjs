import test from "node:test";
import assert from "node:assert/strict";
import { buildEsignContext } from "../src/esignContext.mjs";

test("e-sign Drive upload uses RFC-compliant CRLF multipart framing", async () => {
  const originalFetch = globalThis.fetch;
  const uploads = [];
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
      throw new Error("Unexpected network request in multipart regression test.");
    }
    uploads.push({ url: String(url), init });
    return Response.json({
      id: "staging-test-file",
      name: "specimen.pdf",
      webViewLink: "https://drive.google.com/file/d/staging-test-file/view"
    });
  };

  try {
    const ctx = buildEsignContext({
      env: { DRIVE_MOCK: "false" },
      verifyUser: async () => ({ uid: "staging-test-uid" }),
      sendInvitation: async () => {},
      logger: { error() {} },
      driveHelpers: {
        getDriveAccessToken: async () => "staging-test-token",
        driveFetch: async (_env, _token, _path, options = {}) => {
          if (options.method === "POST") return { id: "staging-test-folder" };
          return { files: [{ id: "staging-test-folder" }] };
        }
      }
    });

    await ctx.storage.put({
      path: "IRPA Governance System/Signature Profiles/staging-test/specimen.pdf",
      bytes: Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 55]),
      contentType: "application/pdf",
      metadata: { documentId: "DOC-STAGING-MULTIPART", recordOrigin: "TRIAL" }
    });

    assert.equal(uploads.length, 1);
    const { init } = uploads[0];
    const contentType = init.headers["Content-Type"];
    const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
    assert.ok(boundary, "multipart boundary must be declared");
    const body = new TextDecoder().decode(init.body);
    assert.ok(body.startsWith(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`));
    assert.ok(body.includes(`\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`));
    assert.ok(body.endsWith(`\r\n--${boundary}--`));
    assert.equal(body.includes("\\r\\n"), false, "literal backslash sequences must not replace CRLF bytes");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
