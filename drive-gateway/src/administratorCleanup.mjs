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
  "adminProfiles","adminCleanupAudit",
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
    listFirebaseAuthUsers, getFirebaseProjectId, getDriveAccessToken, findOrCreateFolder, driveFetch,
    json, corsHeaders } = deps;
  const fetchImpl = deps.fetch || fetch;
  const projectIdFor = env => getFirebaseProjectId ? getFirebaseProjectId(env) : String(env.FIREBASE_PROJECT_ID || "");

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
          ? [...envelopes.values()].some(envelope => {
            const protectedEnvelopeStatus = ["signed","completed","in progress","inprogress","signing","pending","sent","opened","awaiting signature","awaiting_signature"].includes(clean(envelope.status).toLowerCase());
            return (Array.isArray(envelope.signers) ? envelope.signers : []).some(signer => {
              const matches = (uid && clean(signer.uid || signer.profileUid) === uid) ||
                (email && clean(signer.email).toLowerCase() === email);
              return matches && (protectedEnvelopeStatus || clean(signer.status).toLowerCase() === "signed");
            });
          })
          : false;
        const role = clean(data.role || data.boardPosition || data.designation || data.jobTitle);
        const roleValues = [data.role, data.boardPosition, data.designation, data.jobTitle, data.title, data.position,
          ...(Array.isArray(data.roles) ? data.roles : []), ...(Array.isArray(data.assignedRoles) ? data.assignedRoles : []),
          ...(Array.isArray(data.selectedRoles) ? data.selectedRoles : [])].map(value => clean(value)).filter(Boolean);
        const protectedRole = roleValues.some(value => /administrator|executive director|board chair|chairperson|board secretary/i.test(value));
        const isAdmin = uid === auth.uid || email === PRIMARY_ADMIN_EMAIL;
        const trialData = isTrialRecord(data);
        const isSignedTrial = collection === "signatureEnvelopes" && trialData &&
          ["completed","signed"].includes(clean(data.status).toLowerCase());
        const immutableHistory = collection === "audit" || collection === "signatureEvents" || collection === "adminCleanupAudit";
        const envelopeStatus = clean(data.status).toLowerCase();
        const signedEnvelope = collection === "signatureEnvelopes" && ["signed","completed"].includes(envelopeStatus);
        const signedProductionEnvelope = signedEnvelope && !trialData;
        const missingTrialPdf = isSignedTrial && !clean(data.signedPdfReference || data.signedFileId || data.driveFileId);
        const linkedEnvelopeId = clean(data.envelopeId || data.gatewayEnvelopeId);
        const linkedEnvelope = linkedEnvelopeId ? envelopes.get(linkedEnvelopeId) : null;
        const signedProductionPortalRecord = ["signatures","documents","controlledDocuments"].includes(collection) &&
          linkedEnvelope && signedState(linkedEnvelope.status) && !isTrialRecord(linkedEnvelope);
        const protectedRecord = isAdmin || protectedRole || signerInProtectedEnvelope || immutableHistory ||
          signedProductionEnvelope || missingTrialPdf || signedProductionPortalRecord;
        records.push({
          key: collection + "/" + id, collection, id, version: clean(doc.updateTime || doc.createTime), uid: uid || null,
          name: recordLabel(data) || id, email: clean(data.email || data.ownerEmail || data.signerEmail),
          registerType: collection === "members" ? "Member Register" : collection === "employees" ? "Employee Register" :
            collection === "auditorProfiles" ? "External Profile" : collection === "signatureProfiles" ? "Signature Profile" : collection,
          role, createdAt: data.createdAt || data.createdDate || data.timestamp || doc.createTime || null,
          status: clean(data.status || data.registrationStatus || data.employmentStatus) ||
            (trialData ? "Trial/test" : authUser ? (authUser.disabled ? "Disabled" : "Active") : collection === "invitations" ? "Invited" : ""),
          authAccountPresent: Boolean(authUser),
          authCreatedAt: authUser?.createdAt || null,
          authDisplayName: authUser?.displayName || null,
          authDisabled: authUser?.disabled === true,
          authEmailVerified: authUser?.emailVerified === true,
          recordOrigin: clean(data.recordOrigin || data.source || ""),
          trialData,
          signedTrialDocument: isSignedTrial,
          signedPdfReference: isSignedTrial ? clean(data.signedPdfReference || data.signedFileId || data.driveFileId) || null : null,
          relationshipRefs: [...new Set([
            data.meetingId, data.documentId, data.envelopeId, data.gatewayEnvelopeId, data.signatureEnvelopeId, data.invitationId,
            data.memberUid, data.employeeUid, data.participantUid, data.subscriberUid, data.ownerUid,
            data.uid, data.userId, data.memberId, data.employeeId, data.participantId, data.signerUid,
            data.email, data.ownerEmail, data.signerEmail,
            ...(Array.isArray(data.participantUids) ? data.participantUids : []),
            ...(Array.isArray(data.attendeeUids) ? data.attendeeUids : []),
            ...(Array.isArray(data.memberUids) ? data.memberUids : []),
            ...(Array.isArray(data.invitedUids) ? data.invitedUids : []),
            ...(Array.isArray(data.subscriberUids) ? data.subscriberUids : []),
            ...(Array.isArray(data.signers) ? data.signers.flatMap(signer => [signer.uid, signer.profileUid, signer.email]) : [])
          ].map(value => clean(value).toLowerCase()).filter(Boolean))],
          protected: protectedRecord,
          protectionReason: isAdmin ? "Signed-in administrator cannot be removed." :
            protectedRole ? "Protected governance or administrator role." :
            signerInProtectedEnvelope ? "Signer on a signed or in-progress envelope." :
            immutableHistory ? "Immutable audit/signature history must be retained." :
            signedProductionEnvelope ? "Completed production signing envelopes must be retained." :
            missingTrialPdf ? "Signed trial PDF reference is missing; safe deletion cannot be verified." :
            signedProductionPortalRecord ? "Portal record belongs to a completed production signing envelope." : "",
          decision: "STAYS", sourceDocument: doc
        });
      }
    }
    const lookup = new Map();
    for (const row of records) {
      for (const identifier of [row.id, row.uid, row.email, row.key].map(value => clean(value).toLowerCase()).filter(Boolean)) {
        if (!lookup.has(identifier)) lookup.set(identifier, new Set());
        lookup.get(identifier).add(row.key);
      }
    }
    const reverseLinks = new Map();
    for (const row of records) {
      for (const ref of row.relationshipRefs || []) {
        for (const linkedKey of lookup.get(ref) || []) {
          if (linkedKey === row.key) continue;
          if (!reverseLinks.has(linkedKey)) reverseLinks.set(linkedKey, new Set());
          reverseLinks.get(linkedKey).add(row.key);
        }
      }
    }
    return records.map(row => {
      const linked = new Set(reverseLinks.get(row.key) || []);
      for (const ref of row.relationshipRefs || []) for (const key of lookup.get(ref) || []) if (key !== row.key) linked.add(key);
      const { relationshipRefs, ...safeRow } = row;
      return { ...safeRow, linkedRecordKeys: [...linked].sort(), dependencyCount: linked.size };
    });
  }

 
  function dataOf(row) { return firestoreDocumentToPlain(row?.sourceDocument) || {}; }
  function firestorePath(collection, id) { return collection + "/" + id; }
  function pendingInvitation(row) {
    const data = dataOf(row);
    const status = clean(data.status || data.invitationStatus || data.state).toLowerCase();
    const redemption = clean(data.invitationRedemptionState || data.redemptionState).toUpperCase();
    return ["pending","invited","sent","queued","created","awaiting activation","awaiting_activation"].includes(status) &&
      redemption !== "ACTIVATED" && data.accountActivated !== true;
  }
  function signedState(value) { return ["signed","completed"].includes(clean(value).toLowerCase()); }
  function unsentEnvelope(value) { return !["signed","completed","in progress","inprogress","signing"].includes(clean(value).toLowerCase()); }
  function scrubBackup(value, key = "") {
    if (/password|secret|token|credential|private.?key|api.?key|authorization|refresh.?token/i.test(key)) return "[REDACTED]";
    if (Array.isArray(value)) return value.map(item => scrubBackup(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, scrubBackup(v,k)]));
    return value;
  }
  function firestoreValue(value) {
    if (value === null || value === undefined) return {nullValue:null};
    if (typeof value === "string") return {stringValue:value};
    if (typeof value === "boolean") return {booleanValue:value};
    if (typeof value === "number") return Number.isInteger(value) ? {integerValue:String(value)} : {doubleValue:value};
    if (Array.isArray(value)) return {arrayValue:{values:value.map(firestoreValue)}};
    return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,firestoreValue(v)]))}};
  }
  function buildOperations(inventory, requested) {
    const byKey = new Map(inventory.records.map(row => [row.key, {...row, decision:"STAYS", decisionSource:"DEFAULT"}]));
    const selection = new Map(requested.map(item => [clean(item.key), clean(item.decision).toUpperCase()]));
    for (const [key, decision] of selection) {
      const row = byKey.get(key);
      if (row && decision === "GOES" && !row.protected) { row.decision = "GOES"; row.decisionSource = "ADMIN_SELECTION"; }
    }
    const operations = [];
    const operationIds = new Set();
    const blockers = [];
    const add = operation => {
      const id = operation.type + ":" + (operation.type === "update-signers" ? (operation.key + ":" + (operation.uid || operation.email || "")) : (operation.key || operation.uid || operation.fileId || ""));
      if (operationIds.has(id)) return;
      operationIds.add(id);
      operations.push({operationId:id,...operation});
    };
    const cascadeDelete = row => {
      if (!row || row.protected) return;
      row.decision = "GOES";
      row.decisionSource = "APPROVED_CASCADE";
      add({type:"firestore-delete",key:row.key,path:firestorePath(row.collection,row.id),version:row.version,reason:"Approved related-record cleanup"});
    };
    for (const row of [...byKey.values()].filter(item => item.decision === "GOES" && item.decisionSource === "ADMIN_SELECTION")) {
      const data = dataOf(row);
      if (row.collection === "members" || row.collection === "employees") {
        add({type:"firestore-delete",key:row.key,path:firestorePath(row.collection,row.id),version:row.version,reason:"Administrator-selected register record"});
        const uid = clean(row.uid);
        const email = clean(row.email).toLowerCase();
        for (const invitation of byKey.values()) {
          if (invitation.collection !== "invitations" || !pendingInvitation(invitation)) continue;
          const invite = dataOf(invitation);
          const inviteUid = clean(invite.uid || invite.userId || invite.memberUid);
          const inviteEmail = clean(invite.email || invite.recipientEmail).toLowerCase();
          if ((uid && inviteUid === uid) || (email && inviteEmail === email)) cascadeDelete(invitation);
        }
        if (row.authAccountPresent && uid) add({type:"auth-delete",key:row.key,uid,email,reason:"Approved member-account cascade"});
        for (const envelope of byKey.values()) {
          if (envelope.collection !== "signatureEnvelopes") continue;
          const envelopeData = dataOf(envelope);
          if (!unsentEnvelope(envelopeData.status)) continue;
          const signers = Array.isArray(envelopeData.signers) ? envelopeData.signers : [];
          const hasUnsentAssignment = signers.some(signer => {
            const matches = (uid && clean(signer.uid || signer.profileUid) === uid) ||
              (email && clean(signer.email).toLowerCase() === email);
            return matches && clean(signer.status).toLowerCase() !== "signed";
          });
          if (hasUnsentAssignment) add({type:"update-signers",key:envelope.key,path:firestorePath(envelope.collection,envelope.id),
            version:envelope.version,uid,email,reason:"Remove unsent signing assignment for deleted member"});
        }
        continue;
      }
      if (row.collection === "signatureEnvelopes" && row.signedTrialDocument) {
        const fileId = clean(row.signedPdfReference);
        if (!fileId) { blockers.push(row.key + ": signed trial PDF reference is missing"); continue; }
        const envelopeData = dataOf(row);
        const envelopeDocumentId = clean(envelopeData.documentId);
        const portalRows = (row.linkedRecordKeys || []).map(key => byKey.get(key)).filter(candidate =>
          candidate && (candidate.collection === "signatures" ||
            (["documents","controlledDocuments"].includes(candidate.collection) &&
              (candidate.id === envelopeDocumentId || candidate.trialData || isTrialRecord(dataOf(candidate))))));
        if (!portalRows.length) { blockers.push(row.key + ": associated trial-document portal record was not found"); continue; }
        add({type:"drive-delete",key:row.key,fileId,reason:"Delete explicitly selected signed trial PDF"});
        add({type:"firestore-delete",key:row.key,path:firestorePath(row.collection,row.id),version:row.version,reason:"Delete explicitly selected signed trial envelope"});
        for (const portalRow of portalRows) cascadeDelete(portalRow);
        continue;
      }
      add({type:"firestore-delete",key:row.key,path:firestorePath(row.collection,row.id),version:row.version,reason:"Administrator-selected record"});
    }
    const priority = operation => {
      if (operation.type === "update-signers") return 1;
      if (operation.type === "drive-delete") return 2;
      if (operation.type === "firestore-delete" && operation.key.startsWith("invitations/")) return 3;
      if (operation.type === "firestore-delete" && operation.key.startsWith("signatureEnvelopes/")) return 4;
      if (operation.type === "firestore-delete" && ["signatures/","documents/","controlledDocuments/"].some(prefix=>operation.key.startsWith(prefix))) return 5;
      if (operation.type === "auth-delete") return 6;
      if (operation.type === "firestore-delete" && /^(members|employees)\//.test(operation.key)) return 7;
      return 5;
    };
    operations.sort((a,b)=>priority(a)-priority(b));
    return {records:[...byKey.values()].map(({sourceDocument,...row})=>row),operations,blockers};
  }
  async function writeAuditEvent(env, token, event) {
    const id = clean(event.planId) + "-" + clean(event.eventType).toLowerCase() + "-" + crypto.randomUUID();
    const fields = Object.fromEntries(Object.entries(event).map(([key,value])=>[key,firestoreValue(value)]));
    const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(projectIdFor(env)) +
      "/databases/(default)/documents/adminCleanupAudit?documentId=" + encodeURIComponent(id);
    const response = await fetchImpl(url,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({fields})});
    if (!response.ok) throw new Error("Cleanup audit event could not be persisted (HTTP " + response.status + ").");
    return "adminCleanupAudit/" + id;
  }
  async function listSubcollections(env, token, path) {
    const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(projectIdFor(env)) +
      "/databases/(default)/documents/" + path.split("/").map(encodeURIComponent).join("/") + ":listCollectionIds";
    const response = await fetchImpl(url,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({pageSize:100})});
    if (!response.ok) throw new Error("Unable to verify nested Firestore records for " + path + " (HTTP " + response.status + ").");
    const body = await response.json().catch(()=>({}));
    if (body.nextPageToken) throw new Error("Nested Firestore collection listing is incomplete for " + path + "; cleanup is blocked.");
    return Array.isArray(body.collectionIds) ? body.collectionIds : [];
  }
  async function firestoreGet(env, token, path) {
    const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(projectIdFor(env)) +
      "/databases/(default)/documents/" + path.split("/").map(encodeURIComponent).join("/");
    const response = await fetchImpl(url,{headers:{Authorization:"Bearer "+token}});
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Firestore revalidation failed for " + path + " (HTTP " + response.status + ").");
    return response.json();
  }
  async function firestoreDelete(env, token, path, expectedVersion) {
    const current = await firestoreGet(env,token,path);
    if (!current) return "ALREADY_DELETED";
    if (expectedVersion && clean(current.updateTime) !== expectedVersion) throw new Error("Record changed after inventory: " + path);
    const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(projectIdFor(env)) +
      "/databases/(default)/documents/" + path.split("/").map(encodeURIComponent).join("/");
    const response = await fetchImpl(url,{method:"DELETE",headers:{Authorization:"Bearer "+token}});
    if (response.status === 404) return "ALREADY_DELETED";
    if (!response.ok) throw new Error("Firestore delete failed for " + path + " (HTTP " + response.status + ").");
    return "DELETED";
  }
  async function uploadBackup(env, plan, inventory, auth, driveToken) {
    const folderId = await findOrCreateFolder(env,driveToken,"IRPA Governance System - Cleanup Backups",null,{irpaGovernanceBackup:true,kind:"administrator-cleanup"});
    const driveFileCopies = [];
    const fileIds = new Set();
    for (const row of plan.records.filter(item=>item.decision==="GOES")) {
      const data = dataOf(inventory.records.find(item=>item.key===row.key));
      for (const value of [row.signedPdfReference,data.fileId,data.driveFileId,data.signedFileId,data.storageFileId,data.fileReference]) {
        const id = clean(value);
        if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) fileIds.add(id);
      }
    }
    for (const fileId of fileIds) {
      const copied = await driveFetch(env,driveToken,"/drive/v3/files/"+encodeURIComponent(fileId)+"/copy?fields=id,name,webViewLink",{
        method:"POST",body:JSON.stringify({name:"IRPA-Cleanup-Backup-"+plan.planId+"-"+fileId,parents:[folderId]})
      });
      if (!copied.id) throw new Error("Drive backup copy did not return a file ID; no records were deleted.");
      driveFileCopies.push({originalFileId:fileId,backupFileId:copied.id,name:copied.name || "",webViewLink:copied.webViewLink || ""});
    }
    const archive = {
      schemaVersion:1,createdAt:new Date().toISOString(),planId:plan.planId,inventoryId:plan.inventoryId,
      administrator:{uid:auth.uid,email:auth.email},scope:{collections:COLLECTIONS,selected:plan.records.filter(row=>row.decision==="GOES").map(row=>row.key)},
      records:inventory.records.map(row=>({key:row.key,collection:row.collection,id:row.id,version:row.version,
        decision:plan.records.find(item=>item.key===row.key)?.decision || "STAYS",
        decisionSource:plan.records.find(item=>item.key===row.key)?.decisionSource || "DEFAULT",
        protected:row.protected,protectionReason:row.protectionReason,linkedRecordKeys:row.linkedRecordKeys,
        document:scrubBackup(row.sourceDocument)})),
      operations:plan.executionOperations,operationOutcomes:plan.operationOutcomes || [],
      auditRefs:inventory.records.filter(row=>["audit","signatureEvents","adminCleanupAudit"].includes(row.collection)).map(row=>row.key),
      driveFileCopies
    };
    const archiveText = JSON.stringify(archive);
    const metadata = {name:"IRPA-DBGS-Cleanup-"+plan.planId+".json",mimeType:"application/json",parents:[folderId],description:"Administrator-controlled cleanup backup; includes full inventory, record snapshots, decisions, dependency references and operation state."};
    const form = new FormData();
    form.append("metadata",new Blob([JSON.stringify(metadata)],{type:"application/json"}));
    form.append("file",new Blob([archiveText],{type:"application/json"}));
    const response = await fetchImpl("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",{
      method:"POST",headers:{Authorization:"Bearer "+driveToken},body:form
    });
    const result = await response.json().catch(()=>({}));
    if (!response.ok || !result.id) throw new Error("Durable Drive backup creation failed (HTTP " + response.status + "). No records were deleted.");
    return {fileId:result.id,url:result.webViewLink || "https://drive.google.com/file/d/"+result.id+"/view",folderId,driveFileCopies,archive};
  }
  async function updateBackup(env, plan, driveToken) {
    const archive = JSON.stringify(plan.backupArchive);
    const response = await fetchImpl("https://www.googleapis.com/upload/drive/v3/files/"+encodeURIComponent(plan.backupDriveFileId)+"?uploadType=media",{
      method:"PATCH",headers:{Authorization:"Bearer "+driveToken,"Content-Type":"application/json"},body:archive
    });
    if (!response.ok) throw new Error("Cleanup backup outcome update failed (HTTP " + response.status + ").");
  }
  async function revalidatePlan(env, auth, plan, inventory) {
    const freshRecords = await loadInventory(env,auth);
    const freshByKey = new Map(freshRecords.map(row=>[row.key,row]));
    for (const row of plan.records.filter(item=>item.decision==="GOES")) {
      const fresh = freshByKey.get(row.key);
      if (!fresh || !row.version || fresh.version !== row.version) throw Object.assign(new Error("Inventory is stale for " + row.key + ". Take a fresh inventory and review the plan again."),{status:409});
      if (fresh.protected) throw Object.assign(new Error("Protection state changed for " + row.key + ". Cleanup was stopped."),{status:409});
      if (JSON.stringify([...(fresh.linkedRecordKeys||[])].sort()) !== JSON.stringify([...(row.linkedRecordKeys||[])].sort())) {
        throw Object.assign(new Error("Record dependencies changed for " + row.key + ". Take a fresh inventory and review the plan again."),{status:409});
      }
    }
    const authOperations = plan.executionOperations.filter(item=>item.type==="auth-delete");
    if (authOperations.length) {
      const authToken = await getFirebaseAuthAdminAccessToken(env);
      const authUsers = await listFirebaseAuthUsers(env,authToken);
      for (const operation of authOperations) {
        const account = authUsers.find(user=>clean(user.localId || user.uid)===operation.uid);
        if (account && operation.email && clean(account.email).toLowerCase()!==operation.email) {
          throw Object.assign(new Error("Firebase Auth UID/email binding changed for " + operation.key + ". Cleanup was stopped."),{status:409});
        }
      }
    }
    for (const operation of plan.executionOperations.filter(item=>["firestore-delete","update-signers"].includes(item.type))) {
      const fresh = freshByKey.get(operation.key);
      if (!fresh || !operation.version || fresh.version !== operation.version) throw Object.assign(new Error("A related record changed after inventory: " + operation.key),{status:409});
      if (operation.type === "update-signers" && !unsentEnvelope(dataOf(fresh).status)) throw Object.assign(new Error("A signing assignment became active or completed; cleanup was stopped."),{status:409});
    }
    const checked = new Set();
    for (const operation of plan.executionOperations.filter(item=>item.type==="firestore-delete")) {
      if (checked.has(operation.path)) continue;
      checked.add(operation.path);
      const nested = await listSubcollections(env,auth.token,operation.path);
      if (nested.length) throw Object.assign(new Error("Nested Firestore collections exist under " + operation.path + "; deleting this record would orphan related data. Cleanup was stopped."),{status:409});
    }
  }
  async function executeOperation(env, auth, operation, driveToken, authToken) {
    if (operation.type === "firestore-delete") return firestoreDelete(env,auth.token,operation.path,operation.version);
    if (operation.type === "drive-delete") {
      const response = await fetchImpl("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(operation.fileId),{
        method:"DELETE",headers:{Authorization:"Bearer "+driveToken}
      });
      if (response.status === 404) return "ALREADY_DELETED";
      if (!response.ok) throw new Error("Drive file deletion failed (HTTP " + response.status + ").");
      return "DELETED";
    }
    if (operation.type === "auth-delete") {
      const url = "https://identitytoolkit.googleapis.com/v1/projects/"+encodeURIComponent(projectIdFor(env))+"/accounts:delete";
      const response = await fetchImpl(url,{method:"POST",headers:{Authorization:"Bearer "+authToken,"Content-Type":"application/json"},body:JSON.stringify({localId:operation.uid})});
      const result = await response.json().catch(()=>({}));
      if (response.status === 404 || /USER_NOT_FOUND|NOT_FOUND/i.test(String(result.error?.message||""))) return "ALREADY_DELETED";
      if (!response.ok) throw new Error("Firebase Auth account deletion failed (HTTP " + response.status + ").");
      return "DELETED";
    }
    if (operation.type === "update-signers") {
      const current = await firestoreGet(env,auth.token,operation.path);
      if (!current) return "ALREADY_DELETED";
      if (operation.version && clean(current.updateTime) !== operation.version) throw new Error("Signing assignment record changed after inventory: " + operation.path);
      const signers = firestoreDocumentToPlain({fields:{signers:current.fields?.signers}})?.signers || [];
      const retained = signers.filter(signer => {
        const matches = (operation.uid && clean(signer.uid || signer.profileUid) === operation.uid) ||
          (operation.email && clean(signer.email).toLowerCase() === operation.email);
        return !(matches && clean(signer.status).toLowerCase() !== "signed");
      });
      if (retained.length === signers.length) return "ALREADY_REMOVED";
      const values = (current.fields?.signers?.arrayValue?.values || []).filter(value => {
        const signer = firestoreDocumentToPlain({fields:{signer:value}})?.signer || {};
        const matches = (operation.uid && clean(signer.uid || signer.profileUid) === operation.uid) ||
          (operation.email && clean(signer.email).toLowerCase() === operation.email);
        return !(matches && clean(signer.status).toLowerCase() !== "signed");
      });
      const url = "https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(projectIdFor(env))+"/databases/(default)/documents/"+operation.path.split("/").map(encodeURIComponent).join("/")+"?updateMask.fieldPaths=signers";
      const response = await fetchImpl(url,{method:"PATCH",headers:{Authorization:"Bearer "+auth.token,"Content-Type":"application/json"},body:JSON.stringify({fields:{signers:{arrayValue:{values}}}})});
      if (!response.ok) throw new Error("Unsent signer assignment removal failed (HTTP " + response.status + ").");
      return "UPDATED";
    }
    throw new Error("Unknown cleanup operation type: " + operation.type);
  }

  return async function administratorCleanupRouter(request, env, pathname) {
    if (!pathname.startsWith("/api/admin/cleanup/")) return null;
    let auth;
    try {
      auth = await authorize(request, env);
      if (pathname === "/api/admin/cleanup/inventory" && request.method === "GET") {
        const records = await loadInventory(env, auth);
        const inventoryId = crypto.randomUUID();
        const internalSnapshot = { inventoryId, createdAt: new Date().toISOString(), administratorUid: auth.uid,
          administratorEmail: auth.email, records, status: "INVENTORY_READY", mandatoryBeforeReset: true };
        const publicSnapshot = { ...internalSnapshot, records: records.map(({sourceDocument, ...row}) => row) };
        const serializedSnapshot = JSON.stringify(internalSnapshot);
        if (new TextEncoder().encode(serializedSnapshot).byteLength > 20 * 1024 * 1024) {
          return json({ok:false,code:"INVENTORY_TOO_LARGE",error:"The complete inventory exceeds the safe single-snapshot storage limit. No cleanup plan was created; inventory must be safely partitioned before proceeding."},413,corsHeaders(request));
        }
        await env.DRIVE_KV.put("admin-cleanup:inventory:" + inventoryId, serializedSnapshot, { expirationTtl: TTL_SECONDS });
        return json({ ok: true, ...publicSnapshot, summary: { total: records.length, stays: records.length, goes: 0,
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
        const unknown = [...byKey.keys()].filter(key => !inventory.records.some(row => row.key === key));
        if (unknown.length) return json({ok:false,error:"Selection contains records outside the inventory.",unknown},400,corsHeaders(request));
        const built = buildOperations(inventory, selections);
        if (built.blockers.length) return json({ok:false,code:"CLEANUP_PLAN_BLOCKED",error:"The selected records cannot be safely deleted with the available verified relationships.",blockers:built.blockers},409,corsHeaders(request));
        const planId = crypto.randomUUID();
        const plan = { planId, inventoryId, createdAt: new Date().toISOString(), administratorUid: auth.uid,
          administratorEmail: auth.email, records:built.records, executionOperations:built.operations, operationOutcomes:[],
          auditRefs:[], backupDriveFileId:null, backupUrl:null, typedConfirmationRequired: "DELETE", status: "AWAITING_REVIEW",
          mandatoryInventoryComplete: true, backupRequiredBeforeExecution:true, batchSize:10 };
        const auditRef = await writeAuditEvent(env,auth.token,{eventType:"PLAN_PREPARED",planId,inventoryId,actorUid:auth.uid,actorEmail:auth.email,
          createdAt:plan.createdAt,selectedGoes:plan.records.filter(row=>row.decision==="GOES").map(row=>row.key),
          cascadeOperations:plan.executionOperations.filter(operation=>operation.reason==="Approved related-record cleanup" || operation.reason==="Approved member-account cascade" || operation.reason==="Remove unsent signing assignment for deleted member")});
        plan.auditRefs.push(auditRef);
        await env.DRIVE_KV.put("admin-cleanup:plan:" + planId, JSON.stringify(plan), {expirationTtl:TTL_SECONDS});
        return json({ok:true,...plan,summary:{total:plan.records.length,stays:plan.records.filter(r=>r.decision==="STAYS").length,
          goes:plan.records.filter(r=>r.decision==="GOES").length,blocked:plan.records.filter(r=>r.protected).length,
          operations:plan.executionOperations.length,cascades:plan.executionOperations.filter(operation=>operation.reason!=="Administrator-selected record" && operation.reason!=="Administrator-selected register record" && operation.reason!=="Delete explicitly selected signed trial PDF" && operation.reason!=="Delete explicitly selected signed trial envelope").length}},200,corsHeaders(request));
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
        return json({ok:true,planId:plan.planId,status:plan.status,inventoryId:plan.inventoryId,
          stays:plan.records.filter(row=>row.decision==="STAYS").length,goes:plan.records.filter(row=>row.decision==="GOES").length,
          operationCount:(plan.executionOperations||[]).length,operationOutcomes:plan.operationOutcomes||[],
          backupUrl:plan.backupUrl||null,backupDriveFileId:plan.backupDriveFileId||null,
          completed:(plan.operationOutcomes||[]).filter(item=>["DELETED","ALREADY_DELETED","UPDATED","ALREADY_REMOVED"].includes(item.status)).length,
          executionEnabled:true},200,corsHeaders(request));
      }
      if (pathname.startsWith("/api/admin/cleanup/backup/") && request.method === "GET") {
        const planId = pathname.split("/").pop();
        const raw = await env.DRIVE_KV.get("admin-cleanup:plan:" + planId);
        if (!raw) return json({ok:false,error:"Cleanup backup not found or expired."},404,corsHeaders(request));
        const plan = JSON.parse(raw);
        if (plan.administratorUid !== auth.uid) return json({ok:false,error:"Cleanup backup belongs to a different administrator."},403,corsHeaders(request));
        return json({ok:true,backup:{planId:plan.planId,inventoryId:plan.inventoryId,createdAt:plan.createdAt,
          administratorUid:plan.administratorUid,administratorEmail:plan.administratorEmail,
          selections:plan.records.map(row=>({key:row.key,collection:row.collection,recordId:row.id,name:row.name,email:row.email,
            decision:row.decision,decisionSource:row.decisionSource,protected:row.protected,protectionReason:row.protectionReason,
            linkedRecordKeys:row.linkedRecordKeys,signedPdfReference:row.signedPdfReference})),
          operationOutcomes:plan.operationOutcomes||[],auditRefs:plan.auditRefs||[],status:plan.status,
          driveBackupFileId:plan.backupDriveFileId||null,driveBackupUrl:plan.backupUrl||null}},200,corsHeaders(request));
      }
      if (pathname === "/api/admin/cleanup/execute" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const planId = clean(body.planId);
        const raw = planId ? await env.DRIVE_KV.get("admin-cleanup:plan:" + planId) : null;
        if (!raw) return json({ok:false,error:"A valid inventory-backed cleanup plan is required."},409,corsHeaders(request));
        const plan = JSON.parse(raw);
        if (plan.administratorUid !== auth.uid) return json({ok:false,error:"Cleanup plan belongs to a different administrator."},403,corsHeaders(request));
        if (body.confirmation !== "DELETE") return json({ok:false,error:"Type DELETE exactly to confirm the reviewed cleanup plan."},400,corsHeaders(request));
        if (plan.status === "COMPLETE") return json({ok:true,planId,status:"COMPLETE",backupUrl:plan.backupUrl,operationOutcomes:plan.operationOutcomes||[]},200,corsHeaders(request));
        if (!Array.isArray(plan.executionOperations) || !plan.executionOperations.length) return json({ok:false,error:"The reviewed plan contains no executable GOES records."},409,corsHeaders(request));
        const inventoryRaw = await env.DRIVE_KV.get("admin-cleanup:inventory:" + plan.inventoryId);
        if (!inventoryRaw) return json({ok:false,error:"The source inventory expired. Take a fresh inventory and prepare a new plan."},409,corsHeaders(request));
        const inventory = JSON.parse(inventoryRaw);
        let driveToken;
        try {
          driveToken = await getDriveAccessToken(env);
          if (!plan.backupDriveFileId) {
            await revalidatePlan(env,auth,plan,inventory);
            const backup = await uploadBackup(env,plan,inventory,auth,driveToken);
            plan.backupDriveFileId = backup.fileId;
            plan.backupUrl = backup.url;
            plan.backupFolderId = backup.folderId;
            plan.backupDriveFileCopies = backup.driveFileCopies;
            plan.backupArchive = backup.archive;
            plan.status = "BACKUP_CREATED";
            const auditRef = await writeAuditEvent(env,auth.token,{eventType:"EXECUTION_STARTED",planId:plan.planId,
              inventoryId:plan.inventoryId,actorUid:auth.uid,actorEmail:auth.email,backupDriveFileId:plan.backupDriveFileId,
              startedAt:new Date().toISOString(),operationCount:plan.executionOperations.length});
            plan.auditRefs.push(auditRef);
            plan.backupArchive.auditRefs = plan.auditRefs;
            plan.backupArchive.backupDriveFileId = plan.backupDriveFileId;
            plan.backupArchive.backupUrl = plan.backupUrl;
            await updateBackup(env,plan,driveToken);
            await env.DRIVE_KV.put("admin-cleanup:plan:" + planId,JSON.stringify(plan),{expirationTtl:TTL_SECONDS});
          }
          const outcomesById = new Map((plan.operationOutcomes||[]).map(item=>[item.operationId,item]));
          const pending = plan.executionOperations.filter(operation=>!outcomesById.has(operation.operationId) ||
            !["DELETED","ALREADY_DELETED","UPDATED","ALREADY_REMOVED"].includes(outcomesById.get(operation.operationId).status));
          if (!pending.length) {
            plan.status = "COMPLETE";
            await env.DRIVE_KV.put("admin-cleanup:plan:" + planId,JSON.stringify(plan),{expirationTtl:TTL_SECONDS});
            return json({ok:true,planId,status:plan.status,backupUrl:plan.backupUrl,operationOutcomes:plan.operationOutcomes},200,corsHeaders(request));
          }
          const batch = pending.slice(0,Math.min(10,Number(plan.batchSize)||10));
          const batchAuditRef = await writeAuditEvent(env,auth.token,{eventType:"BATCH_STARTED",planId:plan.planId,
            inventoryId:plan.inventoryId,actorUid:auth.uid,actorEmail:auth.email,startedAt:new Date().toISOString(),
            operationIds:batch.map(operation=>operation.operationId)});
          plan.auditRefs.push(batchAuditRef);
          const authToken = batch.some(operation=>operation.type==="auth-delete") ? await getFirebaseAuthAdminAccessToken(env) : "";
          for (const operation of batch) {
            try {
              const result = await executeOperation(env,auth,operation,driveToken,authToken);
              plan.operationOutcomes = [...(plan.operationOutcomes||[]),{operationId:operation.operationId,type:operation.type,
                key:operation.key,status:result,completedAt:new Date().toISOString()}];
              await env.DRIVE_KV.put("admin-cleanup:plan:" + planId,JSON.stringify(plan),{expirationTtl:TTL_SECONDS});
            } catch (operationError) {
              plan.operationOutcomes = [...(plan.operationOutcomes||[]),{operationId:operation.operationId,type:operation.type,
                key:operation.key,status:"FAILED",error:String(operationError?.message||operationError).slice(0,500),
                failedAt:new Date().toISOString()}];
              plan.status = "PAUSED";
              try {
                const failedAuditRef = await writeAuditEvent(env,auth.token,{eventType:"OPERATION_FAILED",planId:plan.planId,
                  inventoryId:plan.inventoryId,actorUid:auth.uid,operationId:operation.operationId,
                  recordKey:operation.key,error:String(operationError?.message||operationError).slice(0,500),failedAt:new Date().toISOString()});
                plan.auditRefs.push(failedAuditRef);
                plan.backupArchive.operationOutcomes = plan.operationOutcomes;
                plan.backupArchive.auditRefs = plan.auditRefs;
                await updateBackup(env,plan,driveToken);
              } catch {}
              await env.DRIVE_KV.put("admin-cleanup:plan:" + planId,JSON.stringify(plan),{expirationTtl:TTL_SECONDS});
              return json({ok:false,code:"CLEANUP_PAUSED",planId,status:plan.status,error:String(operationError?.message||operationError).slice(0,500),
                backupUrl:plan.backupUrl,operationOutcomes:plan.operationOutcomes},409,corsHeaders(request));
            }
          }
          const completed = plan.operationOutcomes.filter(item=>["DELETED","ALREADY_DELETED","UPDATED","ALREADY_REMOVED"].includes(item.status)).length;
          const remaining = plan.executionOperations.length - completed;
          plan.status = remaining > 0 ? "IN_PROGRESS" : "COMPLETE";
          const batchCompleteAudit = await writeAuditEvent(env,auth.token,{eventType:remaining>0?"BATCH_COMPLETED":"EXECUTION_COMPLETED",
            planId:plan.planId,inventoryId:plan.inventoryId,actorUid:auth.uid,actorEmail:auth.email,
            completedOperations:completed,totalOperations:plan.executionOperations.length,completedAt:new Date().toISOString(),
            backupDriveFileId:plan.backupDriveFileId});
          plan.auditRefs.push(batchCompleteAudit);
          plan.backupArchive.operationOutcomes = plan.operationOutcomes;
          plan.backupArchive.auditRefs = plan.auditRefs;
          plan.backupArchive.executionStatus = plan.status;
          plan.backupArchive.updatedAt = new Date().toISOString();
          await updateBackup(env,plan,driveToken);
          await env.DRIVE_KV.put("admin-cleanup:plan:" + planId,JSON.stringify(plan),{expirationTtl:TTL_SECONDS});
          return json({ok:true,planId,status:plan.status,completedOperations:completed,totalOperations:plan.executionOperations.length,
            remainingOperations:remaining,backupDriveFileId:plan.backupDriveFileId,backupUrl:plan.backupUrl,
            operationOutcomes:plan.operationOutcomes,continueRequired:remaining>0},remaining>0?202:200,corsHeaders(request));
        } catch (executionError) {
          plan.status = plan.backupDriveFileId ? "PAUSED" : "AWAITING_REVIEW";
          plan.lastError = String(executionError?.message||executionError).slice(0,500);
          await env.DRIVE_KV.put("admin-cleanup:plan:" + planId,JSON.stringify(plan),{expirationTtl:TTL_SECONDS});
          return json({ok:false,code:"CLEANUP_EXECUTION_BLOCKED",error:plan.lastError,planId,backupUrl:plan.backupUrl||null},Number(executionError?.status||502),corsHeaders(request));
        }
      }
      return json({ok:false,error:"Method not allowed or cleanup route not found."},405,corsHeaders(request));
    } catch (error) {
      return json({ok:false,error:String(error?.message || "Administrator cleanup request failed.")},
        Number(error?.status || 0) || 500,corsHeaders(request));
    }
  };
}
