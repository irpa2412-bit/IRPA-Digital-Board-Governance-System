import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const emailPortal = read("../src/pages/EmailSigningReadOnlyPage.jsx");
const authenticatedPortal = read("../src/pages/SignaturePlatform.jsx");
const worker = read("../drive-gateway/src/signing.mjs");
const pdf = read("../drive-gateway/src/pdf.mjs");

test("email-link signing opens on the signer's assigned field and highlights it", () => {
  assert.match(emailPortal, /firstAssignedField=fields\.find\(field=>\["Signature","Initials"\]\.includes\(field\.type\)\)/);
  assert.match(emailPortal, /target\?\.scrollIntoView\(\{behavior:"smooth",block:"center",inline:"center"\}\)/);
  assert.match(emailPortal, /signatureFieldCss\(field\)/);
  assert.match(emailPortal, /3px solid #f59e0b/);
});

test("authenticated signing workspace scrolls the assigned field into view", () => {
  assert.match(authenticatedPortal, /initialFieldFocusRef/);
  assert.match(authenticatedPortal, /node\?\.scrollIntoView\(\{block:"center"\}\)/);
  assert.match(authenticatedPortal, /canLeaveSigning/);
  assert.match(authenticatedPortal, /Leave<\/button>/);
});

test("email-link Leave clears the invitation session and removes the signing form", () => {
  assert.match(emailPortal, /function leaveSigningSession\(\)/);
  assert.match(emailPortal, /irpaEmailSigningSession:/);
  assert.match(emailPortal, /url\.searchParams\.delete\("emailSignToken"\)/);
  assert.match(emailPortal, /setSigningToken\("\"\)/);
  assert.match(emailPortal, /setFieldApplications\(\[\]\)/);
  assert.match(emailPortal, /setFieldValues\(\{\}\)/);
  assert.match(emailPortal, /if\(leftSession\)return/);
  assert.match(emailPortal, /onClick=\{leaveSigningSession\}[^>]*>Leave/);
});

test("Gateway exposes only aggregate distribution state and finalizes the signer response with it", () => {
  assert.match(worker, /distribution:\{complete:distribution\.complete,sent:distribution\.sent,total:distribution\.total\}/);
  assert.match(worker, /distribution:done\.distribution\|\|null/);
});

test("final PDF stamping delegates to the shared visible-page conversion", () => {
  assert.match(pdf, /signatureFieldToPdfBox/);
  assert.match(pdf, /return signatureFieldToPdfBox\(page, field, options\)/);
});
