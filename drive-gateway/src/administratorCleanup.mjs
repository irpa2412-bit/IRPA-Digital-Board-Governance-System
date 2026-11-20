const PRIMARY_ADMIN_EMAIL = "irpa2412@gmail.com";
const COLLECTIONS = Object.freeze([
  "members",
  "employees",
  "employeeCounters",
  "memberCounters",
  "participants",
  "meetings",
  "meetingSubscriptions",
  "meetingRoomEvents",
  "transcriptions",
  "resolutions",
  "votes",
  "voteLocks",
  "voteCorrections",
  "votingIssues",
  "actions",
  "documents",
  "documentTranslationRequests",
  "signatures",
  "decisions",
  "risks",
  "audit",
  "reports",
  "authorizationRequests",
  "workflowActions",
  "staffPaymentRequests",
  "financeBudgets",
  "financeTransactions",
  "financeFunding",
  "financeApprovals",
  "financeCommitments",
  "financeGrants",
  "financeBankAccounts",
  "financeReconciliations",
  "financeAssets",
  "financeRisks",
  "financeReports",
  "financeChartOfAccounts",
  "financeJournalBatches",
  "financePeriods",
  "financeLedgerJournals",
  "financeLedgerEntries",
  "financePaymentMatches",
  "financePaymentTrace",
  "financeReferenceRegistry",
  "procurementVendors",
  "procurementRequests",
  "procurementVendorScores",
  "procurementVendorBlacklist",
  "procurementVendorProbation",
  "invitations",
  "registrationRequests",
  "inductionRecords",
  "adminProfiles",
  "auditorProfiles",
  "systemSettings",
  "mail",
  "donorFunders",
  "grantReportingObligations",
  "researchStudies",
  "researchDatasets",
  "researchObservations",
  "researchAnalyses",
  "researchKnowledge",
  "researchOutputs",
  "researchInstruments",
  "researchSubmissions",
  "researchInformationRequests",
  "researchInformationGrants",
  "researchSharedInformation",
  "researchUpdates",
  "researchToolPermissions",
  "researchPortalAlerts",
  "institutionalDepartments",
  "departmentArchives",
  "signatureProfiles",
  "signerIdentities",
  "signatureEnvelopes",
  "signatureEvents",
  "controlledDocuments",
  "meetingInvitations",
  "meetingRecords",
  "meetingAttendanceSignatures",
  "meetingMediaRecordings",
  "liveMeetingSessions",
  "socialMediaAccounts",
  "socialMediaAccountsAudit",
  "communicationMediaAssets",
  "communicationMediaItems",
  "communicationSocialPosts",
  "communicationOperations",
  "portalDefinitions",
  "systemResetRequests",
  "dataResetRequests"
]);
const TTL_SECONDS = 60 * 60 * 24;
const clean = value => String(value ?? "").trim();
const idOf = doc => clean(doc?.name).split("/").pop();
const plain = doc => doc?.data || {};
const recordLabel = data => clean(data.fullName || data.displayName || data.name || data.title || data.documentTitle || data.email || data.uid); 
const isTrialRecord = data => data?.trialData === true || data?.isTrial === true || clean(data?.recordOrigin).toUpperCase() === "TRIAL";

export function createAdministratorCleanupRouter(deps) {
  const { authenticateFirebaseRequest, getFirestoreAdminAccessToken, getFirestoreDocument,
    getFirestoreCollectionDocuments, firestoreDocumentToPlain, getFirebaseAuthAdminAccessToken,
    listFirebaseAuthUsers, json, corsHeaders } = deps;

  async function authorize(request, env) {
    const claims = await authenticateFirebaseRequest(request, env);
    const uid = clean(claims.user_id || claims.uid);
    const email = clean(claims.email).toLowerCase();
    if (!uid || email !== PRIMARY_ADMIN_EMAIL || claims.emailVerified !== true || claims.firebaseClaims?.admin !== true) {
      throw Object.assign(new Error("The designated primary administrator must present a verified email and current Firebase administrator claim."), { status: 403 });
    }
    const token = await getFirestoreAdminAccessToken(env);
    const profileDoc = await getFirestoreDocument(env, "adminProfiles/" + uid, token);
    const profile = firestoreDocumentToPlain(profileDoc) || {};
    if (profile.active !== true || clean(profile.role).toLowerCase() !== "administrator") {
      throw Object.assign(new Error("The primary administrator must have an active adminProfiles record."), { status: 403 });
    }
    return { claims, uid, email, token };
  }

  async function loadInventory(env, auth) {
    const authToken = await getFirebaseAuthAdminAccessToken(env);
    const users = await listFirebaseAuthUsers(env, authToken);
    const authByUid = new Map(users.map(user => [clean(user.localId || user.uid), user]));
    const authByEmail = new Map(users.map(user => [clean(user.email).toLowerCase(), user]).filter(([email]) => email));
    const collectionResults = [];
    for (let offset = 0; offset < COLLECTIONS.length; offset += 8) {
      const batch = COLLECTIONS.slice(offset, offset + 8);
      const results = await Promise.all(batch.map(async collection => [collection, await getFirestoreCollectionDocuments(env, collection, auth.token)]));
      collectionResults.push(...results);
    }
    const envelopes = new Map(collectionResults.find(([name]) => name === "signatureEnvelopes")[1]
      .map(doc => [idOf(doc), firestoreDocumentToPlain(doc) || {}]));
    const records = [];
    for (const [collection, docs] of collectionResults) {
      for (const doc of docs) {
        const data = firestoreDocumentToPlain(doc) || {};
        const id = idOf(doc);
        const email = clean(data.email || data.ownerEmail || data.signerEmail).toLowerCase();
        const authUser = authByUid.get(clean(data.uid || data.userId || data.memberUid || data.ownerUid || data.signerUid)) || authByEmail.get(email);
        const uid = clean(data.uid || data.userId || data.memberUid || data.ownerUid || data.signerUid || authUser?.localId || authUser?.uid);
        const signerInProtectedEnvelope = collection === "members" || collection === "employees" || collection === "signatureProfiles" || collection === "signerIdentities"
          ? [...envelopes.values()].some(envelope => ["signed","completed","in progress","inprogress","signing"].includes(clean(envelope.status).toLowerCase()) &&
            (Array.isArray(envelope.signers) ? envelope.signers : []).some(signer =>
              (uid && clean(signer.uid || signer.profileUid) === uid) ||
              (email && clean(signer.email).toLowerCase() === email)))
          : false;
        const role = clean(data.role || data.boardPosition || data.designation || data.jobTitle);
        const roleValues = [data.role, data.boardPosition, data.designation, data.jobTitle, data.title, data.position,
          ...(Array.isArray(data.roles) ? data.roles : []), ...(Array.isArray(data.assignedRoles) ? data.assignedRoles : []),
          ...(Array.isArray(data.selectedRoles) ? data.selectedRoles : [])].map(value => clean(value)).filter(Boolean);
        const protectedRole = roleValues.some(value => /administrator|executive director|board chair|chairperson|board secretary/i.test(value));
        const isAdmin = uid === auth.uid;
        const trialData = isTrialRecord(data);
        const isSignedTrial = collection === "signatureEnvelopes" && trialData &&
          ["completed","signed"].includes(clean(data.status).toLowerCase());
        const immutableHistory = collection === "audit" || collection === "signatureEvents";
        const protectedRecord = isAdmin || protectedRole || signerInProtectedEnvelope || immutableHistory;
        records.push({
          key: collection + "/" + id, collection, id, version: clean(doc.updateTime || doc.createTime), uid: uid || null,
          name: recordLabel(data) || id, email: clean(data.email || data.ownerEmail || data.signerEmail),
          registerType: collection === "members" ? "Member Register" : collection === "employees" ? "Employee Register" :
            collection === "auditorProfiles" ? "External Profile" : collection === "signatureProfiles" ? "Signature Profile" : collection,
          role, createdAt: data.createdAt || data.createdDate || data.timestamp || null,
          status: clean(data.status || data.registrationStatus || data.employmentStatus),
          authAccountPresent: Boolean(authUser),
          recordOrigin: clean(data.recordOrigin || data.source || ""),
          trialData,
          signedTrialDocument: isSignedTrial,
          signedPdfReference: isSignedTrial ? clean(data.signedPdfReference || data.signedFileId || data.driveFileId) || null : null,
          protected: protectedRecord,
          protectionReason: isAdmin ? "Signed-in administrator cannot be removed." :
            protectedRole ? "Protected governance or administrator role." :
            signerInProtectedEnvelope ? "Signer on a signed or in-progress envelope." :
            immutableHistory ? "Immutable audit/signature history must be retained." : "",
          decision: "STAYS"
        });
      }
    }
    return records;
  }

  return async function administratorCleanupRouter(request, env, pathname) {
    if (!pathname.startsWith("/api/admin/cleanup/")) return null;
    let auth;
    try {
      auth = await authorize(request, env);
      if (pathname === "/api/admin/cleanup/inventory" && request.method === "GET") {
        const records = await loadInventory(env, auth);
        const inventoryId = crypto.randomUUID();
        const snapshot = { inventoryId, createdAt: new Date().toISOString(), administratorUid: auth.uid,
          administratorEmail: auth.email, records, status: "INVENTORY_READY", mandatoryBeforeReset: true };
        const serializedSnapshot = JSON.stringify(snapshot);
        if (new TextEncoder().encode(serializedSnapshot).byteLength > 20 * 1024 * 1024) {
          return json({ok:false,code:"INVENTORY_TOO_LARGE",error:"The complete inventory exceeds the safe single-snapshot storage limit. No cleanup plan was created; inventory must be safely partitioned before proceeding."},413,corsHeaders(request));
        }
        await env.DRIVE_KV.put("admin-cleanup:inventory:" + inventoryId, serializedSnapshot, { expirationTtl: TTL_SECONDS });
        return json({ ok: true, ...snapshot, summary: { total: records.length, stays: records.length, goes: 0,
          protected: records.filter(row => row.protected).length } }, 200, corsHeaders(request));
      }
      if (pathname === "/api/admin/cleanup/plan" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const inventoryId = clean(body.inventoryId);
        if (!inventoryId) return json({ ok:false,error:"A completed inventory is mandatory before preparing a cleanup plan." },409,corsHeaders(request));
        const raw = await env.DRIVE_KV.get("admin-cleanup:inventory:" + inventoryId);
        if (!raw) return json({ok:false,error:"Inventory not found or expired. Take a fresh inventory."},409,corsHeaders(request));
        const inventory = JSON.parse(raw);
        if (inventory.administratorUid !== auth.uid) return json({ok:false,error:"Inventory belongs to a different administrator session."},403,corsHeaders(request));
        const selections = Array.isArray(body.selections) ? body.selections : [];
        const selectionKeys = selections.map(item => clean(item?.key));
        if (selectionKeys.some(key => !key) || new Set(selectionKeys).size !== selectionKeys.length) {
          return json({ok:false,error:"Every inventory row may be selected only once; duplicate or empty selection keys are rejected."},400,corsHeaders(request));
        }
        if (selections.some(item => !["STAYS","GOES"].includes(clean(item?.decision).toUpperCase()))) {
          return json({ok:false,error:"Each selected record must have an explicit STAYS or GOES decision."},400,corsHeaders(request));
        }
        const byKey = new Map(selections.map(item => [clean(item.key), clean(item.decision).toUpperCase()]));
        const records = inventory.records.map(row => {
          const requested = byKey.get(row.key);
          const decision = requested === "GOES" && !row.protected ? "GOES" : "STAYS";
          return { ...row, decision };
        });
        const unknown = [...byKey.keys()].filter(key => !inventory.records.some(row => row.key === key));
        if (unknown.length) return json({ok:false,error:"Selection contains records outside the inventory.",unknown},400,corsHeaders(request));
        const planId = crypto.randomUUID();
        const plan = { planId, inventoryId, createdAt: new Date().toISOString(), administratorUid: auth.uid,
          administratorEmail: auth.email, records, typedConfirmationRequired: "DELETE", status: "AWAITING_REVIEW",
          mandatoryInventoryComplete: true };
        await env.DRIVE_KV.put("admin-cleanup:plan:" + planId, JSON.stringify(plan), {expirationTtl:TTL_SECONDS});
        return json({ok:true,...plan,summary:{total:records.length,stays:records.filter(r=>r.decision==="STAYS").length,
          goes:records.filter(r=>r.decision==="GOES").length,blocked:records.filter(r=>r.protected).length}},200,corsHeaders(request));
      }
      const planMatch = pathname.match(/^\/api\/admin\/cleanup\/plan\/([A-Za-z0-9-]+)$/);
      if (planMatch && request.method === "GET") {
        const raw = await env.DRIVE_KV.get("admin-cleanup:plan:" + planMatch[1]);
        if (!raw) return json({ok:false,error:"Cleanup plan not found or expired."},404,corsHeaders(request));
        const plan = JSON.parse(raw);
        if (plan.administratorUid !== auth.uid) return json({ok:false,error:"Cleanup plan belongs to a different administrator."},403,corsHeaders(request));
        return json({ok:true,...plan},200,corsHeaders(request));
      }
      if (pathname.startsWith("/api/admin/cleanup/status/") && request.method === "GET") {
        const planId = pathname.split("/").pop();
        const raw = await env.DRIVE_KV.get("admin-cleanup:plan:" + planId);
        if (!raw) return json({ok:false,error:"Cleanup status not found or expired."},404,corsHeaders(request));
        const plan = JSON.parse(raw);
        if (plan.administratorUid !== auth.uid) return json({ok:false,error:"Cleanup plan belongs to a different administrator."},403,corsHeaders(request));
        return json({ok:true,planId:plan.planId,status:plan.status,inventoryId:plan.inventoryId,stays:plan.records.filter(row=>row.decision==="STAYS").length,goes:plan.records.filter(row=>row.decision==="GOES").length,executionEnabled:false},200,corsHeaders(request));
      }
      if (pathname.startsWith("/api/admin/cleanup/backup/") && request.method === "GET") {
        const planId = pathname.split("/").pop();
        const raw = await env.DRIVE_KV.get("admin-cleanup:plan:" + planId);
        if (!raw) return json({ok:false,error:"Cleanup backup not found or expired."},404,corsHeaders(request));
        const plan = JSON.parse(raw);
        if (plan.administratorUid !== auth.uid) return json({ok:false,error:"Cleanup backup belongs to a different administrator."},403,corsHeaders(request));
        return json({ok:true,backup:{planId:plan.planId,inventoryId:plan.inventoryId,createdAt:plan.createdAt,administratorUid:plan.administratorUid,administratorEmail:plan.administratorEmail,selections:plan.records.map(row=>({key:row.key,collection:row.collection,recordId:row.id,name:row.name,email:row.email,decision:row.decision,protected:row.protected,protectionReason:row.protectionReason,linkedIdentityUid:row.uid,signedPdfReference:row.signedPdfReference})),operationOutcomes:[],status:plan.status}},200,corsHeaders(request));
      }
      if (pathname === "/api/admin/cleanup/execute" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const planId = clean(body.planId);
        const raw = planId ? await env.DRIVE_KV.get("admin-cleanup:plan:" + planId) : null;
        if (!raw) return json({ok:false,error:"A valid inventory-backed cleanup plan is required."},409,corsHeaders(request));
        const plan = JSON.parse(raw);
        if (plan.administratorUid !== auth.uid) return json({ok:false,error:"Cleanup plan belongs to a different administrator."},403,corsHeaders(request));
        if (body.confirmation !== "DELETE") return json({ok:false,error:"Type DELETE exactly to confirm the reviewed cleanup plan."},400,corsHeaders(request));
        return json({ok:false,code:"EXECUTOR_NOT_READY",error:"Execution is locked. The inventory and review gate is active, but destructive record handlers must pass staging acceptance before any reset can run.",planId},423,corsHeaders(request));
      }
      return json({ok:false,error:"Method not allowed or cleanup route not found."},405,corsHeaders(request));
    } catch (error) {
      return json({ok:false,error:String(error?.message || "Administrator cleanup request failed.")},
        Number(error?.status || 0) || 500,corsHeaders(request));
    }
  };
}
