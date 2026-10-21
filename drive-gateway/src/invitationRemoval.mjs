export function createInvitationRemovalRouter(ctx) {
  return async function invitationRemovalRouter(request, env, pathname) {
    if (pathname !== "/api/invitations/remove" || request.method !== "POST") return null;
    const respond = (body, status = 200) => ctx.json(body, status, ctx.corsHeaders(request));
    try {
      const actor = await ctx.authenticateFirebaseRequest(request, env);
      const tokenPayload = decodeJwtPayload(actor.token);
      const actorEmail = String(actor.email || "").trim().toLowerCase();
      const adminAccessToken = await ctx.getFirestoreAdminAccessToken(env);
      let activeAdmin = tokenPayload.admin === true || actorEmail === "irpa2412@gmail.com";
      if (!activeAdmin) {
        const adminDocument = await ctx.getFirestoreDocument(env, `adminProfiles/${actor.user_id}`, adminAccessToken);
        activeAdmin = ctx.firestoreDocumentToPlain(adminDocument)?.active === true;
      }
      if (!activeAdmin) return respond({ ok: false, error: "Only an active IRPA Administrator can remove invitation records." }, 403);

      let body;
      try { body = await request.json(); } catch { return respond({ ok: false, error: "A valid invitation record is required." }, 400); }
      const invitationId = String(body?.invitationId || "").trim();
      if (!invitationId || invitationId.includes("/") || invitationId === "." || invitationId === "..") {
        return respond({ ok: false, error: "A valid invitation record is required." }, 400);
      }

      const projectId = ctx.getFirebaseProjectId(env);
      const base = `projects/${projectId}/databases/(default)/documents`;
      const invitationPath = `invitations/${invitationId}`;
      const invitation = await ctx.getFirestoreDocument(env, invitationPath, adminAccessToken);
      if (!invitation) return respond({ ok: false, error: "This invitation record no longer exists. Refresh the Invitation Register." }, 404);
      const record = ctx.firestoreDocumentToPlain(invitation) || {};
      if (String(record.meetingId || "").trim() || String(record.source || "").toLowerCase().includes("meeting participant")) {
        return respond({ ok: false, error: "This invitee is linked to a meeting. Remove the participant through the Meeting Participants portal so meeting access passes and attendance/quorum counts are revoked together." }, 409);
      }
      const status = String(record.status || "").trim().toLowerCase();
      if (record.accountActivated === true || ["activated", "accepted"].includes(status) || record.activationCompleted === true) {
        return respond({ ok: false, error: "This invitation is linked to an activated account and cannot be removed from the register. Retain the identity record and use the authorised account-deactivation process." }, 409);
      }
      if (!invitation.updateTime || !invitation.name) {
        console.error("Invitation removal refused: Firestore record lacks concurrency metadata.");
        return respond({ ok: false, error: "The invitation record could not be safely verified. Refresh the register and try again." }, 503);
      }

      const auditId = `invitation-remove-${Date.now()}-${crypto.randomUUID()}`;
      const auditFields = {
        action: { stringValue: "INVITATION_REGISTER_REMOVE" },
        collection: { stringValue: "invitations" },
        recordId: { stringValue: invitationId },
        details: { mapValue: { fields: {
          email: { stringValue: String(record.email || "").trim().toLowerCase() },
          statusBeforeRemoval: { stringValue: String(record.status || "Pending") },
          source: { stringValue: "ADMINISTRATOR_INVITATION_REGISTER" }
        } } },
        actorUid: { stringValue: actor.user_id },
        actorEmail: actorEmail ? { stringValue: actorEmail } : { nullValue: null },
        createdAt: { timestampValue: new Date().toISOString() }
      };
      const commit = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminAccessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ writes: [
          { delete: invitation.name, currentDocument: { updateTime: invitation.updateTime } },
          { update: { name: `${base}/audit/${auditId}`, fields: auditFields }, currentDocument: { exists: false } }
        ] })
      });
      if (commit.status === 409 || commit.status === 412) {
        return respond({ ok: false, error: "The invitation record changed while you were removing it. Refresh the register and try again." }, 409);
      }
      if (!commit.ok) {
        console.error("Invitation removal atomic commit failed", { status: commit.status });
        return respond({ ok: false, error: "The invitation could not be removed safely. No success was recorded; please try again." }, 503);
      }
      return respond({ ok: true, invitationId });
    } catch (error) {
      const message = String(error?.message || error);
      if (/authentication is required|invalid firebase|firebase token is expired/i.test(message)) {
        return respond({ ok: false, error: "Sign in again with your IRPA account before removing an invitation." }, 401);
      }
      console.error("Invitation removal gateway failure", { message: message.slice(0, 180) });
      return respond({ ok: false, error: "The invitation removal service is temporarily unavailable. Please try again." }, 503);
    }
  };
}

function decodeJwtPayload(token) {
  try {
    const encoded = String(token || "").split(".")[1];
    if (!encoded) return {};
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
  } catch {
    return {};
  }
}
