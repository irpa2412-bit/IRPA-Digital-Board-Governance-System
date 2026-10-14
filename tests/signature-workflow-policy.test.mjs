import assert from "node:assert/strict";
import test from "node:test";
import { requireSupportedSignatureRoutingMode } from "../src/firebase/signatureWorkflowPolicy.js";

test("Sequential and Parallel are the only supported Signature Portal routing modes", () => {
  assert.equal(requireSupportedSignatureRoutingMode("Sequential"), "Sequential");
  assert.equal(requireSupportedSignatureRoutingMode("Parallel"), "Parallel");
  assert.equal(requireSupportedSignatureRoutingMode(undefined), "Sequential");
});

test("unsupported and malformed routing modes fail closed", () => {
  assert.throws(() => requireSupportedSignatureRoutingMode("Mixed"), /not yet supported/);
  assert.throws(() => requireSupportedSignatureRoutingMode(""), /not yet supported/);
  assert.throws(() => requireSupportedSignatureRoutingMode("parallel"), /not yet supported/);
});
