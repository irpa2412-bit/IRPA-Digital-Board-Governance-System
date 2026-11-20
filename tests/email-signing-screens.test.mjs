import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const platform = read("../src/pages/SignaturePlatform.jsx");
const emailPage = read("../src/pages/EmailSigningReadOnlyPage.jsx");
const pad = read("../src/components/SignatureFieldConfirmationPad.jsx");
const storage = read("../src/firebase/signatureStorage.js");
const pdf = read("../drive-gateway/src/pdf.mjs");
const paletteBrowser = read("./signature-palette-visibility.playwright.mjs");

test("envelope view supports resend-one and resend-all with per-signer status and EAT expiry", () => {
  assert.match(platform, /Send new link/);
  assert.match(platform, /Resend to all unsigned/);
  assert.match(platform, /resendAllGatewayEmailInvitations/);
  assert.match(platform, /confirmationText/);
  assert.match(platform, /expiresAtEAT/);
  assert.match(platform, /formatSigningEAT\(item\.linkExpiresAt\)/);
  assert.match(storage, /\/invitations\/resend-all/);
  assert.match(platform, /item\.status===\"Signed\"\|\|gatewayEmailStatus\?\.status===\"Completed\"/);
});

test("email signer has an explicit open action and preserves stage codes from preview, open and submit", () => {
  assert.match(emailPage, /Open document to sign/);
  assert.match(emailPage, /\/api\/sign\/email\/session/);
  assert.match(emailPage, /stageError/);
  assert.match(emailPage, /metadata\.code\|\|\"TOKEN_LOOKUP\"/);
  assert.match(emailPage, /result\.code\|\|\"SUBMIT\"/);
  assert.match(emailPage, /This document is already signed\./);
});

test("signing page displays invitation expiry in EAT and uses the Gateway timestamp for Date fields", () => {
  assert.match(emailPage, /formatExpiryEAT/);
  assert.match(emailPage, /Africa\/Dar_es_Salaam/);
  assert.match(emailPage, /SERVER_TIMESTAMP_PENDING/);
  assert.match(emailPage, /Confirm date & time \(EAT\)/);
  assert.match(pdf, /formatSigningTimestampEAT/);
  assert.match(pdf, /field\.type === \"Date\"[\s\S]{0,100}serverDateTime/);
  assert.match(pdf, /drawTextInField\(page, value, regular, fieldBox\)/);
});

test("unassigned fields are listed by page and field number with a reason, jump action and repair-draft save", () => {
  assert.match(platform, /Fields requiring repair/);
  assert.match(platform, /Page \{Number\(field\.page\|\|1\)\} · Field \{number\}/);
  assert.match(platform, /Reason: no signer was assigned/);
  assert.match(platform, /Reason: the assigned signer is no longer in this signing circle/);
  assert.match(platform, /Jump to field/);
  assert.match(platform, /async function repairDraft\(/);
  assert.match(platform, /onClick=\{repairDraft\}/);
  assert.match(platform, /selectedField,fields,pageNum/);
});

test("saved signature is directly usable from a persistent sticky footer", () => {
  assert.match(pad, /signature-confirmation-actions/);
  assert.match(pad, /position:\"sticky\"/);
  assert.match(pad, /Use this signature/);
  assert.match(pad, /confirmSavedSignature/);
  assert.match(pad, /position:\"fixed\"/);
});

test("responsive signing browser suite covers all four required viewport widths", () => {
  for (const width of [360, 412, 768, 1280]) assert.ok(paletteBrowser.includes("["+[360,412,768,1280].join(", ")+"]") || paletteBrowser.includes("["+[360,412,768,1280].join(",")+"]"));
  assert.match(paletteBrowser, /sticky saved-signature footer/);
  assert.match(paletteBrowser, /scrollWidth<=window\.innerWidth/);
});

test("existing PDF stamp engine retains placed field geometry and upright default orientation", () => {
  assert.match(pdf, /function drawFittedSignature\(page, image, fieldBox\)/);
  assert.match(pdf, /const geometry = getSignatureDrawGeometry\(image\.width, image\.height, fieldBox\)/);
  assert.match(pdf, /\.\.\.\(fieldBox\.rotation \? \{ rotate: degrees\(360 - fieldBox\.rotation\) \} : \{\}\)/);
  assert.match(pdf, /page\.drawImage\(image,\s*\{\s*\.\.\.geometry/);
});
