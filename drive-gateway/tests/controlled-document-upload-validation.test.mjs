import test from "node:test";
import assert from "node:assert/strict";
import { validateControlledDocumentUpload } from "../../src/components/controlledDocumentUploadValidation.mjs";

const validFile = { name: "test.pdf", size: 1024, type: "application/pdf" };

function validate(overrides = {}) {
  return validateControlledDocumentUpload({
    authenticated: true,
    file: validFile,
    documentType: "Governance",
    allowRestrictedUpload: false,
    contentType: "application/pdf",
    ...overrides
  });
}

test("upload validation reports missing document type instead of disabling the submit action", () => {
  assert.equal(validate({ documentType: "" }), "Choose a document type before uploading.");
});

test("upload validation reports missing file with a direct next step", () => {
  assert.equal(validate({ file: null }), "Select a document file to upload.");
});

test("unauthenticated upload is rejected before upload work begins", () => {
  assert.equal(validate({ authenticated: false }), "You must be signed in.");
});

test("unsupported document types are rejected", () => {
  assert.equal(validate({ documentType: "Unknown" }), "Choose one of the five supported document types.");
});

test("Administrator documents remain blocked without special permission", () => {
  assert.equal(
    validate({ documentType: "Administrator", allowRestrictedUpload: false }),
    "Administrator/restricted documents require special permission."
  );
});

test("Administrator documents are allowed through UI validation when permission is provided", () => {
  assert.equal(validate({ documentType: "Administrator", allowRestrictedUpload: true }), "");
});

test("empty and oversized files remain blocked", () => {
  assert.equal(validate({ file: { ...validFile, size: 0 } }), "The selected document is empty.");
  assert.equal(validate({ file: { ...validFile, size: 10 * 1024 * 1024 + 1 } }), "Documents must not exceed 10 MB.");
});

test("unsupported file formats remain blocked", () => {
  assert.match(validate({ contentType: "application/octet-stream" }), /format is not supported/i);
});

test("valid public governance document passes validation", () => {
  assert.equal(validate(), "");
});
