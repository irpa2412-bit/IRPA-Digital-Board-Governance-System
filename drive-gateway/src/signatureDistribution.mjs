import {sha256Hex, validateEmail} from "./util.mjs";

const clean = value => String(value ?? "").trim();
const safeError = (error, email) => String(error?.message || "Email delivery failed.")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, "[recipient]")
  .replace(email || "\\u0000", "[recipient]")
  .slice(0, 240);

function recipientsFor(envelope) {
  const byEmail = new Map();
  const add = (email, name, uid, role, signerId = null) => {
    let normalized = "";
    try { normalized = validateEmail(email).trim().toLowerCase(); } catch {}
    const key = normalized || ("missing:" + String(uid || role || signerId || "recipient"));
    const current = byEmail.get(key) || {
      email: normalized,
      name: clean(name) || "IRPA participant",
      uid: uid || null,
      roles: [],
      signerIds: []
    };
    if (uid && !current.uid) current.uid = uid;
    if (role && !current.roles.includes(role)) current.roles.push(role);
    if (signerId && !current.signerIds.includes(signerId)) current.signerIds.push(signerId);
    byEmail.set(key, current);
  };
  add(envelope.ownerEmail || envelope.createdByEmail, envelope.ownerName, envelope.createdBy, "Document Owner");
  for (const signer of envelope.signers || []) {
    if (signer?.status === "Signed") {
      add(signer.email, signer.name, signer.uid, "Signer", signer.id);
    }
  }
  return [...byEmail.values()];
}

async function update(ctx, id, patch) {
  const current = await ctx.meta.get("signatureDistributions", id);
  if (!current) return;
  await ctx.meta.update("signatureDistributions", id, patch, {ifVersion: current._v});
}

export async function getSignatureDistributionSummary(ctx, envelopeId) {
  const rows = (await ctx.meta.list("signatureDistributions")).filter(row => row.envelopeId === envelopeId);
  const counts = {total: rows.length, sent: 0, failed: 0, pending: 0, sending: 0, unknown: 0};
  for (const row of rows) {
    if (row.status === "Sent") counts.sent++;
    else if (row.status === "Failed") counts.failed++;
    else if (row.status === "Sending") counts.sending++;
    else if (row.status === "Unknown") counts.unknown++;
    else counts.pending++;
  }
  return {
    ...counts,
    complete: counts.total > 0 && counts.sent === counts.total,
    deliveries: rows.map(row => ({
      recipientEmail: row.recipientEmail || "",
      recipientName: row.recipientName || "",
      recipientRoles: row.recipientRoles || [],
      status: row.status,
      attempts: Number(row.attempts || 0),
      lastError: row.lastError || null,
      sentAt: row.sentAt || null
    }))
  };
}

export async function distributeCompletedSignatureDocument(ctx, envelope, completion, {bytes = null, retryFailed = false} = {}) {
  if (envelope?.status !== "Completed" || !completion?.primaryStorageId || !completion?.finalHash) {
    throw new Error("Only a verified completed signature envelope can be distributed.");
  }
  const finalBytes = bytes || await ctx.storage.get(completion.primaryStorageId);
  if (!(finalBytes instanceof Uint8Array) || !finalBytes.length || await sha256Hex(finalBytes) !== completion.finalHash) {
    throw new Error("The authoritative completed PDF failed its integrity check; distribution was stopped.");
  }
  const recipients = recipientsFor(envelope);
  for (const recipient of recipients) {
    const emailHash = recipient.email ? await sha256Hex(recipient.email) : await sha256Hex("missing|" + envelope.id + "|" + (recipient.uid || recipient.roles.join(",")));
    const id = "delivery-" + envelope.id + "-" + emailHash.slice(0, 32);
    let record = await ctx.meta.get("signatureDistributions", id);
    if (!record) {
      const created = {
        envelopeId: envelope.id,
        externalReference: envelope.externalReference || null,
        documentId: envelope.documentId,
        recipientUid: recipient.uid,
        recipientEmail: recipient.email || "",
        recipientEmailHash: emailHash,
        recipientName: recipient.name,
        recipientRoles: recipient.roles,
        signerIds: recipient.signerIds,
        fileName: completion.fileName,
        finalHash: completion.finalHash,
        status: recipient.email ? "Pending" : "Failed",
        attempts: 0,
        lastError: recipient.email ? null : "RECIPIENT_EMAIL_MISSING",
        createdAt: ctx.now().toISOString()
      };
      try { await ctx.meta.create("signatureDistributions", id, created); }
      catch {
        record = await ctx.meta.get("signatureDistributions", id);
        if (!record) throw new Error("Unable to create the recipient distribution record.");
      }
      record = record || await ctx.meta.get("signatureDistributions", id);
    }
    if (!record || record.status === "Sent" || record.status === "Unknown" || record.status === "Sending") continue;
    if (record.status === "Failed" && !retryFailed && Number(record.attempts || 0) > 0) continue;
    if (!recipient.email) continue;
    if (typeof ctx.sendCompletionEmail !== "function") {
      await update(ctx, id, {status:"Failed", lastError:"EMAIL_TRANSPORT_NOT_CONFIGURED", lastAttemptAt:ctx.now().toISOString()});
      continue;
    }
    const attempts = Number(record.attempts || 0) + 1;
    await update(ctx, id, {status:"Sending", attempts, lastAttemptAt:ctx.now().toISOString(), lastError:null});
    try {
      const result = await ctx.sendCompletionEmail({
        to: recipient.email,
        name: recipient.name,
        recipientRoles: recipient.roles,
        title: envelope.title || completion.fileName,
        fileName: completion.fileName,
        completedAt: completion.completedAt,
        finalHash: completion.finalHash,
        bytes: finalBytes
      });
      await update(ctx, id, {
        status:"Sent",
        sentAt:ctx.now().toISOString(),
        messageId:clean(result?.messageId || result || "").slice(0, 180),
        lastError:null
      });
    } catch (error) {
      await update(ctx, id, {
        status:error?.deliveryOutcome === "unknown" ? "Unknown" : "Failed",
        failedAt:ctx.now().toISOString(),
        lastError:safeError(error, recipient.email)
      });
      ctx.logger?.error?.("SIGNATURE_COMPLETION_EMAIL_FAILED", {
        envelopeId: envelope.id,
        recipientDomain: recipient.email.split("@")[1] || "unknown",
        status: error?.deliveryOutcome === "unknown" ? "Unknown" : "Failed",
        attempt: attempts
      });
    }
  }
  return getSignatureDistributionSummary(ctx, envelope.id);
}

export async function retryFailedSignatureDistributions(ctx, user, envelopeId) {
  const envelope = await ctx.meta.get("envelopes", envelopeId);
  if (!envelope || (envelope.createdBy !== user?.uid && user?.isAdmin !== true)) {
    const error = new Error("Not authorized.");
    error.status = 403;
    throw error;
  }
  if (envelope.status !== "Completed" || !envelope.completion) {
    const error = new Error("Only completed documents can be redistributed.");
    error.status = 409;
    throw error;
  }
  const summary = await distributeCompletedSignatureDocument(ctx, envelope, envelope.completion, {retryFailed:true});
  return {ok:true, envelopeId, distribution:summary};
}
