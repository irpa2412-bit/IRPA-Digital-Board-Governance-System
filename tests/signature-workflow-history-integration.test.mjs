import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { runInNewContext } from "node:vm";
import { omitUndefinedFirestoreFields } from "../src/firebase/firestorePayload.js";

const signingService = readFileSync(
  new URL("../src/firebase/signaturePlatform.js", import.meta.url),
  "utf8"
);

test("legacy signEnvelope binds and executes the workflow-history sanitizer", () => {
  const importStatement = signingService.match(
    /^import\s*\{\s*omitUndefinedFirestoreFields\s*\}\s*from\s*["']\.\/firestorePayload\.js["'];?$/m
  );
  assert.ok(importStatement, "signaturePlatform.js must import the sanitizer into module scope");

  const signEnvelopeStart = signingService.indexOf("export async function signEnvelope(");
  assert.notEqual(signEnvelopeStart, -1, "the legacy signEnvelope implementation must exist");
  const signingPath = signingService.slice(signEnvelopeStart);
  const workflowHistoryCall = signingPath.match(/workflowHistory\s*:\s*(arrayUnion\(omitUndefinedFirestoreFields\(actionRecord\)\))/);
  assert.ok(workflowHistoryCall, "signEnvelope must sanitize its actual actionRecord before arrayUnion");

  const actionRecord = {
    uid: "integration-test-signer",
    authorityVerificationStatus: "Signer-declared; not independently verified",
    authoritySourceCollection: undefined,
    nested: { optionalRecordId: undefined, retained: "audit-value" }
  };
  const arrayUnion = value => ({ operation: "arrayUnion", value });
  const workflowHistoryValue = runInNewContext(workflowHistoryCall[1], {
    actionRecord,
    arrayUnion,
    omitUndefinedFirestoreFields
  });

  assert.deepEqual(workflowHistoryValue, {
    operation: "arrayUnion",
    value: {
      uid: "integration-test-signer",
      authorityVerificationStatus: "Signer-declared; not independently verified",
      nested: { retained: "audit-value" }
    }
  });
});

test("workflow-history sanitizer preserves null and rejects undefined array entries", () => {
  assert.deepEqual(omitUndefinedFirestoreFields({ optional: null, omitted: undefined }), {
    optional: null
  });
  assert.throws(
    () => omitUndefinedFirestoreFields({ fields: ["ok", undefined] }),
    /Undefined array entry/
  );
});

test("every signing-application reference to the sanitizer is declared in module scope", () => {
  const roots = ["src", "drive-gateway/src"];
  const sourceFiles = [];
  const visit = directory => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (/\.(?:mjs|js|jsx|ts|tsx)$/.test(name)) sourceFiles.push(path);
    }
  };
  roots.forEach(visit);

  const references = [];
  for (const path of sourceFiles) {
    const source = readFileSync(path, "utf8");
    if (!source.includes("omitUndefinedFirestoreFields")) continue;
    const declared =
      /\bimport\s*\{[^}]*\bomitUndefinedFirestoreFields\b[^}]*\}\s*from\s*["'][^"']+["']/.test(source) ||
      /\bexport\s+function\s+omitUndefinedFirestoreFields\b/.test(source) ||
      /\bfunction\s+omitUndefinedFirestoreFields\b/.test(source) ||
      /\bconst\s+omitUndefinedFirestoreFields\s*=/.test(source);
    assert.ok(declared, `${relative(process.cwd(), path)} references the sanitizer without a module-scope declaration/import`);
    references.push(relative(process.cwd(), path));
  }

  assert.deepEqual(
    references.sort(),
    ["src/firebase/firestorePayload.js", "src/firebase/signaturePlatform.js"].sort(),
    "the sanitizer should have one implementation module and one signing-service consumer"
  );
});
