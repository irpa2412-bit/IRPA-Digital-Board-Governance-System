import test from "node:test";
import assert from "node:assert/strict";
import { omitUndefinedFirestoreFields } from "../src/firebase/firestorePayload.js";

test("omits undefined optional metadata recursively before arrayUnion", () => {
  const record = {
    uid: "signer-1",
    authority: {
      declared: "Executive Director",
      sourceCollection: undefined,
      sourceRecordId: undefined
    },
    fields: [{ fieldId: "signature-1", value: "confirmed", optional: undefined }],
    absent: undefined,
    explicitlyNull: null
  };

  assert.deepEqual(omitUndefinedFirestoreFields(record), {
    uid: "signer-1",
    authority: { declared: "Executive Director" },
    fields: [{ fieldId: "signature-1", value: "confirmed" }],
    explicitlyNull: null
  });
});

test("rejects undefined array entries instead of silently dropping audit data", () => {
  assert.throws(
    () => omitUndefinedFirestoreFields({ events: ["signed", undefined] }),
    /Undefined array entry at value.events\[1\]/
  );
});

test("preserves non-plain Firestore values unchanged", () => {
  const timestampLike = new Date(0);
  assert.equal(omitUndefinedFirestoreFields(timestampLike), timestampLike);
});
