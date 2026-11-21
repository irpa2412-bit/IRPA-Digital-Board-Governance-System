import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const invitation = await readFile(new URL("../src/invitationEmail.mjs", import.meta.url), "utf8");
const signing = await readFile(new URL("../src/signing.mjs", import.meta.url), "utf8");
const ui = await readFile(new URL("../../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
const index = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const smtpDiagnostics = await readFile(new URL("../src/smtpDiagnostics.mjs", import.meta.url), "utf8");

test("production invitation path uses the legacy invitation builder, not the dormant rebuild module",()=>{
  assert.match(index,/sendEmailSigningInvitation\(\{email:to,name,link,title,ownerName,expiresAt,position/);
  const module = await readFile(new URL("../src/emailSigning/index.mjs", import.meta.url), "utf8");
  assert.match(module,/EMAIL_SIGNING_REBUILD_ENABLED\s*=\s*false/);
  assert.doesNotMatch(signing,/emailSigningModule\s*=\s*"v2"/);
});

test("signer-specific message builder emits first name, document title and position",()=>{
  assert.match(invitation,/const firstName=safeName\.split/);
  assert.match(invitation,/Position "\+signerPosition/);
  assert.match(invitation,/Message-ID/);
  assert.match(invitation,/@irpa\.or\.tz/);
  assert.match(invitation,/From: "\+cleanName/);
  assert.match(invitation,/Reply-To:/);
  assert.match(invitation,/multipart\/alternative/);
  assert.match(invitation,/text\/plain; charset=UTF-8/);
  assert.match(invitation,/text\/html; charset=UTF-8/);
});

test("delivery status exposes SMTP acceptance separately from inbox delivery and includes hand-off events",()=>{
  assert.match(signing,/function signerInvitationDelivery\(envelope,signer\)/);
  assert.match(signing,/Accepted by mail server/);
  assert.match(signing,/smtpReplyCode/);
  assert.match(signing,/email_link\.handoff\./);
  assert.match(signing,/recordEmailLinkHandoff\(ctx,id,previousSignerId,signer,"sent"\)/);
  assert.match(signing,/recordEmailLinkHandoff\(ctx,id,previousSignerId,signer,"failed"/);
});

test("envelope panel labels SMTP acceptance accurately and shows reply, stage, time and Message-ID",()=>{
  assert.match(ui,/Accepted by the mail server \(not Delivered\)/);
  assert.match(ui,/SMTP reply:/);
  assert.match(ui,/Last stage:/);
  assert.match(ui,/Message-ID:/);
  assert.match(ui,/Automatic hand-off:/);
});

test("copy and WhatsApp actions use the selected envelope and exact returned signer link",()=>{
  const copyStart=ui.indexOf("async function copySigningLink");
  const shareStart=ui.indexOf("async function shareSigningLinkWhatsApp");
  const revokeStart=ui.indexOf("async function revokeEmailLink",shareStart);
  assert.ok(copyStart>=0&&shareStart>copyStart&&revokeStart>shareStart);
  const copy=ui.slice(copyStart,shareStart);
  const share=ui.slice(shareStart,revokeStart);
  for(const source of [copy,share]){
    assert.match(source,/resendGatewayEmailInvitation\(selected\.gatewayEnvelopeId,signerId\)/);
    assert.match(source,/result\.signingLink/);
  }
  assert.match(copy,/navigator\.clipboard\.writeText\(link\)/);
  assert.match(share,/https:\/\/wa\.me\/\?text=/);
  assert.match(share,/encodeURIComponent\(shareText\)/);
  assert.match(ui,/blockedByEarlierSigner/);
});

test("SMTP self-check is recipient-selectable, owner/admin-gated and explicitly reports server acceptance only",()=>{
  assert.match(smtpDiagnostics,/validateRecipient\(body\?\.to\|\|body\?\.email\)/);
  assert.match(smtpDiagnostics,/role==="administrator"/);
  assert.match(smtpDiagnostics,/owner\)\s*\)/);
  assert.match(smtpDiagnostics,/acceptedByMailServer:true/);
  assert.match(smtpDiagnostics,/not proof of inbox delivery/);
  assert.match(smtpDiagnostics,/messageId/);
  assert.match(index,/smtpSelfCheck: async \(_user,body=\{\}\)/);
});
