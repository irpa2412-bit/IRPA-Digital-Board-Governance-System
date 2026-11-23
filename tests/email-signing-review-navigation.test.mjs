import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/EmailSigningReadOnlyPage.jsx", "utf8");
const gateway = readFileSync("drive-gateway/src/signing.mjs", "utf8");

test("email-link signer can enter full-document review before every assigned field is complete", () => {
  assert.match(page, /disabled=\{!canReview\|\|!pdfDocument\|\|Boolean\(pageError\)\}/);
  assert.doesNotMatch(page, /disabled=\{!canReview\|\|!pdfDocument\|\|Boolean\(pageError\)\|\|incomplete\.length>0\}/);
  assert.match(page, /opacity:\(!canReview\|\|!pdfDocument\|\|Boolean\(pageError\)\)\?0\.5:1/);
  assert.doesNotMatch(page, /opacity:\(!canReview\|\|!pdfDocument\|\|Boolean\(pageError\)\|\|incomplete\.length>0/);
  assert.doesNotMatch(page, /if\(incomplete\.length\)\{setError\("Complete every responsibility and its assigned fields before final review/);
  assert.match(page, /const incomplete=fields\.filter\(field=>field\.required&&!complete\(field\)\)/);
  assert.match(page, /const canReview=Boolean\(record\)&&Boolean\(pdfDocument\)/);
  assert.doesNotMatch(page, /const canReview=Boolean\(record\)&&pageRendered/);
  assert.match(page, /if\(!pdfDocument\)\{setError\("The controlled document is not ready for review/);
  assert.match(page, /Previous page/);
  assert.match(page, /Next page/);
});

test("email-link Submit remains visible in review and gated by required fields, consent, and signing order", () => {
  assert.match(page, /\{reviewMode&&!signingClosed&&<section/);
  assert.match(page, /disabled=\{submitting\|\|!record\.canSign\|\|!pageRendered/);
  assert.doesNotMatch(page, /disabled=\{[^}]*incomplete\.length>0/);
  assert.match(page, /if\(incomplete\.length\)\{setError\("Complete all required assigned fields before submitting/);
  assert.match(page, /!declarations\.name\.trim\(\)\|\|!consent/);
  assert.match(page, /if\(!record\?\.canSign\)/);
  assert.match(page, /if\(incomplete\.length\)\{setError\("Complete all required assigned fields before submitting/);
  assert.match(gateway, /const can=\(e,s\)=>s\.status==="Pending"&&e\.signers\.every\(x=>x\.order>=s\.order\|\|x\.status==="Signed"\)/);
});

test("leaving an email signing session never redirects to the IRPA public website or app root", () => {
  assert.doesNotMatch(page, /window\.location\.(?:replace|assign)/);
  assert.doesNotMatch(page, /https:\/\/(?:www\.)?irpa\.or\.tz/);
  assert.match(page, /setLeftSession\(true\);/);
  assert.match(page, /Close this tab/);
  assert.match(page, /window\.close\(\)/);
});
