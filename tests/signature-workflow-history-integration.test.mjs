import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(
    signingPath,
    /workflowHistory\s*:\s*arrayUnion\(omitUndefinedFirestoreFields\(actionRecord\)\)/,
    "signEnvelope must sanitize its actual actionRecord before arrayUnion"
  );

  const actionRecord = {
    uid: "integration-test-signer",
    authorityVerificationStatus: "Signer-declared; not independently verified",
    authoritySourceCollection: undefined,
    nested: { optionalRecordId: undefined, retained: "audit-value" }
  };
  const arrayUnion = value => ({ operation: "arrayUnion", value });
  const workflowHistoryValue = arrayUnion(omitUndefinedFirestoreFields(actionRecord));

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
