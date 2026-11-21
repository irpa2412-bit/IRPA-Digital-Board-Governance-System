import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const selfTest = await readFile(new URL("../src/components/SignaturePathwaySelfTest.jsx", import.meta.url), "utf8");
const storage = await readFile(new URL("../src/firebase/signatureStorage.js", import.meta.url), "utf8");

test("self-test does not run Drive refresh as part of the main diagnostic", () => {
  const reconcile = selfTest.slice(selfTest.indexOf("async function reconcile()"), selfTest.indexOf("\n  return <section"));
  assert.doesNotMatch(reconcile, /await checkDriveHealth\(\)/);
  assert.match(selfTest, /onClick=\{checkDriveHealth\}/, "Drive refresh remains a separate explicit action");
});

test("self-test Gateway calls reject redirects instead of following an interactive login gateway", () => {
  assert.match(selfTest, /redirect: "error"/, "direct Drive health fetch must reject redirects");
  assert.match(storage, /async function gatewayPost\(path, payload, requestOptions = \{\}\)/);
  assert.match(storage, /requestOptions\.redirect \? \{ redirect: requestOptions\.redirect \} : \{\}/);
  assert.match(storage, /reconcileSignatureDocumentIds\(documents = \[\], options = \{\}, requestOptions = \{\}\)/);
  assert.match(storage, /downloadControlledDocumentBytes\(fileId, documentId, requestOptions = \{\}\)/);
  assert.match(selfTest, /reconcileSignatureDocumentIds\(oneDocument, options, \{ redirect: "error" \}\)/);
  assert.match(selfTest, /downloadControlledDocumentBytes\(fileId, item\.documentId, \{ redirect: "error" \}\)/);
});
