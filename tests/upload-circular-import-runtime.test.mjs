import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
