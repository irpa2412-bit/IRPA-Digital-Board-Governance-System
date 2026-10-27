const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text","application/vnd.oasis.opendocument.spreadsheet","application/vnd.oasis.opendocument.presentation",
  "application/rtf","text/plain","text/csv","text/tab-separated-values","text/markdown","text/html","application/xhtml+xml",
  "application/epub+zip","application/json","application/xml","text/xml","image/png","image/jpeg","image/webp","image/svg+xml",
  "image/gif","image/bmp","image/tiff","image/avif","application/zip","video/mp4","video/webm","video/quicktime","video/x-msvideo","video/x-matroska","audio/mpeg","audio/wav","audio/x-wav","audio/webm","audio/mp4","audio/x-m4a","audio/aac","audio/ogg","audio/flac"
]);
const OAUTH_STATE_TTL = 600;
const SMTP_HOST = "mail.irpa.or.tz";
const SMTP_PORT = 465;
const SMTP_FROM = "info@irpa.or.tz";
import { escapeHtml as escapeMailHtml, normalizeRecipientEmail, recipientDomain, safeMailError, sendWithRetry, validateMailHeader } from "./mailDelivery.js";
import { sendInvitationEmail, buildInvitationMessage, validateRecipient } from "./invitationEmail.mjs";
import { authenticateSmtpPlain } from "./smtpAuth.mjs";
import { route as esignRoute } from "./router.mjs";
import { buildEsignContext, EsignRecordDurableObject } from "./esignContext.mjs";
import { runCleanup } from "./upload.mjs";
import { createDocumentLifecycleRouter } from "./documentLifecycle.mjs";
import { canProvisionSignatureProfileFolder } from "./signatureProfileAuthorization.mjs";
import { canReadSignatureAsset, canUploadSignedDocument } from "./signatureAssetAuthorization.mjs";
import { InvitationRedemptionError, redeemInvitationToken, confirmInvitationPasswordSetup, getInvitationSessionState } from "./invitationRedemption.mjs";
import { buildGoogleDriveAuthorizationParams } from "./googleDriveOAuth.mjs";
import { createCommunicationsSiteRouter } from "./communicationsSite.mjs";
import { communicationsRoutes } from "./communicationsRoutes.mjs";
import { createMetaOAuthRouter } from "./metaOAuth.mjs";
import { createMeetingPortalRouter } from "./meetingPortal.mjs";
import { createMeetingServicesRouter } from "./meetingServices.mjs";
import { createInductionMatchingRouter } from "./inductionMatching.mjs";
import { createInvitationRemovalRouter } from "./invitationRemoval.mjs";
import { createReleaseReadinessRoute } from "./releaseReadinessRoutes.mjs";
import { persistCompletedSignatureEnvelope as persistSignatureMirror } from "./signatureMirror.mjs";
import { evaluateActualDataAccessPolicy, ACTUAL_DATA_ATTESTATION } from "./actualDataAccessPolicy.mjs";
import { authorizeIdentityReconciliation, classifyRegisteredIdentityRecord, summarizeIdentityReconciliation } from "./registeredIdentityReconciliation.mjs";

function getFirebaseProjectId(env) {
  const projectId = String(env?.FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID must be configured for this environment.");
  return projectId;
}

function getDriveRootFolderName(env) {
  return String(env?.DRIVE_ROOT_FOLDER_NAME || (env?.IRPA_ENVIRONMENT === "staging" ? "IRPA Governance System - STAGING" : "IRPA Governance System")).trim();
}

function getAuthorizedDriveEmail(env) {
  const email = String(env?.AUTHORIZED_DRIVE_EMAIL || "").trim().toLowerCase();
  if (!email) throw new Error("AUTHORIZED_DRIVE_EMAIL must be configured for this environment.");
  return email;
}

let jwksCache = null;
let jwksFetchedAt = 0;

const documentLifecycleRouter = createDocumentLifecycleRouter({
  getFirebaseProjectId: env => getFirebaseProjectId(env),
  allowedContentTypes: ALLOWED_CONTENT_TYPES,
  authenticateFirebaseRequest,
  getFirestoreDocument,
  getDriveAccessToken,
  driveFetch,
  findOrCreateFolder,
  updateFirestoreDocument,
  firestoreDocumentToPlain,
  commitDocumentAndAudit: commitFirestoreDocumentAndAudit,
  recordLifecycleFailure: recordDocumentLifecycleFailure,
  json,
  corsHeaders
});

const meetingPortalRouter = createMeetingPortalRouter({
  getFirebaseProjectId: env => getFirebaseProjectId(env),
  getFirestoreAdminAccessToken: env => getFirestoreAdminAccessToken(env),
  authenticateFirebaseRequest,
  json,
  corsHeaders
});

const meetingServicesRouter = createMeetingServicesRouter({
  authenticateFirebaseRequest,
  getFirebaseProjectId,
  getFirestoreAdminAccessToken,
  sendEmail: (env, message) => smtpSend(env, message),
  json,
  corsHeaders
});
const inductionMatchingRouter = createInductionMatchingRouter({
  authenticateFirebaseRequest,
  getFirebaseProjectId: env => getFirebaseProjectId(env),
  getFirestoreAdminAccessToken,
  getFirestoreDocument,
  json,
  corsHeaders
});

const invitationRemovalRouter = createInvitationRemovalRouter({
  authenticateFirebaseRequest,
  getFirebaseProjectId,
  getFirestoreAdminAccessToken,
  getFirestoreDocument,
  firestoreDocumentToPlain,
  json,
  corsHeaders
});


function normalizeGatewayAuthority(value) {
  return String(value||"").toLowerCase().replace(/^(the|irpa)\s+/,"").replace(/[._-]+/g," ").replace(/\s+/g," ").trim();
}
async function verifyGatewaySigningAuthority(env,user,manualAuthorityIdentification) {
  const input=normalizeGatewayAuthority(manualAuthorityIdentification);
  if(!input||!user?.uid||!user?.token)throw Object.assign(new Error("Authenticated signing authority is required."),{status:403});
  const adminToken=await getFirestoreAdminAccessToken(env);
  const records=[];
  const add=(document,sourceCollection,fallbackId)=>{
    if(!document?.fields)return;
    const record=firestoreDocumentToPlain(document)||{};
    const id=String(document.name||"").split("/").pop()||fallbackId||user.uid;
    records.push({id,...record,sourceCollection});
  };
  const readById=async(collection)=>{
    try { add(await getFirestoreDocument(env,collection+"/"+user.uid,adminToken),collection,user.uid); }
    catch(error) { console.error("Signing authority register lookup failed", {collection,code:String(error?.code||error?.status||"UNKNOWN")}); throw error; }
  };
  await readById("members");
  await readById("employees");
  const getRows=async(collection,field,value)=>{
    try { return await getFirestoreDocumentsByField(env,collection,field,value,adminToken); }
    catch(error) { console.error("Signing authority register lookup failed", {collection,code:String(error?.code||error?.status||"UNKNOWN")}); throw error; }
  };
  for(const collection of ["members","employees"]){
    for(const row of await getRows(collection,"uid",user.uid))add(row,collection,user.uid);
  }
  const originalEmail=String(user.email||"");
  const normalizedEmail=originalEmail.trim().toLowerCase();
  const emailValues=[...new Set([normalizedEmail,originalEmail].filter(Boolean))];
  for(const collection of ["members","employees"]){
    for(const email of emailValues){
      for(const row of await getRows(collection,"email",email))add(row,collection,user.uid);
    }
  }
  const uniqueRecords=[...new Map(records.map(record=>[record.sourceCollection+":"+record.id,record])).values()];
  const candidates=record=>[record.role,record.boardPosition,record.designation,record.jobTitle,record.position,record.title,record.authorityRole,record.unit,record.unitName].map(normalizeGatewayAuthority).filter(Boolean);
  const active=record=>String(record.status||record.employmentStatus||"Active").trim().toLowerCase()!=="inactive";
  const match=uniqueRecords.find(record=>active(record)&&candidates(record).includes(input));
  if(!match){
    const inactive=uniqueRecords.find(record=>!active(record));
    const activeRecord=uniqueRecords.find(record=>active(record));
    let reason,detailRecord;
    if(!uniqueRecords.length){reason="no register record found for this account";detailRecord=null;}
    else if(!activeRecord&&inactive){reason="record found but status is inactive";detailRecord=inactive;}
    else {reason="record found but role does not match";detailRecord=activeRecord||inactive;}
    const roleFields=detailRecord?["role","boardPosition","designation","jobTitle","position","title","authorityRole","unit","unitName"].filter(field=>Object.prototype.hasOwnProperty.call(detailRecord,field)).join(", "):"none";
    throw Object.assign(new Error("SYSTEM VERIFICATION FAILED: "+reason+" (collection: "+(detailRecord?.sourceCollection||"members/employees")+"; record ID: "+(detailRecord?.id||"none")+"; role fields present: "+(roleFields||"none") + ")."),{status:403});
  }
  return{
    verified:true,
    authorityRole:String(match.role||match.boardPosition||match.designation||match.jobTitle||match.position||match.title||manualAuthorityIdentification).trim(),
    authorityDepartment:String(match.department||"").trim(),
    authorityUnit:String(match.unit||match.unitName||"").trim(),
    authoritySourceCollection:match.sourceCollection,
    authoritySourceRecordId:match.id,
    verificationMethod:"Authenticated Gateway Member/Employee Register Match"
  };
}

const communicationsSiteRouter = createCommunicationsSiteRouter({
  authenticateFirebaseRequest,
  getFirestoreDocument,
  getFirestoreAdminAccessToken,
  getInstitutionalProfileForUser,
  firestoreDocumentToPlain,
  commitDocumentAndAudit: commitFirestoreDocumentAndAudit,
  json,
  corsHeaders
});

const metaOAuthRouter = createMetaOAuthRouter({
  authenticateFirebaseRequest,
  getFirestoreDocument,
  getInstitutionalProfileForUser,
  firestoreDocumentToPlain,
  json,
  corsHeaders
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      if (url.pathname === "/health") {
        const health = {
          ok: true,
          service: "IRPA Google Drive Gateway",
          storageProvider: "Google Drive",
          version: String(env.GIT_SHA || "unknown"),
          commit: String(env.GIT_SHA || "unknown"),
          firebaseProjectId: String(env.FIREBASE_PROJECT_ID || "unconfigured")
        };
        if (env.IRPA_ENVIRONMENT === "staging") {
          health.environment = "staging";
          health.esignModuleEnabled = env.ESIGN_MODULE_ENABLED === "true";
          health.authFunctionsEnabled = env.CLOUDFLARE_AUTH_FUNCTIONS_ENABLED === "true";
          health.driveMock = env.DRIVE_MOCK === "true";
        }
        return json(health, 200, corsHeaders(request));
      }

      if (url.pathname === "/oauth/start" && request.method === "POST") {
        return await startOAuth(request, env);
      }

      if (url.pathname === "/oauth/callback" && request.method === "GET") {
        return await oauthCallback(request, env);
      }

      // Normalize trailing slashes so portal upload/archive actions cannot be blocked by URL formatting.
      const pathname = url.pathname.replace(/\/+$/, "") || "/";

      if (pathname === "/api/system/release-readiness") return await createReleaseReadinessRoute({ authenticateFirebaseRequest, getFirestoreDocument, systemDiagnosticsRoute, actualDataAccessRoute, reconcileSignatureDocumentIds, corsHeaders })(request, env);

      const meetingPortalResponse = await meetingPortalRouter(request, env, pathname);
      if (meetingPortalResponse) return meetingPortalResponse;

      const meetingServicesResponse = await meetingServicesRouter(request, env, pathname);
      if (meetingServicesResponse) return meetingServicesResponse;

      const inductionMatchingResponse = await inductionMatchingRouter(request, env, pathname);
      if (inductionMatchingResponse) return inductionMatchingResponse;
      const invitationRemovalResponse = await invitationRemovalRouter(request, env, pathname);
      if (invitationRemovalResponse) return invitationRemovalResponse;

      if (pathname.startsWith("/api/communications/meta/")) {
        const metaResponse = await metaOAuthRouter(request, env);
        if (metaResponse) return metaResponse;
      }

      const communicationsRouteResponse = await communicationsRoutes(request, env, { authenticateFirebaseRequest, getFirestoreDocument, getInstitutionalProfileForUser, firestoreDocumentToPlain, corsHeaders });
      if (communicationsRouteResponse) return communicationsRouteResponse;

      if (pathname.startsWith("/api/communications/")) {
        const communicationsResponse = await communicationsSiteRouter(request, env);
        if (communicationsResponse) return communicationsResponse;
      }

      if (pathname.startsWith("/api/document-lifecycle/")) {
        const lifecycleResponse = await documentLifecycleRouter(request, env);
        if (lifecycleResponse) return lifecycleResponse;
      }

      if (pathname === "/api/communication-media-archive/provision" && request.method === "POST") {
        return await provisionCommunicationMediaArchive(request, env);
      }

      if (pathname === "/api/research-archive/provision" && request.method === "POST") {
        return await provisionResearchKnowledgeArchive(request, env);
      }

      if (pathname === "/api/upload" && request.method === "POST") {
        return await upload(request, env);
      }

      if (pathname === "/api/upload-controlled-document/policy-check" && request.method === "POST") {
        return await controlledDocumentUploadPolicyCheck(request, env);
      }

      if (pathname === "/api/upload-controlled-document" && request.method === "POST") {
        return await uploadControlledDocument(request, env);
      }

      if (pathname === "/api/signature-pathway/reconcile" && request.method === "POST") {
        return await reconcileSignatureDocumentIds(request, env);
      }
      if (pathname === "/api/signature-workflow/draft" && request.method === "POST") return await saveSignatureWorkflowDraftRoute(request, env);
      if (pathname === "/api/system/diagnostics" && request.method === "GET") return await systemDiagnosticsRoute(request, env);
      if (pathname === "/api/system/actual-data-access" && (request.method === "GET" || request.method === "POST")) return await actualDataAccessRoute(request, env);
      if (pathname === "/api/members/reconcile-registered-identity-uids" && request.method === "POST") return await reconcileRegisteredIdentityUidsRoute(request, env);
      if (pathname === "/api/signature/authority" && request.method === "POST") return await updateSignerAuthorityRoute(request, env);

      if (pathname === "/api/signature-profile/folder" && request.method === "POST") {
        return await ensureSignatureProfileFolder(request, env);
      }
      if (pathname === "/api/signature-profile/finalize" && request.method === "POST") {
        return await finalizeSignatureProfileArchives(request, env);
      }
      if (pathname === "/api/document-archive/folder" && request.method === "POST") {
        return await ensureDocumentArchiveFolder(request, env);
      }
      if (pathname === "/api/document-archive/provision" && request.method === "POST") {
        return await provisionDocumentArchive(request, env);
      }
      if (pathname === "/api/meeting-archive/provision" && request.method === "POST") {
        return await provisionMeetingCategoryArchive(request, env);
      }
      if (pathname === "/api/meeting-archive/get" && request.method === "POST") {
        return await getMeetingCategoryArchive(request, env);
      }
      if (pathname === "/api/signed-document/archive" && request.method === "POST") {
        return await ensureSignedDocumentArchive(request, env);
      }
      if (pathname === "/api/signature-workflow/folder" && request.method === "POST") {
        return await ensureSignatureWorkflowFolder(request, env);
      }

      if (url.pathname === "/api/signature-file/download" && request.method === "POST") {
        return await downloadSignatureFile(request, env);
      }

      if (url.pathname === "/api/download" && request.method === "POST") {
        return await download(request, env);
      }

      if (url.pathname === "/api/delete" && request.method === "POST") {
        return await deleteDriveFile(request, env);
      }

      if (url.pathname === "/api/invitations/redeem" && request.method === "POST") {
        try {
          return json(await withInvitationRetry(() => redeemInvitationToken(request.clone(), env), "redeem"), 200, corsHeaders(request));
        } catch (error) {
          if (error instanceof InvitationRedemptionError) {
            if (/expired|cancelled/i.test(String(error.message||""))) {
              await notifyInvitationAdministrator(request, env, error.message);
            }
            return json({ok:false,error:error.message}, error.status, corsHeaders(request));
          }
          console.error("Invitation redemption backend failure", error);
          return json({ok:false,error:"We could not complete this invitation right now. Please try again."}, 503, corsHeaders(request));
        }
      }

      if (url.pathname === "/api/invitations/session-state" && request.method === "POST") {
        try {
          const claims = await authenticateFirebaseRequest(request, env, {skipActivation:true});
          return json(await getInvitationSessionState(env, claims), 200, corsHeaders(request));
        } catch (error) {
          if (error instanceof InvitationRedemptionError) return json({ok:false,error:error.message}, error.status, corsHeaders(request));
          throw error;
        }
      }

      if (url.pathname === "/api/invitations/password-set" && request.method === "POST") {
        try {
          const claims = await authenticateFirebaseRequest(request, env, {skipActivation:true});
          return json(await withInvitationRetry(() => confirmInvitationPasswordSetup(request.clone(), env, claims), "password-set"), 200, corsHeaders(request));
        } catch (error) {
          if (error instanceof InvitationRedemptionError) return json({ok:false,error:error.message}, error.status, corsHeaders(request));
          const message=String(error?.message||"");
          if (message === "Firebase authentication is required." || message.startsWith("Invalid Firebase ID token") || message.startsWith("Invalid Firebase token") || message === "Firebase token is expired.") {
            return json({ok:false,error:"Your invitation session has expired. Please open the invitation link again."},401,corsHeaders(request));
          }
          console.error("Invitation password-set backend failure", error);
          return json({ok:false,error:"We could not activate your account right now. Please try again."}, 503, corsHeaders(request));
        }
      }
      if (url.pathname === "/api/send-invitation-email" && request.method === "POST") {
        return await sendGatewayInvitationEmail(request, env);
      }

      if (url.pathname === "/api/invitations/send" && request.method === "POST") {
        return await sendMemberInvitation(request, env);
      }

      if (url.pathname === "/api/signature-invitations/send" && request.method === "POST") {
        return await sendSignatureInvitation(request, env);
      }

      if (url.pathname === "/api/induction/lookup" && request.method === "POST") {
        return await lookupInductionRegistration(request, env);
      }

      if (url.pathname === "/api/session/profile" && request.method === "POST") {
        return await getSessionProfile(request, env);
      }

      if (env.ESIGN_MODULE_ENABLED === "true") {
        if (pathname === "/api/esign/cleanup" && request.method === "POST") {
          const claims = await authenticateFirebaseRequest(request, env);
          const admin = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
          if (!admin?.fields?.active?.booleanValue) return json({ok:false,error:"Administrator authorization is required."},403,corsHeaders(request));
          const ctx = buildEsignContext({env,verifyUser:async()=>({uid:claims.user_id,isAdmin:true}),sendInvitation:async()=>{throw new Error("Cleanup context does not send invitations.");},logger:console,driveHelpers:{getDriveAccessToken,driveFetch}});
          return json(await runCleanup(ctx),200,corsHeaders(request));
        }
        const isEsignPath =
          pathname === "/api/documents/next-reference" ||
          /^\/api\/documents(?:\/.*)?$/.test(pathname) ||
          /^\/api\/envelopes(?:\/[A-Za-z0-9_-]{3,64}(?:\/(?:status|resync|retry|retry-completion|void))?)?$/.test(pathname) ||
          /^\/api\/sign\/.*$/.test(pathname) ||
          /^\/api\/document-lifecycle\/.*$/.test(pathname) ||
          /^\/api\/auth\/.*$/.test(pathname);
        if (isEsignPath) {
          const persistCompletedSignatureEnvelope = async ({envelope,completion}) => {
            const token = await getFirestoreAdminAccessToken(env);
            const encode = value => {
              if (value === null || value === undefined) return {nullValue:null};
              if (typeof value === "boolean") return {booleanValue:value};
              if (typeof value === "number" && Number.isInteger(value)) return {integerValue:String(value)};
              if (typeof value === "number") return {doubleValue:value};
              if (Array.isArray(value)) return {arrayValue:{values:value.map(encode)}};
              if (typeof value === "object") return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}};
              return {stringValue:String(value)};
            };
            const getDocument = async path => {
              const raw = await getFirestoreDocument(env,path,token);
              return firestoreDocumentToPlain(raw);
            };
            const updateDocument = async (path,fields) => updateFirestoreDocument(
              env,path,token,
              Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,encode(v)])),
              Object.keys(fields)
            );
            return persistSignatureMirror({envelope,completion,getDocument,updateDocument});
          };
          const ctx = buildEsignContext({
            env,
            persistCompletedSignatureEnvelope,
            verifyUser: async req => {
              const claims = await authenticateFirebaseRequest(req, env);
              const admin = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
              return {uid:claims.user_id,email:claims.email||"",token:claims.token,isAdmin:Boolean(admin?.fields?.active?.booleanValue)};
            },
            sendInvitation: async ({to,name,link}) => sendInvitationEmail({email:to,name,link,smtpSend:async ({to:recipient,subject,text,html})=>smtpSend(env,{to:recipient,subject,text,html}),logger:console}),
            logger: console,
            verifySigningAuthority: (user, manualAuthority) => verifyGatewaySigningAuthority(env, user, manualAuthority),
            driveHelpers: {getDriveAccessToken,driveFetch}
          });
          const response = await esignRoute(request,ctx);
          const headers = new Headers(response.headers);
          for (const [k,v] of Object.entries(corsHeaders(request))) headers.set(k,v);
          return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
        }
      }

      return json({ ok: false, error: "Not found." }, 404, corsHeaders(request));
    } catch (error) {
      console.error("Drive gateway error", error);

      const message = error?.message || "Drive gateway request failed.";
      if (message === "Google Drive has not yet been authorized.") {
        return json({ok:false,code:"GOOGLE_DRIVE_NOT_AUTHORIZED",error:"Google Drive has not yet been authorized. An active IRPA administrator must complete Google Drive authorization in Settings before retrying this operation."},503,corsHeaders(request));
      }
      const isAuthError =
        message === "Firebase authentication is required." ||
        message.startsWith("Invalid Firebase ID token") ||
        message.startsWith("Invalid Firebase token") ||
        message === "Firebase token is expired." ||
        message === "Firebase token signing key not found.";

      return json({
        ok: false,
        error: message,
        ...(error?.googleStatus ? {googleStatus:error.googleStatus} : {}),
        ...(error?.googleMessage ? {googleMessage:error.googleMessage} : {})
      }, Number(error?.status || 0) || (isAuthError ? 401 : 500), corsHeaders(request));
    }
  }
};

async function startOAuth(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const admin = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
  if (!admin?.fields?.active?.booleanValue) {
    return json({ ok: false, error: "Administrator authorization is required." }, 403, corsHeaders(request));
  }

  const state = randomBase64Url(32);
  await env.DRIVE_KV.put(
    `oauth-state:${await sha256Hex(state)}`,
    JSON.stringify({
      uid: claims.user_id,
      email: claims.email || null,
      createdAt: Date.now(),
      expiresAt: Date.now() + OAUTH_STATE_TTL * 1000
    }),
    { expirationTtl: OAUTH_STATE_TTL }
  );

  const redirectUri = `${new URL(request.url).origin}/oauth/callback`;
  const params = buildGoogleDriveAuthorizationParams({
    clientId: env.GOOGLE_DRIVE_CLIENT_ID,
    redirectUri,
    scope: DRIVE_SCOPE,
    state
  });

  return json({
    ok: true,
    authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }, 200, corsHeaders(request));
}

async function oauthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return html("IRPA Google Drive authorization was cancelled or denied. You may close this window.");
  if (!code || !state) return html("Missing Google OAuth authorization response.");

  const stateKey = `oauth-state:${await sha256Hex(state)}`;
  const stateRecord = await env.DRIVE_KV.get(stateKey, "json");
  if (!stateRecord || Date.now() > Number(stateRecord.expiresAt || 0)) {
    return html("This one-time authorization request is invalid or has expired. Start authorization again.");
  }
  await env.DRIVE_KV.delete(stateKey);

  const redirectUri = `${url.origin}/oauth/callback`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.access_token) {
    throw new Error(tokens.error_description || "Google OAuth token exchange failed.");
  }

  const about = await driveFetch(env, tokens.access_token, "/drive/v3/about?fields=user(emailAddress,displayName)");
  const email = String(about?.user?.emailAddress || "").toLowerCase();
  if (email !== getAuthorizedDriveEmail(env).toLowerCase()) {
    return html(`Authorization rejected. The Google account must be ${getAuthorizedDriveEmail(env)}.`);
  }
  if (!tokens.refresh_token) {
    return html("Google did not return a refresh token. Start authorization again with consent.");
  }

  const encrypted = await encryptText(tokens.refresh_token, env.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY);
  await env.DRIVE_KV.put("google-drive-refresh-token", JSON.stringify({
    version: 1,
    authorizedEmail: getAuthorizedDriveEmail(env),
    encrypted,
    authorizedByUid: stateRecord.uid,
    authorizedByEmail: stateRecord.email || null,
    authorizedAt: new Date().toISOString()
  }));

  return html("IRPA Google Drive authorization completed successfully. The refresh token has been stored securely. You may close this window.");
}

async function upload(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();
  const fileName = cleanName(data.fileName || "IRPA-document");
  const contentType = String(data.contentType || "application/pdf").toLowerCase();
  const fileSize = Number(data.fileSize || 0);
  const base64 = String(data.base64 || "");
  const purpose = cleanName(data.purpose || "Controlled Documents");
  if (purpose === "Communication Media" && !(await authorizeCommunicationMediaDownload(env, claims))) {
    return json({ ok:false, error:"Your registered IRPA role does not permit communications media uploads." },403,corsHeaders(request));
  }
  const requestedFolderId = String(data.folderId || "").trim();
  const ownerUid = String(data.ownerUid || claims.user_id).trim();
  const signatureDocumentId = cleanId(data.documentId || "");
  const signatureEnvelopeId = cleanId(data.envelopeId || "");
  const signatureSignerUid = cleanId(data.signerUid || "");

  if (purpose === "Communication Media" && !requestedFolderId) {
    return json({ok:false,error:"Provision the IRPA Communication and Media Archive before uploading media."},400,corsHeaders(request));
  }

  if (purpose === "Signed Documents Archive") {
    if (!requestedFolderId || !signatureDocumentId || !signatureEnvelopeId || !signatureSignerUid) {
      return json({ ok:false, error:"Signed-document uploads require a document, envelope and authenticated signer identity." },400,corsHeaders(request));
    }
    if (signatureSignerUid !== claims.user_id) {
      return json({ ok:false, error:"A signed document may only be uploaded by the authenticated assigned signer." },403,corsHeaders(request));
    }
    const envelope = await getFirestoreDocument(env, "signatureEnvelopes/" + signatureEnvelopeId, claims.token);
    if (!envelope) return json({ ok:false, error:"The signing envelope was not found." },404,corsHeaders(request));
    const envelopeFields = envelope.fields || {};
    const allowed = canUploadSignedDocument({
      authenticatedUid: claims.user_id,
      signerUid: signatureSignerUid,
      documentId: signatureDocumentId,
      envelopeDocumentId: envelopeFields.documentId?.stringValue || "",
      envelopeParticipantUids: firestoreStringArray(envelopeFields.participantUids),
      actionUids: firestoreStringArray(envelopeFields.actionUids),
      signingMode: envelopeFields.signingMode?.stringValue || "Sequential",
      currentSignerUid: envelopeFields.currentSignerUid?.stringValue || null,
    });
    if (!allowed) return json({ ok:false, error:"The authenticated account is not the current assigned action signer for this document." },403,corsHeaders(request));
  }

  if (purpose === "Signature Profile") {
    if (ownerUid !== claims.user_id) {
      return json({ ok: false, error: "A signature profile may only be uploaded by its owner." }, 403, corsHeaders(request));
    }
    const { memberRecord, employeeRecord } = await getInstitutionalProfileForUser(env, claims);
    const adminRecord = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
    if (!memberRecord && !employeeRecord && !adminRecord?.fields?.active?.booleanValue) {
      return json({ ok: false, error: "A registered IRPA member or employee profile is required before a Signature Profile asset can be uploaded." }, 403, corsHeaders(request));
    }
    if (!requestedFolderId) {
      return json({ ok: false, error: "A member signature folder is required." }, 400, corsHeaders(request));
    }
  } else if (purpose === "Meeting Products") {
    if (!requestedFolderId || !data.meetingId || !data.meetingCategory) return json({ok:false,error:"Meeting ID, category and authorised archive folder are required."},400,corsHeaders(request));
    try { await authorizeMeetingArchiveUser(env, claims, String(data.meetingId), String(data.meetingCategory).toUpperCase()); }
    catch (error) { return json({ok:false,error:error.message||"Meeting archive access denied."},403,corsHeaders(request)); }
  } else if (purpose === "Signed Documents Archive" || purpose === "Documents Portal" || purpose === "Controlled Documents" || purpose === "Communication Media") {
    if (!requestedFolderId) return json({ ok:false, error:"A controlled document archive folder is required." },400,corsHeaders(request));
  } else if (requestedFolderId || data.ownerUid) {
    return json({ ok: false, error: "Folder parameters are restricted to authorized IRPA archive uploads." }, 400, corsHeaders(request));
  }

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return json({ ok: false, error: "This document format is not supported. Use PDF, Word, Excel, PowerPoint, OpenDocument, text/CSV, or supported image formats." }, 400, corsHeaders(request));
  }
  const maxUploadBytes = purpose === "Meeting Products" ? 60 * 1024 * 1024 : purpose === "Communication Media" ? 25 * 1024 * 1024 : MAX_BYTES;
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > maxUploadBytes) {
    return json({ ok: false, error: purpose === "Meeting Products" ? "Meeting products must not exceed 60 MB per file in this upload workflow." : "Uploaded files must not exceed 10 MB." }, 400, corsHeaders(request));
  }

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytes.length !== fileSize) {
    return json({ ok: false, error: "Uploaded PDF size could not be verified." }, 400, corsHeaders(request));
  }

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, getDriveRootFolderName(env));
  let purposeId;
  if (purpose === "Signature Profile" || purpose === "Signed Documents Archive" || purpose === "Documents Portal" || purpose === "Controlled Documents" || purpose === "Meeting Products" || purpose === "Communication Media") {
    const folderMeta = await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(requestedFolderId)}?fields=id,name,mimeType,description,trashed`);
    const folderDescription = parseDescription(folderMeta.description);
    if (folderMeta.mimeType !== "application/vnd.google-apps.folder" || folderMeta.trashed) {
      return json({ ok: false, error: "The requested IRPA archive folder is invalid." }, 409, corsHeaders(request));
    }
    if (purpose === "Communication Media" && (folderDescription.irpaCommunicationMediaArchive !== true || folderDescription.purpose !== "IRPA Communication and Media Archive")) {
      return json({ok:false,error:"The requested folder is not the authorised IRPA Communication and Media Archive."},403,corsHeaders(request));
    }
    if (purpose === "Signature Profile") {
      const isProfileRoot = folderDescription.irpaGovernanceSignatureFolder === true;
      const isCompletedArchive = folderDescription.irpaGovernanceSignatureProfileArchive === true;
      if ((!isProfileRoot && !isCompletedArchive) || folderDescription.ownerUid !== claims.user_id) {
        return json({ ok: false, error: "The requested signature archive does not belong to the authenticated member." }, 403, corsHeaders(request));
      }
    }
    if ((purpose === "Signed Documents Archive" || purpose === "Documents Portal" || purpose === "Controlled Documents") && folderDescription.irpaGovernanceArchive !== true) {
      return json({ ok: false, error: "The requested folder is not an IRPA controlled-document archive folder." }, 403, corsHeaders(request));
    }
    if (purpose === "Signed Documents Archive" && String(folderDescription.documentId || "") !== signatureDocumentId) {
      return json({ ok:false, error:"The requested signed-document archive does not match the signing document." },403,corsHeaders(request));
    }
    if (purpose === "Meeting Products" && (folderDescription.irpaGovernanceArchive !== true || folderDescription.purpose !== "IRPA Meeting Category Archive" || String(folderDescription.meetingCategory || "").toUpperCase() !== String(data.meetingCategory || "").toUpperCase())) {
      return json({ok:false,error:"The requested folder is not the authorised archive for this meeting category."},403,corsHeaders(request));
    }
    purposeId = requestedFolderId;
  } else {
    const documentsId = await findOrCreateFolder(env, accessToken, "Controlled Documents", rootId);
    purposeId = await findOrCreateFolder(env, accessToken, purpose, documentsId);
  }

  const metadata = {
    name: fileName,
    parents: [purposeId],
    mimeType: contentType,
    description: JSON.stringify({
      irpaGovernance: true,
      uploadedByUid: claims.user_id,
      purpose,
      ownerUid,
      documentId: purpose === "Signed Documents Archive" ? signatureDocumentId : null,
      envelopeId: purpose === "Signed Documents Archive" ? signatureEnvelopeId : null,
      signerUid: purpose === "Signed Documents Archive" ? signatureSignerUid : null,
      driveFolderId: purpose === "Signature Profile" ? purposeId : null
    })
  };

  const boundary = `irpa-${crypto.randomUUID()}`;
  const body = buildMultipartBody(boundary, metadata, bytes, contentType);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,createdTime,parents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Google Drive upload failed.");

  return json({
    ok: true,
    fileId: result.id,
    fileName: result.name,
    fileSize: Number(result.size || fileSize),
    webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
    uploadedByUid: claims.user_id,
    storageProvider: "Google Drive"
  }, 200, corsHeaders(request));
}

let firebaseAuthAdminTokenCache = { token: "", expiresAt: 0 };

async function getFirebaseAuthAdminAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (firebaseAuthAdminTokenCache.token && firebaseAuthAdminTokenCache.expiresAt > now + 60) return firebaseAuthAdminTokenCache.token;
  let serviceAccount;
  try { serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || ""); }
  catch { throw new Error("Firebase Authentication service identity is not configured correctly."); }
  if (serviceAccount.project_id !== getFirebaseProjectId(env) || typeof serviceAccount.client_email !== "string" || !serviceAccount.client_email.endsWith(".iam.gserviceaccount.com") || typeof serviceAccount.private_key !== "string") {
    throw new Error("Firebase Authentication service identity is invalid for this Firebase project.");
  }
  const claims = { iss: serviceAccount.client_email, scope: "https://www.googleapis.com/auth/identitytoolkit", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const unsigned = base64UrlEncodeText(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + base64UrlEncodeText(JSON.stringify(claims));
  const key = await crypto.subtle.importKey("pkcs8", pemPrivateKeyBytes(serviceAccount.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + base64UrlEncodeBytes(new Uint8Array(signature)) }) });
  const result = await response.json();
  if (!response.ok || typeof result.access_token !== "string") { firebaseAuthAdminTokenCache = { token: "", expiresAt: 0 }; throw new Error("Firebase Authentication service identity could not obtain an Identity Toolkit access token."); }
  firebaseAuthAdminTokenCache = { token: result.access_token, expiresAt: now + Math.min(Number(result.expires_in) || 3600, 3600) };
  return firebaseAuthAdminTokenCache.token;
}

async function listFirebaseAuthUsers(env, token) {
  const users = [];
  let pageToken = "";
  do {
    const url = new URL(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(getFirebaseProjectId(env))}/accounts:batchGet`);
    url.searchParams.set("maxResults", "1000");
    if (pageToken) url.searchParams.set("nextPageToken", pageToken);
    const response = await fetch(url.toString(), { headers: { Authorization: "Bearer " + token } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Firebase Authentication account listing failed: HTTP " + response.status + " " + String(body?.error?.message || ""));
    users.push(...(Array.isArray(body.users) ? body.users : []));
    pageToken = String(body.nextPageToken || "");
  } while (pageToken);
  return users;
}

async function getFirestoreCollectionDocuments(env, collectionName, token) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${getFirebaseProjectId(env)}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collectionName }] } })
  });
  if (!response.ok) throw new Error("Firestore " + collectionName + " register read failed: HTTP " + response.status);
  return (await response.json()).filter(row => row.document).map(row => row.document);
}

async function updateSignerAuthorityRoute(request, env) {
  let step = "Firebase authentication";
  try {
    const claims = await authenticateFirebaseRequest(request, env);
    const uid = String(claims.user_id || "");
    const email = String(claims.email || "").trim().toLowerCase();
    if (!uid) return json({ ok: false, step, error: "Authentication is required." }, 401, corsHeaders(request));
    step = "Validate signing authority request";
    const body = await request.json();
    const requestedRole = String(body.authorityRole || "").trim();
    const requestedDepartment = String(body.authorityDepartment || "").trim();
    const requestedUnit = String(body.authorityUnit || "").trim();
    const authorityStatus = String(body.authorityStatus || "Current").trim();
    const authorityReference = String(body.authorityReference || "").trim();
    const authorityEffectiveAt = String(body.authorityEffectiveAt || "").trim() || null;
    const authorityExpiresAt = String(body.authorityExpiresAt || "").trim() || null;
    if (!requestedRole) return json({ ok: false, step, error: "Select the current signing authority before saving." }, 400, corsHeaders(request));
    if (!["Current", "Pending Verification", "Expired", "Not yet assigned"].includes(authorityStatus)) return json({ ok: false, step, error: "Select a valid signing authority status." }, 400, corsHeaders(request));
    if (authorityEffectiveAt && authorityExpiresAt && authorityExpiresAt < authorityEffectiveAt) return json({ ok: false, step, error: "Authority expiry date cannot be earlier than the effective date." }, 400, corsHeaders(request));

    step = "Read active Member and Employee authority registers";
    const token = await getFirestoreAdminAccessToken(env);
    const records = [];
    for (const collectionName of ["members", "employees"]) {
      const byUid = await getFirestoreDocument(env, collectionName + "/" + uid, token);
      if (byUid?.fields) records.push({ id: String(byUid.name || "").split("/").pop(), ...firestoreDocumentToPlain(byUid), sourceCollection: collectionName });
      if (email) {
        const byEmail = await getFirestoreDocumentsByField(env, collectionName, "email", email, token);
        for (const doc of byEmail) records.push({ id: String(doc.name || "").split("/").pop(), ...firestoreDocumentToPlain(doc), sourceCollection: collectionName });
      }
    }
    const activeRecords = [...new Map(records.map(record => [record.sourceCollection + ":" + record.id, record])).values()]
      .filter(record => String(record.status || record.employmentStatus || "Active").trim().toLowerCase() !== "inactive");
    if (!activeRecords.length) return json({ ok: false, step, error: "No active IRPA Member or Employee register entry was found for this account." }, 403, corsHeaders(request));
    const valuesFor = record => [record.role, record.boardPosition, record.unit, record.unitName,
      ...(Array.isArray(record.roles) ? record.roles : []),
      ...(Array.isArray(record.assignedRoles) ? record.assignedRoles : []),
      ...(Array.isArray(record.selectedRoles) ? record.selectedRoles : []),
      ...(Array.isArray(record.roleAssignments) ? record.roleAssignments : [])
    ].flatMap(value => String(value || "").split(",").map(value => value.trim()).filter(Boolean));
    if (!activeRecords.flatMap(valuesFor).includes(requestedRole)) return json({ ok: false, step, error: "The selected signing authority is not registered to this IRPA member/employee account." }, 403, corsHeaders(request));
    const matchingRecords = activeRecords.filter(record => {
      if (!valuesFor(record).includes(requestedRole)) return false;
      if (requestedDepartment && String(record.department || "").trim() !== requestedDepartment) return false;
      if (requestedUnit) {
        const recordUnit = String(record.unit || record.unitName || "").trim() || requestedDepartment;
        if (recordUnit !== requestedUnit) return false;
      }
      return true;
    });
    if (!matchingRecords.length) return json({ ok: false, step, error: "The selected department, unit and signing authority do not match an active IRPA register entry for this account." }, 403, corsHeaders(request));
    const source = matchingRecords[0];
    const authorityDepartment = String(source.department || "").trim();
    const authorityUnit = String(source.unit || source.unitName || "").trim() || authorityDepartment;

    step = "Verify existing Signer Identity";
    const identityDoc = await getFirestoreDocument(env, "signerIdentities/" + cleanId(uid), token);
    if (!identityDoc?.fields) return json({ ok: false, step, error: "Signer Identity record is not available. Restore the Signer Identity link before updating signing authority." }, 412, corsHeaders(request));
    const now = new Date().toISOString();
    step = "Save signing authority";
    await updateFirestoreDocument(env, "signerIdentities/" + cleanId(uid), token, {
      authorityRole: { stringValue: requestedRole },
      authorityStatus: { stringValue: authorityStatus },
      authorityReference: { stringValue: authorityReference },
      authorityEffectiveAt: authorityEffectiveAt ? { stringValue: authorityEffectiveAt } : { nullValue: null },
      authorityExpiresAt: authorityExpiresAt ? { stringValue: authorityExpiresAt } : { nullValue: null },
      authorityDepartment: { stringValue: authorityDepartment },
      authorityUnit: { stringValue: authorityUnit },
      authoritySourceCollection: { stringValue: source.sourceCollection },
      authoritySourceRecordId: { stringValue: source.id },
      authorityUpdatedAt: { timestampValue: now },
      updatedAt: { timestampValue: now }
    }, ["authorityRole", "authorityStatus", "authorityReference", "authorityEffectiveAt", "authorityExpiresAt", "authorityDepartment", "authorityUnit", "authoritySourceCollection", "authoritySourceRecordId", "authorityUpdatedAt", "updatedAt"]);
    step = "Write signing authority audit";
    const auditId = "signer-authority-" + Date.now() + "-" + crypto.randomUUID().slice(0, 8);
    await updateFirestoreDocument(env, "audit/" + auditId, token, {
      action: { stringValue: "UPDATE_SIGNER_AUTHORITY" },
      collection: { stringValue: "signerIdentities" },
      recordId: { stringValue: uid },
      details: { mapValue: { fields: {
        authorityRole: { stringValue: requestedRole }, authorityStatus: { stringValue: authorityStatus },
        authorityDepartment: { stringValue: authorityDepartment }, authorityUnit: { stringValue: authorityUnit },
        authoritySourceCollection: { stringValue: source.sourceCollection }, authoritySourceRecordId: { stringValue: source.id }
      } } },
      actorUid: { stringValue: uid },
      actorEmail: { stringValue: email || String(identityDoc.fields.email?.stringValue || "") },
      createdAt: { timestampValue: now }
    }, ["action", "collection", "recordId", "details", "actorUid", "actorEmail", "createdAt"]);
    return json({ ok: true, uid, authorityRole: requestedRole, authorityStatus, authorityReference, authorityEffectiveAt, authorityExpiresAt, authorityDepartment, authorityUnit, authoritySourceCollection: source.sourceCollection, authoritySourceRecordId: source.id, auditId }, 200, corsHeaders(request));
  } catch (error) {
    console.error("Signing authority update failed", { step, error: String(error?.message || error) });
    return json({ ok: false, step, error: String(error?.message || "Signing authority update failed.") }, Number(error?.status || 0) || 500, corsHeaders(request));
  }
}

async function reconcileRegisteredIdentityUidsRoute(request, env) {
  let step = "Firebase authentication";
  try {
    const claims = await authenticateFirebaseRequest(request, env);
    step = "Administrator authorization";
    const firestoreToken = await getFirestoreAdminAccessToken(env);
    const profile = await getFirestoreDocument(env, "adminProfiles/" + claims.user_id, firestoreToken);
    const email = String(claims.email || "").trim().toLowerCase();
    const adminAllowed = email === "irpa2412@gmail.com" || (profile?.fields?.active?.booleanValue === true && profile?.fields?.role?.stringValue === "Administrator");
    const authorization = authorizeIdentityReconciliation({ authenticated: Boolean(claims.user_id), adminAllowed });
    if (!authorization.allowed) return json({ ok: false, step, error: authorization.error }, authorization.status, corsHeaders(request));
    const requestBody = await request.json().catch(() => ({}));
    const dryRun = requestBody?.dryRun === true;

    step = "List existing Firebase Authentication accounts";
    const authToken = await getFirebaseAuthAdminAccessToken(env);
    const authUsers = await listFirebaseAuthUsers(env, authToken);
    step = "Read Member and Employee registers";
    const collections = ["members", "employees"];
    const docsByCollection = await Promise.all(collections.map(name => getFirestoreCollectionDocuments(env, name, firestoreToken)));
    const authUsersForPolicy = authUsers.map(user => ({ uid: String(user.localId || user.uid || ""), email: String(user.email || "") }));
    const results = [];
    for (let i = 0; i < collections.length; i++) {
      const collectionName = collections[i];
      for (const document of docsByCollection[i]) {
        const recordId = String(document.name || "").split("/").pop();
        const data = firestoreDocumentToPlain(document) || {};
        const line = { collection: collectionName, recordId, name: String(data.name || ""), email: String(data.email || "").trim().toLowerCase(), existingUid: String(data.uid || "").trim(), uid: null, status: "unresolved", reason: "" };
        try {
          const decision = classifyRegisteredIdentityRecord({ email: line.email, existingUid: line.existingUid, authUsers: authUsersForPolicy });
          line.status = decision.status;
          line.reason = decision.reason;
          line.uid = decision.uid || line.existingUid || null;
          if (decision.status === "assigned" && dryRun) {
            line.reason += " Dry run only: no UID or audit writes were performed.";
          } else if (decision.status === "assigned") {
            step = "Write UID for " + collectionName + "/" + recordId;
            await updateFirestoreDocument(env, collectionName + "/" + cleanId(recordId), firestoreToken, {
              uid: { stringValue: decision.uid },
              uidAssignedAt: { timestampValue: new Date().toISOString() },
              uidAssignedByUid: { stringValue: claims.user_id },
              uidAssignedByEmail: { stringValue: email || String(profile?.fields?.email?.stringValue || "") },
              uidAssignmentMethod: { stringValue: "ADMIN_RECONCILIATION_EXACT_EMAIL_MATCH" }
            }, ["uid", "uidAssignedAt", "uidAssignedByUid", "uidAssignedByEmail", "uidAssignmentMethod"]);
          }
        } catch (error) {
          line.status = "error";
          line.reason = "Step " + step + " failed: " + String(error?.message || error);
        }
        results.push(line);
      }
    }
    const summary = summarizeIdentityReconciliation(results);
    if (dryRun) {
      return json({ ok: true, dryRun: true, results, summary, authUsers: authUsers.length, auditWritten: false, safety: { accountCreationPerformed: false, existingUidsOverwritten: false, exactEmailMatchOnly: true, writesPerformed: false } }, 200, corsHeaders(request));
    }
    step = "Write reconciliation audit";
    const auditId = "identity-reconcile-" + Date.now() + "-" + crypto.randomUUID().slice(0, 8);
    await updateFirestoreDocument(env, "audit/" + auditId, firestoreToken, {
      action: { stringValue: "REGISTERED_IDENTITY_UID_RECONCILIATION" },
      category: { stringValue: "SYSTEM_ADMINISTRATION" },
      description: { stringValue: "Administrator-controlled exact-email UID reconciliation. Existing UIDs are never overwritten and no Firebase accounts are created." },
      performedByUid: { stringValue: claims.user_id },
      performedByEmail: { stringValue: email || String(profile?.fields?.email?.stringValue || "") },
      authUsersScanned: { integerValue: String(authUsers.length) },
      summary: { mapValue: { fields: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, { integerValue: String(value) }])) } },
      results: { arrayValue: { values: results.map(item => ({ mapValue: { fields: Object.fromEntries(Object.entries(item).map(([key, value]) => [key, value == null ? { nullValue: null } : { stringValue: String(value) }])) } })) } },
      accountCreationPerformed: { booleanValue: false },
      existingUidsOverwritten: { booleanValue: false },
      createdAt: { timestampValue: new Date().toISOString() }
    }, ["action", "category", "description", "performedByUid", "performedByEmail", "authUsersScanned", "summary", "results", "accountCreationPerformed", "existingUidsOverwritten", "createdAt"]);
    return json({ ok: true, results, summary, authUsers: authUsers.length, auditId, safety: { accountCreationPerformed: false, existingUidsOverwritten: false, exactEmailMatchOnly: true } }, 200, corsHeaders(request));
  } catch (error) {
    console.error("Registered identity UID reconciliation failed", { step, error: String(error?.message || error) });
    return json({ ok: false, step, error: String(error?.message || "Registered identity reconciliation failed.") }, Number(error?.status || 0) || 500, corsHeaders(request));
  }
}

async function actualDataAccessRoute(request, env) {
  let step = 'Firebase authentication';
  try {
    const claims = await authenticateFirebaseRequest(request, env);
    step = 'Administrator profile lookup';
    step = "token creation";
    let adminToken;
    try { adminToken = await getFirestoreAdminAccessToken(env); }
    catch (error) { error.diagnosticStep = String(error?.message || "").includes("obtain an access token") ? "token exchange" : "token creation"; throw error; }
    const profile = await getFirestoreDocument(env, 'adminProfiles/' + claims.user_id, adminToken);
    const email = String(claims.email || '').trim().toLowerCase();
    const adminAllowed = email === 'irpa2412@gmail.com' || (profile?.fields?.active?.booleanValue === true && profile?.fields?.role?.stringValue === 'Administrator');
    if (!adminAllowed) return json({ok:false,step,error:'Only an active IRPA Administrator may change actual-data access.'},403,corsHeaders(request));
    step = 'Read actual-data setting';
    const path = 'systemSettings/actualDataAccess';
    const previous = await getFirestoreDocument(env, path, adminToken);
    const fields = previous?.fields || {};
    if (request.method === 'GET') return json({ok:true,enabled:fields.enabled?.booleanValue===true,status:fields.status?.stringValue || 'CLOSED',finalTestsAttested:fields.finalTestsAttested?.booleanValue===true,changedAt:fields.changedAt?.timestampValue||null,changedByEmail:fields.changedByEmail?.stringValue||null},200,corsHeaders(request));
    step = 'Validate request and attestation';
    const body = await request.json();
    const policy = evaluateActualDataAccessPolicy({adminAllowed,enabled:body.enabled,confirmation:body.confirmation});
    if (!policy.allowed) return json({ok:false,step:policy.step,error:policy.error},policy.status,corsHeaders(request));
    const enabled = body.enabled;
    const version = Number(fields.version?.integerValue || 0) + 1;
    const now = new Date().toISOString();
    const emailValue = email || profile?.fields?.email?.stringValue || '';
    const nextFields = {enabled:{booleanValue:enabled},status:{stringValue:enabled?'OPEN':'CLOSED'},changedByUid:{stringValue:claims.user_id},changedByEmail:{stringValue:emailValue},changedAt:{timestampValue:now},version:{integerValue:String(version)},finalTestsAttested:{booleanValue:enabled},finalTestsAttestedByUid:enabled?{stringValue:claims.user_id}:{nullValue:null},finalTestsAttestedByEmail:enabled?{stringValue:emailValue}:{nullValue:null},finalTestsAttestedAt:enabled?{timestampValue:now}:{nullValue:null}};
    step = 'Commit actual-data setting and audit atomically';
    const auditId = 'actual-data-' + Date.now() + '-' + crypto.randomUUID().slice(0,12);
    const base = 'projects/' + getFirebaseProjectId(env) + '/databases/(default)/documents';
    const auditFields = {action:{stringValue:enabled?'ACTUAL_DATA_ACCESS_OPENED':'ACTUAL_DATA_ACCESS_CLOSED'},category:{stringValue:'SYSTEM_SECURITY'},description:{stringValue:enabled?'Administrator opened actual-data entry after attesting final system tests passed.':'Administrator closed actual-data entry.'},actorUid:{stringValue:claims.user_id},actorEmail:{stringValue:emailValue},previousStatus:{stringValue:fields.enabled?.booleanValue===true?'OPEN':'CLOSED'},newStatus:{stringValue:enabled?'OPEN':'CLOSED'},finalTestsAttested:{booleanValue:enabled},createdAt:{timestampValue:now}};
    const settingName = base + '/systemSettings/actualDataAccess';
    const auditName = base + '/audit/' + auditId;
    const writes = [
      {update:{name:settingName,fields:nextFields},updateMask:{fieldPaths:Object.keys(nextFields)}},
      {update:{name:auditName,fields:auditFields},currentDocument:{exists:false}}
    ];
    const commitResponse = await fetch('https://firestore.googleapis.com/v1/' + base + ':commit',{method:'POST',headers:{Authorization:'Bearer '+adminToken,'Content-Type':'application/json'},body:JSON.stringify({writes})});
    if (!commitResponse.ok) {
      const detail = await commitResponse.json().catch(()=>({}));
      throw new Error('Firestore atomic setting/audit commit returned HTTP ' + commitResponse.status + ': ' + String(detail?.error?.message||'no detail').slice(0,180));
    }
    return json({ok:true,enabled,status:enabled?'OPEN':'CLOSED',finalTestsAttested:enabled,version},200,corsHeaders(request));
  } catch (error) {
    console.error('Actual-data access route failed',{step,message:String(error?.message||error).slice(0,240)});
    return json({ok:false,step,error:step+' failed: '+String(error?.message||error).slice(0,240)},Number(error?.status)||500,corsHeaders(request));
  }
}

function signatureDraftFirestoreValue(value, key = "") {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(item => signatureDraftFirestoreValue(item)) } };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "string") { if (/(?:At|Date)$/.test(key) && /^\d{4}-\d{2}-\d{2}T/.test(value)) return { timestampValue: value }; return { stringValue: value }; }
  if (typeof value === "object") { if (Number.isFinite(Number(value.seconds)) && value.seconds !== undefined) return { timestampValue: new Date(Number(value.seconds) * 1000 + Number(value.nanoseconds || 0) / 1e6).toISOString() }; return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([name, item]) => [name, signatureDraftFirestoreValue(item, name)])) } }; }
  return { nullValue: null };
}

async function firebaseServiceAccountDiagnostic(env) {
  const raw = String(env?.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return { status: "binding absent" };
  let account;
  try { account = JSON.parse(raw); }
  catch { return { status: "not valid JSON" }; }
  if (!account || typeof account !== "object" ||
      !String(account.client_email || "").trim() ||
      !String(account.private_key || "").trim() ||
      !String(account.project_id || "").trim()) {
    return { status: "JSON missing client_email, private_key or project_id" };
  }
  if (String(account.project_id).trim() !== String(env?.FIREBASE_PROJECT_ID || "").trim()) {
    return { status: "project_id differs from FIREBASE_PROJECT_ID" };
  }
  try {
    await crypto.subtle.importKey("pkcs8", pemPrivateKeyBytes(account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    return { status: "private key import failed" };
  }
  return { status: "valid" };
}

async function systemDiagnosticsRoute(request, env) {
  const serviceAccountDiagnostic = await firebaseServiceAccountDiagnostic(env);
  const base = { ok:false, workerCommit:String(env.GIT_SHA || "unknown"), firebaseProjectId:String(env.FIREBASE_PROJECT_ID || "unconfigured"), serviceAccountDiagnostic, requiredConfiguration:{ FIREBASE_SERVICE_ACCOUNT_JSON:Boolean(String(env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim()), FIREBASE_PROJECT_ID:Boolean(String(env.FIREBASE_PROJECT_ID || "").trim()), GIT_SHA:Boolean(String(env.GIT_SHA || "").trim()) }, adminToken:{created:false}, firestoreRead:{attempted:false,ok:false} };
  try {
    const claims = await authenticateFirebaseRequest(request, env);
    const uid = String(claims.user_id || "");
    const email = String(claims.email || "").trim().toLowerCase();
    const profile = await getFirestoreDocument(env, "adminProfiles/" + uid, claims.token);
    const isAdmin = email === "irpa2412@gmail.com" || Boolean(profile?.fields?.active?.booleanValue === true && profile?.fields?.role?.stringValue === "Administrator");
    if (!isAdmin) return json({...base,error:"Administrator authorization is required."},403,corsHeaders(request));
    let token;
    try { token = await getFirestoreAdminAccessToken(env); base.adminToken = {created:true}; }
    catch (error) { base.adminToken = {created:false,error:String(error?.message || error).slice(0,220)}; return json({...base,error:"Admin token creation/exchange failed."},200,corsHeaders(request)); }
    base.firestoreRead = {attempted:true,ok:false,target:"adminProfiles/" + uid};
    try { const doc = await getFirestoreDocument(env,"adminProfiles/" + uid,token); base.firestoreRead = {attempted:true,ok:true,documentFound:Boolean(doc?.fields),target:"adminProfiles/" + uid}; }
    catch(error) { base.firestoreRead.error = String(error?.message || error).slice(0,220); }
    base.ok = base.adminToken.created && base.firestoreRead.ok;
    return json(base,200,corsHeaders(request));
  } catch(error) { return json({...base,error:String(error?.message || error).slice(0,220)},Number(error?.status)||401,corsHeaders(request)); }
}

async function saveSignatureWorkflowDraftRoute(request, env) {
  let step = "Firebase authentication";
  try {
    const claims = await authenticateFirebaseRequest(request, env);
    const uid = String(claims.user_id || "");
    const email = String(claims.email || "").trim().toLowerCase();
    const adminToken = await getFirestoreAdminAccessToken(env);
    step = "Resolve active administrator/member/employee authority";
    const adminProfile = await getFirestoreDocument(env, "adminProfiles/" + uid, adminToken);
    const activeAdmin = email === "irpa2412@gmail.com" || (adminProfile && adminProfile.fields && adminProfile.fields.active && adminProfile.fields.active.booleanValue === true && adminProfile.fields.role && adminProfile.fields.role.stringValue === "Administrator");
    let member = await getFirestoreDocument(env, "members/" + uid, adminToken);
    if (!member && email) member = (await getFirestoreDocumentsByEmail(env, "members", email, adminToken))[0] || null;
    const memberStatus = member && member.fields && ((member.fields.status && member.fields.status.stringValue) || (member.fields.registrationStatus && member.fields.registrationStatus.stringValue) || "");
    const activeMember = Boolean(member && member.fields) && ["Active", "Activated"].includes(memberStatus) && !(member.fields.accountActivated && member.fields.accountActivated.booleanValue === false);
    if (!activeAdmin && !activeMember) return json({ok:false,step,error:"An active IRPA administrator or member profile is required to save a signing draft."},403,corsHeaders(request));
    step = "Validate draft and source controlled document";
    const body = await request.json();
    const draft = body && body.draft || {};
    const envelopeId = String(draft.envelopeReference || body.envelopeId || "").trim();
    const documentId = String(draft.documentId || "").trim();
    if (!/^[A-Za-z0-9_-]{6,150}$/.test(envelopeId) || !/^[A-Za-z0-9_-]{1,150}$/.test(documentId) || !String(draft.title || "").trim() || !String(draft.documentUrl || "").trim()) return json({ok:false,step,error:"A valid envelope ID, title, canonical document ID and controlled document URL are required."},400,corsHeaders(request));
    const source = await getFirestoreDocument(env, "documents/" + documentId, adminToken);
    if (!source || !source.fields) return json({ok:false,step,error:"The selected controlled document was not found."},404,corsHeaders(request));
    const sourceData = firestoreDocumentToPlain(source) || {};
    const existing = await getFirestoreDocument(env, "signatureEnvelopes/" + envelopeId, adminToken);
    const existingData = firestoreDocumentToPlain(existing) || {};
    if (existing && String(existingData.ownerUid || existingData.senderUid || "") !== uid) return json({ok:false,step,error:"Only the original signing-draft owner may update this envelope."},403,corsHeaders(request));
    const recipients = Array.isArray(draft.recipients) ? draft.recipients : [];
    const fields = Array.isArray(draft.fields) ? draft.fields : [];
    const participantUids = Array.from(new Set(recipients.map(item => String(item && item.uid || "")).filter(Boolean)));
    if (!participantUids.includes(uid)) return json({ok:false,step,error:"The authenticated owner must be a participant in the signing envelope."},400,corsHeaders(request));
    if (fields.some(field => field && field.signerUid && !participantUids.includes(String(field.signerUid)))) return json({ok:false,step,error:"Every assigned field must belong to a participant in this envelope."},400,corsHeaders(request));
    const now = new Date().toISOString();
    const envelope = {...draft,envelopeReference:envelopeId,title:String(draft.title).trim(),documentId,senderUid:uid,senderEmail:email,ownerUid:uid,ownerEmail:email,recordOrigin:String(sourceData.recordOrigin || "PRODUCTION").toUpperCase()==="TRIAL"?"TRIAL":"PRODUCTION",trialData:String(sourceData.recordOrigin || "PRODUCTION").toUpperCase()==="TRIAL",status:"Draft",recipients,fields,participantUids,actionUids:Array.from(new Set(fields.map(field=>String(field && field.signerUid || "")).filter(Boolean))),updatedAt:now,...(existing?{}:{createdAt:now})};
    delete envelope.id;
    step = "Commit envelope, source-document link and audit event atomically";
    const base = "projects/" + getFirebaseProjectId(env) + "/databases/(default)/documents";
    const eventId = "signature-draft-" + Date.now() + "-" + crypto.randomUUID().slice(0,10);
    const event = {envelopeId,event:"Owner Section Saved",details:{ownerUid:uid,fieldCount:fields.filter(field=>field && field.signerUid===uid).length,recipientCount:recipients.length,writePath:"authenticated-worker"},actorUid:uid,actorEmail:email,createdAt:now};
    const docFields = {signatureEnvelopeId:signatureDraftFirestoreValue(envelopeId),signatureReference:signatureDraftFirestoreValue(envelopeId),signatureStatus:signatureDraftFirestoreValue("Draft"),signatureOwnerUid:signatureDraftFirestoreValue(uid),workflowOwnerSectionSaved:signatureDraftFirestoreValue(true),authorizationRequestId:signatureDraftFirestoreValue(draft.authorizationRequestId || null),authorizationReference:signatureDraftFirestoreValue(draft.authorizationReference || null),updatedAt:signatureDraftFirestoreValue(now)};
    const writes = [
      {update:{name:base+"/signatureEnvelopes/"+envelopeId,fields:signatureDraftFirestoreValue(envelope).mapValue.fields},updateMask:{fieldPaths:Object.keys(envelope)},currentDocument:{exists:Boolean(existing)}},
      {update:{name:base+"/documents/"+documentId,fields:docFields},updateMask:{fieldPaths:Object.keys(docFields)},currentDocument:{exists:true}},
      {update:{name:base+"/signatureEvents/"+eventId,fields:signatureDraftFirestoreValue(event).mapValue.fields},currentDocument:{exists:false}}
    ];
    step = "Firestore commit";
    const response = await fetch("https://firestore.googleapis.com/v1/projects/"+getFirebaseProjectId(env)+"/databases/(default)/documents:commit",{method:"POST",headers:{Authorization:"Bearer "+adminToken,"Content-Type":"application/json"},body:JSON.stringify({writes})});
    if (!response.ok) { const detail=await response.json().catch(()=>({})); const ge=detail && detail.error || {}; const err=new Error(String(ge.message || "Google returned no error message").replace(/[\r\n]/g," ").slice(0,240)); err.firestoreHttpStatus=response.status; err.googleStatus=String(ge.status || "UNKNOWN").slice(0,100); err.googleMessage=String(ge.message || "No Google error message").replace(/[\r\n]/g," ").slice(0,240); throw err; }
    return json({ok:true,envelopeId,draft:envelope,writePath:"authenticated-worker",atomic:true},200,corsHeaders(request));
  } catch (error) { const failedStep=String(error?.diagnosticStep||step); const diagnostics={step:failedStep,firestoreHttpStatus:Number(error?.firestoreHttpStatus)||null,googleStatus:String(error?.googleStatus||"UNKNOWN"),googleMessage:String(error?.googleMessage||error?.message||"No detail").replace(/[\r\n]/g," ").slice(0,240)}; console.error("Signature workflow draft save failed",diagnostics); return json({ok:false,step:failedStep,error:failedStep+" failed: "+String(error?.message||error).replace(/[\r\n]/g," ").slice(0,240),diagnostics},Number(error?.status)||500,corsHeaders(request)); }
}
async function reconcileSignatureDocumentIds(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const adminRecord = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
  if (!adminRecord?.fields?.active?.booleanValue && String(claims.email || "").trim().toLowerCase() !== "irpa2412@gmail.com") {
    return json({ok:false,error:"Administrator authorization is required for signature-pathway reconciliation."},403,corsHeaders(request));
  }
  const body = await request.json();
  const dryRun = body?.dryRun === true;
  const items = Array.isArray(body.documents) ? body.documents : [];
  if (!items.length && dryRun) return json({ok:true,dryRun:true,results:[],summary:{total:0,repaired:0,alreadyCorrect:0,failed:0},writesPerformed:false,driveMutationsPerformed:false,note:"Authenticated administrator check passed; no document IDs were supplied, so no document was inspected."},200,corsHeaders(request));
  if (!items.length) return json({ok:false,error:"No document IDs were supplied for reconciliation."},400,corsHeaders(request));
  if (items.length > 250) return json({ok:false,error:"Reconciliation is limited to 250 documents per request."},400,corsHeaders(request));
  const accessToken = await getDriveAccessToken(env);
  const results = [];
  for (const item of items) {
    const documentId = String(item?.documentId || "").trim();
    const fileId = String(item?.fileId || "").trim();
    const line = {documentId:documentId || "(missing ID)",fileId:fileId || "(missing Drive file ID)",status:"failed",reason:""};
    try {
      if (!documentId || !fileId) throw new Error("documentId and fileId are both required.");
      const record = await getFirestoreDocument(env, `documents/${cleanId(documentId)}`, claims.token);
      if (!record?.fields) throw new Error("Firestore controlled-document record was not found.");
      const recordFields = record.fields;
      const registeredIds = [
        recordFields.fileId?.stringValue,
        recordFields.driveFileId?.stringValue,
        recordFields.archiveFileId?.stringValue,
        recordFields.governanceArchiveFileId?.stringValue,
        recordFields.sourceFileId?.stringValue
      ].filter(Boolean).map(String);
      if (!registeredIds.includes(fileId)) throw new Error("The supplied Drive file ID is not registered on this Firestore document.");
      const metadata = await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,description,createdTime`);
      line.driveCreatedTime = metadata.createdTime || "(not reported)";
      const description = parseDescription(metadata.description);
      if (!description?.irpaGovernance) throw new Error("Drive file is not marked as an IRPA governance document.");
      const previousDocumentId = String(description.documentId || "");
      line.previousDescriptionDocumentId = previousDocumentId || "(missing)";
      if (previousDocumentId === documentId) {
        line.status = "already correct";
        line.reason = "Drive description.documentId already matches the Firestore document ID (" + documentId + ").";
      } else if (dryRun) {
        line.status = "would repair";
        line.reason = "Dry run only: Drive description.documentId is currently " + (previousDocumentId || "(missing)") + " and would be set to " + documentId + ".";
      } else {
        const repairedDescription = {...description,documentId,documentUid:documentId};
        await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,description`, {
          method:"PATCH",
          body:JSON.stringify({description:JSON.stringify(repairedDescription)})
        });
        const verified = await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,description`);
        const verifiedDescription = parseDescription(verified.description);
        if (String(verifiedDescription.documentId || "") !== documentId) throw new Error("Drive description verification failed after repair; expected " + documentId + " but found " + String(verifiedDescription.documentId || "(missing)") + ".");
        line.status = "repaired";
        line.reason = "Drive description.documentId was " + (previousDocumentId || "(missing)") + "; repaired and verified as " + documentId + ".";
      }
    } catch (error) {
      line.status = "failed";
      line.reason = error?.message || "Unknown reconciliation failure.";
    }
    results.push(line);
  }
  return json({ok:true,dryRun,results,summary:{total:results.length,repaired:results.filter(x=>x.status==="repaired").length,wouldRepair:results.filter(x=>x.status==="would repair").length,alreadyCorrect:results.filter(x=>x.status==="already correct").length,failed:results.filter(x=>x.status==="failed").length},writesPerformed:false,driveMutationsPerformed:!dryRun&&results.some(x=>x.status==="repaired")},200,corsHeaders(request));
}

async function controlledDocumentUploadPolicyCheck(request, env) {
  let step = "Firebase authentication";
  try {
    const claims = await authenticateFirebaseRequest(request, env);
    step = "Resolve active institutional profile";
    const { memberRecord, employeeRecord } = await getInstitutionalProfileForUser(env, claims);
    const adminRecord = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
    if (!memberRecord && !employeeRecord && !adminRecord?.fields?.active?.booleanValue) {
      return json({ ok: false, step, error: "An active IRPA member, employee or administrator profile is required for controlled document upload policy checks." }, 403, corsHeaders(request));
    }
    step = "Validate upload policy (no upload)";
    const data = await request.json();
    const contentType = String(data.contentType || "application/pdf").toLowerCase();
    const fileSize = Number(data.fileSize || 0);
    const archiveCategory = String(data.archiveCategory || "Administrative Documents").trim();
    const classification = String(data.classification || "Public").trim();
    const allowedCategories = ["Finance Documents","Procurement Documents","Governance Documents","Administrative Documents","Administrator Documents"];
    const allowedClassifications = ["Public","Internal","Confidential","Restricted"];
    const problems = [];
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) problems.push("Unsupported content type.");
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) problems.push("File size must be between 1 byte and 10 MB.");
    if (!allowedCategories.includes(archiveCategory)) problems.push("Invalid document archive category.");
    if (!allowedClassifications.includes(classification)) problems.push("Invalid document access classification.");
    return json({ ok: problems.length === 0, step, policyAllowed: problems.length === 0, problems, checked: { contentType, fileSize, archiveCategory, classification }, writesPerformed: false, driveUploadPerformed: false, firebaseProjectId: getFirebaseProjectId(env) }, problems.length ? 400 : 200, corsHeaders(request));
  } catch (error) {
    return json({ ok: false, step, error: step + " failed: " + String(error?.message || error).slice(0, 240), writesPerformed: false, driveUploadPerformed: false }, Number(error?.status) || 500, corsHeaders(request));
  }
}

async function uploadControlledDocument(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const { memberRecord, employeeRecord } = await getInstitutionalProfileForUser(env, claims);
  const adminRecord = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
  if (!memberRecord && !employeeRecord && !adminRecord?.fields?.active?.booleanValue) {
    return json({ok:false,error:"An active IRPA member, employee or administrator profile is required for controlled document upload."},403,corsHeaders(request));
  }
  const data = await request.json();
  const fileName = cleanName(data.fileName || "IRPA-governance-document.pdf");
  const contentType = String(data.contentType || "application/pdf").toLowerCase();
  const fileSize = Number(data.fileSize || 0);
  const base64 = String(data.base64 || "");
  const title = cleanName(data.title || fileName.replace(/\\.pdf$/i, ""));
  const reference = cleanName(data.reference || "");
  const documentId = cleanId(data.documentId || "");
  if (!documentId) return json({ok:false,error:"STEP upload-controlled-document: the final Firestore document ID is required before Drive upload."},400,corsHeaders(request));
  const documentType = cleanName(data.documentType || "Governance Document");
  const archiveCategory = String(data.archiveCategory || "Administrative Documents").trim();
  const classification = String(data.classification || "Public").trim();
  const governanceArchive = data.governanceArchive !== false && /governance/i.test(documentType);

  const allowedCategories = ["Finance Documents","Procurement Documents","Governance Documents","Administrative Documents","Administrator Documents"];
  const allowedClassifications = ["Public","Internal","Confidential","Restricted"];
  if (!allowedCategories.includes(archiveCategory)) return json({ok:false,error:"Invalid document archive category."},400,corsHeaders(request));
  if (!allowedClassifications.includes(classification)) return json({ok:false,error:"Invalid document access classification."},400,corsHeaders(request));
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) return json({ok:false,error:"This document format is not supported for controlled-document routing."},400,corsHeaders(request));
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) return json({ok:false,error:"Uploaded documents must not exceed 10 MB."},400,corsHeaders(request));

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytes.length !== fileSize) return json({ok:false,error:"Uploaded document size could not be verified."},400,corsHeaders(request));

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, getDriveRootFolderName(env));

  const archiveRootId = await findOrCreateFolder(env, accessToken, "Document Archives", rootId, {
    irpaGovernanceArchive:true,
    purpose:"Controlled Document Archives"
  });
  const categoryId = await findOrCreateFolder(env, accessToken, archiveCategory, archiveRootId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    purpose:"Controlled Document Category"
  });
  const classificationId = await findOrCreateFolder(env, accessToken, classification, categoryId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    classification,
    purpose:"Controlled Document Classification"
  });
  const folderName = `IRPA-DOC-${documentId}`;
  const categoryFolderId = await findOrCreateFolder(env, accessToken, folderName, classificationId, {
    irpaGovernanceArchive:true,
    purpose:"Controlled Document",
    documentId,
    documentUid:documentId,
    documentTitle:title,
    documentReference:reference,
    archiveCategory,
    classification,
    publicAccess:classification==="Public"
  });
  if (classification==="Public") await ensureAnyoneReaderPermission(env,accessToken,categoryFolderId);

  let governanceRootId = null;
  let governanceClassificationId = null;
  let governanceFolderId = null;
  if (governanceArchive) {
    governanceRootId = await findOrCreateFolder(env, accessToken, "Board of Directors Governance Archive", rootId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      purpose:"Board of Directors Governance Documents"
    });
    governanceClassificationId = await findOrCreateFolder(env, accessToken, classification, governanceRootId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      classification,
      purpose:"Board of Directors Governance Classification"
    });
    governanceFolderId = await findOrCreateFolder(env, accessToken, folderName, governanceClassificationId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      purpose:"Board of Directors Governance Document",
      documentId,
      documentUid:documentId,
      documentTitle:title,
      documentReference:reference,
      archiveCategory,
      classification
    });
    if (classification==="Public") await ensureAnyoneReaderPermission(env,accessToken,governanceFolderId);
  }

  const uploadToFolder = async (folderId, purposeLabel, archiveChannel) => {
    const metadata = {
      name:fileName,
      parents:[folderId],
      mimeType:contentType,
      description:JSON.stringify({
        irpaGovernance:true,
        irpaBoardGovernanceArchive:archiveChannel==="Board of Directors Governance Archive",
        uploadedByUid:claims.user_id,
        purpose:purposeLabel,
        documentId,
        documentUid:documentId,
        documentTitle:title,
        documentReference:reference,
        archiveCategory,
        classification,
        archiveChannel
      })
    };
    const boundary=`irpa-${crypto.randomUUID()}`;
    const body=buildMultipartBody(boundary,metadata,bytes,contentType);
    const response=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,createdTime,parents",{
      method:"POST",
      headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":`multipart/related; boundary=${boundary}`},
      body
    });
    const result=await response.json();
    if(!response.ok) throw new Error(result.error?.message || `Google Drive upload failed for ${archiveChannel}.`);
    const metadataPath = `/drive/v3/files/${encodeURIComponent(result.id)}?fields=id,description`;
    let stored = await driveFetch(env, accessToken, metadataPath);
    let storedDescription = parseDescription(stored.description);
    if (String(storedDescription.documentId || "") !== documentId) {
      storedDescription = {...storedDescription,irpaGovernance:true,documentId,documentUid:documentId};
      await driveFetch(env, accessToken, metadataPath, {method:"PATCH",body:JSON.stringify({description:JSON.stringify(storedDescription)})});
      stored = await driveFetch(env, accessToken, metadataPath);
      storedDescription = parseDescription(stored.description);
    }
    if (String(storedDescription.documentId || "") !== documentId) throw new Error("Controlled upload failed metadata verification: expected Drive description.documentId " + documentId + " but found " + String(storedDescription.documentId || "(missing)") + ".");
    return {
      fileId:result.id,
      fileName:result.name,
      fileSize:Number(result.size||fileSize),
      webViewLink:result.webViewLink||`https://drive.google.com/file/d/${result.id}/view`,
      folderId,
      archiveChannel
    };
  };

  const categoryFile=await uploadToFolder(categoryFolderId,"Controlled Documents",archiveCategory);
  const governanceFile=governanceFolderId
    ? await uploadToFolder(governanceFolderId,"Board of Directors Governance Documents","Board of Directors Governance Archive")
    : null;

  return json({
    ok:true,
    documentId,
    fileName,
    fileSize,
    storageProvider:"Google Drive",
    categoryArchive:{
      archiveRootId,
      categoryId,
      classificationId,
      folderId:categoryFolderId,
      archiveCategory,
      classification,
      archivePath:`IRPA Governance System/Document Archives/${archiveCategory}/${classification}/${folderName}`,
      archiveUidLink:`https://drive.google.com/drive/folders/${encodeURIComponent(categoryFolderId)}`,
      file:categoryFile
    },
    governanceArchive:governanceFile ? {
      rootId:governanceRootId,
      classificationId:governanceClassificationId,
      folderId:governanceFolderId,
      archivePath:`IRPA Governance System/Board of Directors Governance Archive/${classification}/${folderName}`,
      archiveUidLink:`https://drive.google.com/drive/folders/${encodeURIComponent(governanceFolderId)}`,
      file:governanceFile
    } : null
  },200,corsHeaders(request));
}

function communicationMediaRoleValues(record){
  if(!record)return [];
  return [record.role,record.title,record.position,record.departmentalRole,record.boardPosition,record.unit,record.unitName,...(Array.isArray(record.roles)?record.roles:[]),...(Array.isArray(record.assignedRoles)?record.assignedRoles:[]),...(Array.isArray(record.selectedRoles)?record.selectedRoles:[]),...(Array.isArray(record.roleAssignments)?record.roleAssignments:[])]
    .filter(Boolean).flatMap(value=>String(value).split(",").map(value=>value.trim()).filter(Boolean));
}
async function authorizeCommunicationMediaDownload(env,claims){
  const email=String(claims.email||"").trim().toLowerCase();
  const [adminRaw,memberRaw,employeeRaw]=await Promise.all([
    getFirestoreDocument(env,"adminProfiles/"+claims.user_id,claims.token).catch(()=>null),
    getFirestoreDocument(env,"members/"+claims.user_id,claims.token).catch(()=>null),
    getFirestoreDocument(env,"employees/"+claims.user_id,claims.token).catch(()=>null)
  ]);
  const admin=firestoreDocumentToPlain(adminRaw);
  const member=firestoreDocumentToPlain(memberRaw);
  const employee=firestoreDocumentToPlain(employeeRaw);
  if(email==="irpa2412@gmail.com"||admin?.active===true)return true;
  const allowed=["Communications Officer","Communications Manager","Media Officer","Public Relations Officer","Executive Director","Director Outreach","Outreach Director","Director Community Development","Community Development Director","Administrator"];
  const roles=[...new Set([...communicationMediaRoleValues(member),...communicationMediaRoleValues(employee)])];
  const active=Boolean((member && (["Active","Activated"].includes(String(member.status||"")) || member?.registrationStatus==="Activated")) || (employee && (["Active","Activated"].includes(String(employee.status||"")) || employee?.employmentStatus==="Active")));
  return Boolean(active&&roles.some(role=>allowed.includes(role)));
}

async function provisionCommunicationMediaArchive(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  if (!(await authorizeCommunicationMediaDownload(env, claims))) {
    return json({ok:false,error:"Your registered IRPA role does not permit communications media archive administration."},403,corsHeaders(request));
  }
  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, getDriveRootFolderName(env));
  const archiveId = await findOrCreateFolder(env, accessToken, "Communication and Media Archive", rootId, {
    irpaCommunicationMediaArchive:true,
    irpaGovernanceArchive:true,
    purpose:"IRPA Communication and Media Archive",
    archiveVersion:1
  });
  const folder = await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(archiveId)}?fields=id,name,mimeType,description,trashed,webViewLink`);
  const description = parseDescription(folder.description);
  if (folder.mimeType !== "application/vnd.google-apps.folder" || folder.trashed || description.irpaCommunicationMediaArchive !== true || description.purpose !== "IRPA Communication and Media Archive") {
    return json({ok:false,error:"The Communication and Media Archive could not be verified. No media was uploaded."},409,corsHeaders(request));
  }
  return json({ok:true,archiveName:folder.name,folderId:folder.id,archivePath:getDriveRootFolderName(env)+"/Communication and Media Archive",storageProvider:"Google Drive"},200,corsHeaders(request));
}

async function provisionResearchKnowledgeArchive(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const email = String(claims.email || "").trim().toLowerCase();
  const authorisedEmail = String(env.AUTHORIZED_DRIVE_EMAIL || "").trim().toLowerCase();
  let authorised = claims.admin === true || Boolean(authorisedEmail && email === authorisedEmail);

  if (!authorised) {
    const employeeRaw = await getFirestoreDocument(env, "employees/" + claims.user_id, claims.token);
    const employee = firestoreDocumentToPlain(employeeRaw) || {};
    const department = String(employee.department || "").trim().toLowerCase();
    const active = ["Active", "Activated"].includes(String(employee.status || "")) ||
      employee.employmentStatus === "Active" || employee.registrationStatus === "Activated";
    const researchDepartments = new Set([
      "research", "research department", "research & knowledge",
      "research and knowledge", "research, statistics and knowledge",
      "research, statistics and knowledge department"
    ]);
    authorised = active && researchDepartments.has(department);
  }

  if (!authorised) {
    return json({ok:false,error:"Active Research Department membership or administrator authorization is required to provision the Research and Knowledge Archive."},403,corsHeaders(request));
  }

  const accessToken = await getDriveAccessToken(env);
  const rootName = getDriveRootFolderName(env);
  const rootId = await findOrCreateFolder(env, accessToken, rootName);
  const archiveName = "Research and Knowledge Archive";
  const archiveId = await findOrCreateFolder(env, accessToken, archiveName, rootId, {
    irpaResearchKnowledgeArchive: true,
    irpaGovernanceArchive: true,
    purpose: "IRPA Research and Knowledge Archive",
    archiveVersion: 1,
    archiveAccess: "Restricted",
    createdForDepartment: "Research, Statistics and Knowledge"
  });
  let archiveMetadata = await driveFetch(env, accessToken, "/drive/v3/files/" + encodeURIComponent(archiveId) + "?fields=id,name,mimeType,description,trashed,webViewLink,parents");
  let archiveDescription = parseDescription(archiveMetadata.description);
  const researchDepartmentOwner = "Research, Statistics and Knowledge Department";
  if (archiveMetadata.mimeType === "application/vnd.google-apps.folder" && !archiveMetadata.trashed &&
      archiveDescription.irpaResearchKnowledgeArchive === true &&
      archiveDescription.purpose === "IRPA Research and Knowledge Archive" &&
      (archiveDescription.createdForDepartment !== researchDepartmentOwner ||
       archiveDescription.departmentOwner !== researchDepartmentOwner ||
       archiveDescription.archiveOwnershipType !== "Department")) {
    const correctedDescription = {
      ...archiveDescription,
      irpaResearchKnowledgeArchive: true,
      irpaGovernanceArchive: true,
      purpose: "IRPA Research and Knowledge Archive",
      createdForDepartment: researchDepartmentOwner,
      departmentOwner: researchDepartmentOwner,
      archiveOwnershipType: "Department",
      archiveAccess: "Restricted"
    };
    await driveFetch(env, accessToken, "/drive/v3/files/" + encodeURIComponent(archiveId), {
      method: "PATCH",
      body: JSON.stringify({description: JSON.stringify(correctedDescription)})
    });
    archiveMetadata = await driveFetch(env, accessToken, "/drive/v3/files/" + encodeURIComponent(archiveId) + "?fields=id,name,mimeType,description,trashed,webViewLink,parents");
    archiveDescription = parseDescription(archiveMetadata.description);
  }
  if (archiveMetadata.mimeType !== "application/vnd.google-apps.folder" || archiveMetadata.trashed ||
      archiveDescription.irpaResearchKnowledgeArchive !== true ||
      archiveDescription.purpose !== "IRPA Research and Knowledge Archive" ||
      archiveDescription.createdForDepartment !== researchDepartmentOwner ||
      archiveDescription.departmentOwner !== researchDepartmentOwner ||
      archiveDescription.archiveOwnershipType !== "Department" ||
      !(Array.isArray(archiveMetadata.parents) && archiveMetadata.parents.includes(rootId))) {
    return json({ok:false,error:"The Research and Knowledge Archive folder could not be verified as owned by the Research, Statistics and Knowledge Department. No research files were uploaded."},409,corsHeaders(request));
  }

  const folderPolicies = [
    {name:"Approved Research Releases", classification:"Internal", purpose:"Approved summaries, findings, briefs and recommendations cleared for cross-portal publication"},
    {name:"Research Reports and Publications", classification:"Confidential", purpose:"Research reports, manuscripts and publications managed by the Research Department"},
    {name:"Restricted Research Datasets", classification:"Restricted", purpose:"Raw datasets and unpublished study materials restricted to authorized Research Department staff"},
    {name:"Supporting Evidence and Source Records", classification:"Restricted", purpose:"Evidence, source records and supporting materials with restricted access"},
    {name:"Research Information Access Requests", classification:"Confidential", purpose:"Documented requests, decisions and approvals for additional research information"}
  ];
  const folders = [];
  for (const policy of folderPolicies) {
    const folderId = await findOrCreateFolder(env, accessToken, policy.name, archiveId, {
      irpaResearchKnowledgeArchive: true,
      irpaGovernanceArchive: true,
      purpose: policy.purpose,
      researchArchiveCategory: policy.name,
      classification: policy.classification,
      archiveAccess: "Restricted"
    });
    const metadata = await driveFetch(env, accessToken, "/drive/v3/files/" + encodeURIComponent(folderId) + "?fields=id,name,mimeType,description,trashed,parents");
    const description = parseDescription(metadata.description);
    if (metadata.mimeType !== "application/vnd.google-apps.folder" || metadata.trashed ||
        description.irpaResearchKnowledgeArchive !== true ||
        description.researchArchiveCategory !== policy.name ||
        !(Array.isArray(metadata.parents) && metadata.parents.includes(archiveId))) {
      return json({ok:false,error:"Research archive subfolder verification failed for " + policy.name + "."},409,corsHeaders(request));
    }
    folders.push({name:metadata.name,folderId:metadata.id,classification:policy.classification,archiveAccess:"Restricted"});
  }

  return json({
    ok:true,
    provider:"Google Drive",
    archiveName,
    folderId:archiveId,
    archivePath:rootName + "/" + archiveName,
    archiveUidLink:"https://drive.google.com/drive/folders/" + encodeURIComponent(archiveId),
    archiveAccess:"Restricted",
    folders
  },200,corsHeaders(request));
}

async function download(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();
  const fileId = String(data.fileId || "").trim();
  if (!fileId) return json({ ok: false, error: "Google Drive file ID is required." }, 400, corsHeaders(request));

  if (data.documentId) {
    const document = await getFirestoreDocument(env, `documents/${cleanId(data.documentId)}`, claims.token);
    const fields = document?.fields || {};
    const authorizedUids = firestoreStringArray(fields.authorizedUids);
    const admin = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
    const isAdmin = Boolean(admin?.fields?.active?.booleanValue);
    if (!isAdmin && !authorizedUids.includes(claims.user_id)) {
      return json({ ok: false, error: "You are not authorized to retrieve this document." }, 403, corsHeaders(request));
    }
  }

  const accessToken = await getDriveAccessToken(env);
  const metadata = await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,description`);
  const description = parseDescription(metadata.description);
  if (!description?.irpaGovernance) {
    return json({ ok: false, error: "The requested file is not an IRPA governance document." }, 403, corsHeaders(request));
  }
  const purpose = String(description.purpose || "");
  if (purpose === "Communication Media" && !(await authorizeCommunicationMediaDownload(env, claims))) {
    return json({ ok:false, error:"Your registered IRPA role does not permit access to the communications media archive." },403,corsHeaders(request));
  }
  if (purpose === "Signed Documents Archive") {
    return json({ ok:false, error:"Signed workflow PDFs must be retrieved through the Signature Portal envelope-authorized route." },403,corsHeaders(request));
  }
  if (purpose === "Controlled Documents" || purpose === "Board of Directors Governance Documents") {
    if (!data.documentId || String(description.documentId || "") !== cleanId(data.documentId)) {
      return json({ ok:false, error:"Controlled document retrieval requires a matching document ID." },403,corsHeaders(request));
    }
  }
  if (description.purpose === "Signature Profile" && description.ownerUid !== claims.user_id) {
    return json({ ok: false, error: "This signature asset is restricted to its owner." }, 403, corsHeaders(request));
  }

  const size = Number(metadata.size || 0);
  if (size > (purpose === "Communication Media" ? 25 * 1024 * 1024 : MAX_BYTES)) return json({ ok: false, error: purpose === "Communication Media" ? "The requested media file exceeds the 25 MB limit." : "The requested file exceeds the 10 MB limit." }, 400, corsHeaders(request));

  const media = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!media.ok) throw new Error("Google Drive download failed.");

  const buffer = new Uint8Array(await media.arrayBuffer());
  return json({
    ok: true,
    fileId,
    fileName: metadata.name,
    contentType: metadata.mimeType,
    base64: uint8ToBase64(buffer)
  }, 200, corsHeaders(request));
}



async function downloadSignatureFile(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();
  const fileId = String(data.fileId || "").trim();
  const documentId = cleanId(data.documentId || "");
  const envelopeId = cleanId(data.envelopeId || "");
  if (!fileId) return json({ok:false,error:"Google Drive file ID is required."},400,corsHeaders(request));

  const accessToken = await getDriveAccessToken(env);
  const metadata = await driveFetch(env, accessToken, "/drive/v3/files/" + encodeURIComponent(fileId) + "?fields=id,name,mimeType,size,description");
  const description = parseDescription(metadata.description);
  if (!description?.irpaGovernance) return json({ok:false,error:"The requested file is not an IRPA governance document."},403,corsHeaders(request));

  const purpose = String(description.purpose || "");
  let allowed = false;
  if (purpose === "Signature Profile") {
    allowed = canReadSignatureAsset({
      authenticatedUid: claims.user_id,
      purpose,
      ownerUid: description.ownerUid,
    });
  } else if (purpose === "Signed Documents Archive") {
    if (!documentId || !envelopeId) return json({ok:false,error:"Signed workflow PDF retrieval requires its document and envelope IDs."},400,corsHeaders(request));
    const envelope = await getFirestoreDocument(env, "signatureEnvelopes/" + envelopeId, claims.token);
    const envelopeFields = envelope?.fields || {};
    const envelopeDocumentId = envelopeFields.documentId?.stringValue || "";
    if (!envelope || envelopeDocumentId !== documentId) return json({ok:false,error:"The signing envelope does not match the requested document."},403,corsHeaders(request));
    const envelopeParticipantUids = firestoreStringArray(envelopeFields.participantUids);
    const envelopeFileMatches = [
      envelopeFields.signedDocumentUrl?.stringValue,
      envelopeFields.ownerCompletedDocumentUrl?.stringValue,
      envelopeFields.completedDocumentUrl?.stringValue,
    ].some(value => String(value || "") === "drive://" + fileId);
    allowed = canReadSignatureAsset({
      authenticatedUid: claims.user_id,
      purpose,
      ownerUid: description.ownerUid,
      documentId,
      envelopeId,
      metadataDocumentId: description.documentId || "",
      metadataEnvelopeId: description.envelopeId || "",
      envelopeParticipantUids,
      envelopeFileMatches,
    });
  } else {
    if (!documentId) return json({ok:false,error:"Controlled document retrieval requires its document ID."},400,corsHeaders(request));
    const document = await getFirestoreDocument(env, "documents/" + documentId, claims.token);
    if (!document) return json({ok:false,error:"The controlled document record was not found."},404,corsHeaders(request));
    const fields = document.fields || {};
    const admin = await getFirestoreDocument(env, "adminProfiles/" + claims.user_id, claims.token);
    let envelopeFields = {};
    if (envelopeId) {
      const envelope = await getFirestoreDocument(env, "signatureEnvelopes/" + envelopeId, claims.token);
      const candidate = envelope?.fields || {};
      if (candidate.documentId?.stringValue === documentId) envelopeFields = candidate;
    }
    allowed = canReadSignatureAsset({
      authenticatedUid: claims.user_id,
      purpose,
      documentId,
      envelopeId,
      metadataDocumentId: description.documentId || "",
      isAdmin: Boolean(admin?.fields?.active?.booleanValue),
      documentOwnerUid: fields.ownerUid?.stringValue || "",
      authorizedUids: firestoreStringArray(fields.authorizedUids),
      envelopeParticipantUids: firestoreStringArray(envelopeFields.participantUids),
      envelopeDocumentId: envelopeFields.documentId?.stringValue || "",
    });
  }
  if (!allowed) return json({ok:false,error:"You are not authorized to retrieve this Signature Portal asset."},403,corsHeaders(request));

  const size = Number(metadata.size || 0);
  if (size > MAX_BYTES) return json({ok:false,error:"The requested file exceeds the 10 MB limit."},400,corsHeaders(request));
  const media = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!media.ok) throw new Error("Google Drive download failed.");
  const buffer = new Uint8Array(await media.arrayBuffer());
  return json({ok:true,fileId,fileName:metadata.name,contentType:metadata.mimeType,base64:uint8ToBase64(buffer)},200,corsHeaders(request));
}

async function finalizeSignatureProfileArchives(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();
  const envelopeId = cleanId(data.envelopeId || "");
  const finalHash = String(data.finalHash || "").trim();
  const originalHash = String(data.originalHash || "").trim();
  const base64 = String(data.base64 || "");
  const fileSize = Number(data.fileSize || 0);
  if (!envelopeId || !finalHash || !base64 || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) {
    return json({ok:false,error:"Completed signature archive data is incomplete."},400,corsHeaders(request));
  }

  const envelope = await getFirestoreDocument(env, `signatureEnvelopes/${envelopeId}`, claims.token);
  const fields = envelope?.fields || {};
  const status = fields.status?.stringValue || "";
  const lastSignedByUid = fields.lastSignedByUid?.stringValue || "";
  if (status !== "Completed" || lastSignedByUid !== claims.user_id) {
    return json({ok:false,error:"Final signer authorization is required before distributing the completed document to signer archives."},403,corsHeaders(request));
  }

  const recipients = firestoreMapArray(fields.recipients);
  const actionRecipients = recipients.filter(r => !r.accessOnly && r.uid);
  if (!actionRecipients.length) {
    return json({ok:true,envelopeId,deliveries:{}},200,corsHeaders(request));
  }

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytes.length !== fileSize) return json({ok:false,error:"Completed signed PDF size could not be verified."},400,corsHeaders(request));

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, getDriveRootFolderName(env));
  const signaturesId = await findOrCreateFolder(env, accessToken, "Signature Profiles", rootId);
  const deliveries = {};

  for (const recipient of actionRecipients) {
    const uid = cleanId(recipient.uid);
    const email = String(recipient.email || "").trim().toLowerCase();
    if (!uid) continue;
    const folderName = `IRPA-SIGNATURE-${uid}`;
    const folderId = await findOrCreateFolder(env, accessToken, folderName, signaturesId, {
      irpaGovernanceSignatureFolder: true,
      ownerUid: uid,
      folderUid: uid,
      purpose: "Member Signature Profile"
    });
    if (email) await ensureSignatureFolderPermission(env, accessToken, folderId, email);
    const completedFolderId = await findOrCreateFolder(env, accessToken, "Completed Signed Documents", folderId, {
      irpaGovernanceSignatureProfileArchive: true,
      ownerUid: uid,
      folderUid: uid,
      purpose: "Completed Documents Signed by Profile Owner"
    });
    const fileName = `completed-${envelopeId}-${finalHash}.pdf`;
    const metadata = {
      name: fileName,
      parents: [completedFolderId],
      mimeType: "application/pdf",
      description: JSON.stringify({
        irpaGovernance: true,
        uploadedByUid: claims.user_id,
        purpose: "Signature Profile",
        ownerUid: uid,
        envelopeId,
        signerUid: uid,
        finalSignerUid: claims.user_id,
        originalHash,
        finalHash,
        archiveProtocol: "IRPA-SIGNER-COPY-V2",
        archiveState: "Final Completed Document"
      })
    };
    const boundary = `irpa-${crypto.randomUUID()}`;
    const body = buildMultipartBody(boundary, metadata, bytes, "application/pdf");
    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,createdTime,parents", {
      method:"POST",
      headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":`multipart/related; boundary=${boundary}`},
      body
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || `Unable to archive completed document for signer ${uid}.`);
    deliveries[uid] = {
      fileId: result.id,
      fileName: result.name,
      webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
      folderId: completedFolderId,
      folderLink: `https://drive.google.com/drive/folders/${encodeURIComponent(completedFolderId)}`,
      myDocumentsPortal: "My Documents",
      myDocumentsPortalPath: `My Documents/Completed Signed Documents/${fileName}`,
      finalHash,
      archiveProtocol: "IRPA-SIGNER-COPY-V2"
    };
  }

  return json({ok:true,envelopeId,deliveries},200,corsHeaders(request));
}

async function ensureSignatureProfileFolder(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const { memberRecord, employeeRecord } = await getInstitutionalProfileForUser(env, claims);
  const adminRecord = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
  const isSignatureProfileOwner = Boolean(memberRecord) || Boolean(employeeRecord);
  const isAdmin = Boolean(adminRecord?.fields?.active?.booleanValue);
  if (!isSignatureProfileOwner && !isAdmin) {
    return json({ ok: false, error: "A registered IRPA member or employee profile is required before a Signature Profile archive can be created." }, 403, corsHeaders(request));
  }

  const data = await request.json();
  const requestedUid = cleanId(data.uid || claims.user_id);
  const requestedEmail = String(data.email || claims.email || "").trim().toLowerCase();
  if (!requestedUid) return json({ ok: false, error: "Member UID is required." }, 400, corsHeaders(request));
  if (requestedUid === claims.user_id && requestedEmail && requestedEmail !== String(claims.email || "").trim().toLowerCase()) {
    return json({ ok: false, error: "The signature-folder email does not match the authenticated account." }, 403, corsHeaders(request));
  }

  if (!canProvisionSignatureProfileFolder({ authenticatedUid: claims.user_id, requestedUid, isAdmin })) {
    return json({ ok: false, error: "You may only provision your own signature folder." }, 403, corsHeaders(request));
  }

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, getDriveRootFolderName(env));
  const signaturesId = await findOrCreateFolder(env, accessToken, "Signature Profiles", rootId);
  const folderName = `IRPA-SIGNATURE-${requestedUid}`;
  const folderId = await findOrCreateFolder(env, accessToken, folderName, signaturesId, {
    irpaGovernanceSignatureFolder: true,
    ownerUid: requestedUid,
    folderUid: requestedUid,
    purpose: "Member Signature Profile"
  });

  // Prescribed personal archive for every completed signing action by this profile.
  // It is a child of the established Signature Profile and is never a loose folder.
  const completedDocumentsFolderId = await findOrCreateFolder(
    env,
    accessToken,
    "Completed Signed Documents",
    folderId,
    {
      irpaGovernanceSignatureProfileArchive: true,
      ownerUid: requestedUid,
      folderUid: requestedUid,
      purpose: "Completed Documents Signed by Profile Owner"
    }
  );

  let folderShared = false;
  if (requestedEmail) {
    folderShared = await ensureSignatureFolderPermission(env, accessToken, folderId, requestedEmail);
  }

  return json({
    ok: true,
    uid: requestedUid,
    folderId,
    folderName,
    parentFolderId: signaturesId,
    completedDocumentsFolderId,
    completedDocumentsFolderName: "Completed Signed Documents",
    completedDocumentsFolderPath: `IRPA Governance System/Signature Profiles/${folderName}/Completed Signed Documents`,
    completedDocumentsFolderLink: `https://drive.google.com/drive/folders/${completedDocumentsFolderId}`,
    folderShared,
    path: `IRPA Governance System/Signature Profiles/${folderName}`
  }, 200, corsHeaders(request));
}


const MEETING_ARCHIVE_POLICIES = Object.freeze({
  GOVERNANCE: { label: "Governance Meetings", classification: "Restricted" },
  ADMINISTRATIVE: { label: "Administrative Meetings", classification: "Restricted" },
  STAFF: { label: "Staff Meetings", classification: "Internal" },
  GENERAL: { label: "General Meetings", classification: "Internal" },
  OTHER: { label: "Other Meetings", classification: "Restricted" }
});

async function meetingArchiveContext(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();
  const category = String(data.meetingCategory || "").trim().toUpperCase();
  const policy = MEETING_ARCHIVE_POLICIES[category];
  if (!policy) return { response: json({ok:false,error:"A valid meeting category is required."},400,corsHeaders(request)) };
  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, getDriveRootFolderName(env));
  const archiveRootId = await findOrCreateFolder(env, accessToken, "Meeting Archives", rootId, {
    irpaGovernanceArchive:true, purpose:"IRPA Meeting Product Archives"
  });
  return {claims,data,category,policy,accessToken,rootId,archiveRootId};
}


function firestoreFieldValue(field) {
  if (!field) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return Number(field.doubleValue);
  if (field.arrayValue?.values) return field.arrayValue.values.map(firestoreFieldValue);
  if (field.mapValue?.fields) return Object.fromEntries(Object.entries(field.mapValue.fields).map(([k,v])=>[k,firestoreFieldValue(v)]));
  return null;
}
async function queryMeetingArchiveRecords(env, collectionName, meetingId, token) {
  const response=await fetch("https://firestore.googleapis.com/v1/projects/"+getFirebaseProjectId(env)+"/databases/(default)/documents:runQuery",{
    method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify({structuredQuery:{from:[{collectionId:collectionName}],where:{fieldFilter:{field:{fieldPath:"meetingId"},op:"EQUAL",value:{stringValue:meetingId}}},limit:200}})
  });
  if(!response.ok)throw new Error("Unable to verify meeting archive access.");
  const rows=await response.json();
  return rows.filter(row=>row.document).map(row=>({id:row.document.name.split("/").pop(),...(Object.fromEntries(Object.entries(row.document.fields||{}).map(([k,v])=>[k,firestoreFieldValue(v)])))}));
}
async function authorizeMeetingArchiveUser(env, claims, meetingId, meetingCategory) {
  if(!meetingId)throw new Error("Meeting ID is required to access a category archive.");
  const privilegedToken=await getFirestoreAdminAccessToken(env);
  const doc=await getFirestoreDocument(env,"meetings/"+meetingId,privilegedToken);
  if(!doc)throw new Error("The authoritative meeting record was not found.");
  const meeting=Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,firestoreFieldValue(v)]));
  const category=String(meeting.meetingCategory||meeting.meetingPolicyId||meeting.category||"OTHER").trim().toUpperCase();
  if(category!==meetingCategory)throw new Error("Meeting category does not match the requested Google Drive archive.");
  const uid=String(claims.user_id||"");
  const email=String(claims.email||"").trim().toLowerCase();
  const adminEmail=String(env.AUTHORIZED_DRIVE_EMAIL||"").trim().toLowerCase();
  if(claims.admin===true||(adminEmail&&email===adminEmail))return {meeting,category,uid,email,privilegedToken};
  const directKeys=["initiatorUid","createdByUid","chairpersonUid","secretaryUid"];
  if(directKeys.some(key=>String(meeting[key]||"")===uid))return {meeting,category,uid,email,privilegedToken};
  const listedKeys=["participantUids","attendeeUids","memberUids","invitedUids","subscriberUids"];
  if(listedKeys.some(key=>Array.isArray(meeting[key])&&meeting[key].map(String).includes(uid)))return {meeting,category,uid,email,privilegedToken};
  const people=[...(Array.isArray(meeting.participants)?meeting.participants:[]),...(Array.isArray(meeting.attendees)?meeting.attendees:[])];
  if(people.some(p=>String(p?.uid||p?.userId||p?.memberUid||"")===uid||(email&&String(p?.email||p?.participantEmail||"").trim().toLowerCase()===email)))return {meeting,category,uid,email,privilegedToken};
  const subscriptions=await queryMeetingArchiveRecords(env,"meetingSubscriptions",meetingId,privilegedToken);
  if(subscriptions.some(row=>([row.uid,row.subscriberUid,row.userId,row.memberUid,row.participantUid].map(v=>String(v||"")).includes(uid)||(email&&[row.email,row.subscriberEmail,row.participantEmail].some(v=>String(v||"").trim().toLowerCase()===email)))&&!["revoked","cancelled","canceled","inactive","removed"].includes(String(row.status||"").toLowerCase())))return {meeting,category,uid,email,privilegedToken};
  const participants=await queryMeetingArchiveRecords(env,"participants",meetingId,privilegedToken);
  if(participants.some(row=>(String(row.participantUid||row.uid||row.userId||"")===uid||(email&&String(row.participantEmail||row.email||"").trim().toLowerCase()===email))&&!["revoked","cancelled","canceled","inactive","removed"].includes(String(row.status||"").toLowerCase())))return {meeting,category,uid,email,privilegedToken};
  throw new Error("This account is not a registered participant or subscriber for the selected meeting.");
}

async function provisionMeetingCategoryArchive(request, env) {
  const ctx = await meetingArchiveContext(request, env);
  if (ctx.response) return ctx.response;
  const {claims,category,policy,accessToken,archiveRootId}=ctx;
  const authorisedEmail=String(env.AUTHORIZED_DRIVE_EMAIL||"").trim().toLowerCase();
  if (!(claims.admin===true || (authorisedEmail && String(claims.email||"").trim().toLowerCase()===authorisedEmail))) {
    return json({ok:false,error:"Only the authorised IRPA administrator may provision category archive folders."},403,corsHeaders(request));
  }
  const folderName="IRPA "+policy.label+" Archive";
  const folderId=await findOrCreateFolder(env,accessToken,folderName,archiveRootId,{
    irpaGovernanceArchive:true, purpose:"IRPA Meeting Category Archive",
    meetingCategory:category, classification:policy.classification,
    archiveAccess:"Restricted", createdByUid:claims.user_id
  });
  return json({
    ok:true,provider:"Google Drive",meetingCategory:category,
    archiveName:folderName,folderId,
    archivePath:"IRPA Governance System/Meeting Archives/"+folderName,
    archiveUidLink:"https://drive.google.com/drive/folders/"+encodeURIComponent(folderId),
    classification:policy.classification,archiveAccess:"Restricted"
  },200,corsHeaders(request));
}

async function getMeetingCategoryArchive(request, env) {
  const ctx = await meetingArchiveContext(request, env);
  if (ctx.response) return ctx.response;
  const {claims,data,category,policy,accessToken,archiveRootId}=ctx;
  try{await authorizeMeetingArchiveUser(env,claims,String(data.meetingId||""),category)}catch(error){return json({ok:false,error:error.message||"Meeting archive access denied."},403,corsHeaders(request))}
  const folderName="IRPA "+policy.label+" Archive";
  const query=["name='"+folderName.replace(/'/g,"\\'")+"'","mimeType='application/vnd.google-apps.folder'","trashed=false","'"+archiveRootId+"' in parents"].join(" and ");
  const listed=await driveFetch(env,accessToken,"/drive/v3/files?q="+encodeURIComponent(query)+"&spaces=drive&pageSize=10&fields=files(id,name,description,parents)");
  const folder=listed.files?.[0];
  if(!folder?.id)return json({ok:false,error:"The Google Drive archive for "+policy.label+" has not been provisioned. Ask the IRPA administrator to create all five category archives first."},404,corsHeaders(request));
  let metadata={};
  try{metadata=JSON.parse(folder.description||"{}")}catch{}
  if(metadata.irpaGovernanceArchive!==true||metadata.meetingCategory!==category)return json({ok:false,error:"The Google Drive folder does not match the registered meeting archive policy."},403,corsHeaders(request));
  return json({
    ok:true,provider:"Google Drive",meetingCategory:category,
    archiveName:folderName,folderId:folder.id,
    archivePath:"IRPA Governance System/Meeting Archives/"+folderName,
    archiveUidLink:"https://drive.google.com/drive/folders/"+encodeURIComponent(folder.id),
    classification:policy.classification,archiveAccess:"Restricted"
  },200,corsHeaders(request));
}

async function ensureDocumentArchiveFolder(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();
  const documentId = cleanId(data.documentId || "");
  if (!documentId) return json({ok:false,error:"Document UID is required."},400,corsHeaders(request));

  const classification = String(data.classification || "Public").trim();
  const archiveCategory = String(data.archiveCategory || "Administrative Documents").trim();
  const allowedCategories = ["Finance Documents","Procurement Documents","Governance Documents","Administrative Documents"];
  const allowedClassifications = ["Public","Internal","Confidential","Restricted"];
  if (!allowedCategories.includes(archiveCategory)) return json({ok:false,error:"Invalid document archive category."},400,corsHeaders(request));
  if (!allowedClassifications.includes(classification)) return json({ok:false,error:"Invalid document access classification."},400,corsHeaders(request));

  const title = cleanName(data.title || documentId);
  const reference = cleanName(data.reference || documentId);
  const isPublic = classification === "Public";
  const accessToken = await getDriveAccessToken(env);

  const rootId = await findOrCreateFolder(env, accessToken, getDriveRootFolderName(env));
  const archiveRootId = await findOrCreateFolder(env, accessToken, "Document Archives", rootId, {
    irpaGovernanceArchive:true,
    purpose:"Controlled Document Archives"
  });
  const categoryId = await findOrCreateFolder(env, accessToken, archiveCategory, archiveRootId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    purpose:"Controlled Document Category"
  });
  const classificationId = await findOrCreateFolder(env, accessToken, classification, categoryId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    classification,
    purpose:"Controlled Document Classification"
  });
  const folderName = `IRPA-DOC-${documentId}`;
  const folderId = await findOrCreateFolder(env, accessToken, folderName, classificationId, {
    irpaGovernanceArchive:true,
    purpose:"Controlled Document",
    documentId,
    documentUid:documentId,
    documentTitle:title,
    documentReference:reference,
    archiveCategory,
    classification,
    publicAccess:isPublic
  });

  if (isPublic) await ensureAnyoneReaderPermission(env, accessToken, folderId);

  return json({
    ok:true,
    documentUid:documentId,
    folderId,
    folderName,
    archiveRootId,
    categoryId,
    classificationId,
    archiveCategory,
    classification,
    archivePath:`IRPA Governance System/Document Archives/${archiveCategory}/${classification}/${folderName}`,
    archiveUidLink:`https://drive.google.com/drive/folders/${folderId}`,
    archiveCategoryUidLink:`https://drive.google.com/drive/folders/${categoryId}`,
    archiveAccess:isPublic?"Public":"Restricted",
    createdByUid:claims.user_id
  },200,corsHeaders(request));
}

async function provisionDocumentArchive(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();
  const documentId = cleanId(data.documentId || "");
  if (!documentId) return json({ok:false,error:"Document ID is required."},400,corsHeaders(request));
  const document = await getFirestoreDocument(env, `documents/${documentId}`, claims.token);
  if (!document) return json({ok:false,error:"Document registry record was not found."},404,corsHeaders(request));
  const archive = await ensureDocumentArchiveFolder(new Request(request.url,{method:"POST",headers:request.headers,body:JSON.stringify(data)}),env);
  const fileId = document.fields?.fileId?.stringValue || "";
  let archivedFileId = "";
  let archivedFileLink = "";
  if (fileId) {
    const accessToken = await getDriveAccessToken(env);
    const copied = await driveFetch(env,accessToken,`/drive/v3/files/${encodeURIComponent(fileId)}/copy?supportsAllDrives=true`,{
      method:"POST",
      body:JSON.stringify({name:cleanName(document.fields?.fileName?.stringValue||document.fields?.title?.stringValue||"Controlled Document.pdf"),parents:[archive.folderId]})
    });
    archivedFileId=copied.id||"";
    archivedFileLink=archivedFileId?`https://drive.google.com/file/d/${archivedFileId}/view`:"";
    if(archive.archiveAccess==="Public"&&archivedFileId) await ensureAnyoneReaderPermission(env,accessToken,archivedFileId);
  }
  return json({...archive,archivedFileId,archivedFileLink},200,corsHeaders(request));
}

async function ensureAnyoneReaderPermission(env, accessToken, folderId) {
  const existing = await driveFetch(
    env,
    accessToken,
    `/drive/v3/files/${encodeURIComponent(folderId)}/permissions?fields=permissions(id,type,role)&pageSize=100`
  );
  if ((existing.permissions || []).some(p => p.type === "anyone" && ["reader","commenter","writer"].includes(p.role))) {
    return true;
  }
  await driveFetch(env, accessToken, `/drive/v3/files/${encodeURIComponent(folderId)}/permissions?sendNotificationEmail=false`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({type:"anyone",role:"reader"})
  });
  return true;
}

async function ensureSignedDocumentArchive(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();
  const documentId = cleanId(data.documentId || "");
  if (!documentId) return json({ok:false,error:"Document UID is required."},400,corsHeaders(request));
  const document = await getFirestoreDocument(env, `documents/${documentId}`, claims.token);
  if (!document) return json({ok:false,error:"Document registry record was not found."},404,corsHeaders(request));
  const fields = document.fields || {};
  const classification = String(data.classification || fields.classification?.stringValue || "Public").trim();
  const archiveCategory = String(data.archiveCategory || fields.archiveCategory?.stringValue || "Administrative Documents").trim();
  const title = cleanName(data.title || fields.title?.stringValue || documentId);
  const reference = cleanName(data.reference || fields.reference?.stringValue || documentId);
  const documentType = String(fields.documentType?.stringValue || data.documentType || "Administrative Document").trim();
  const governanceArchive = /governance/i.test(documentType);
  const allowedCategories = ["Finance Documents","Procurement Documents","Governance Documents","Administrative Documents"];
  const allowedClassifications = ["Public","Internal","Confidential","Restricted"];
  if (!allowedCategories.includes(archiveCategory)) return json({ok:false,error:"Invalid document archive category."},400,corsHeaders(request));
  if (!allowedClassifications.includes(classification)) return json({ok:false,error:"Invalid document access classification."},400,corsHeaders(request));

  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, getDriveRootFolderName(env));
  const signedRootId = await findOrCreateFolder(env, accessToken, "Signed Documents Archive", rootId, {
    irpaGovernanceArchive:true,
    purpose:"Signed Documents Archive"
  });
  const categoryId = await findOrCreateFolder(env, accessToken, archiveCategory, signedRootId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    purpose:"Signed Document Category"
  });
  const classificationId = await findOrCreateFolder(env, accessToken, classification, categoryId, {
    irpaGovernanceArchive:true,
    archiveCategory,
    classification,
    purpose:"Signed Document Classification"
  });
  const folderName = `IRPA-DOC-${documentId}`;
  const folderId = await findOrCreateFolder(env, accessToken, folderName, classificationId, {
    irpaGovernanceArchive:true,
    purpose:"Signed Document",
    documentId,
    documentUid:documentId,
    documentTitle:title,
    documentReference:reference,
    archiveCategory,
    classification,
    publicAccess:classification==="Public"
  });
  if (classification==="Public") await ensureAnyoneReaderPermission(env,accessToken,folderId);

  let governanceRootId=null;
  let governanceClassificationId=null;
  let governanceFolderId=null;
  if (governanceArchive) {
    governanceRootId = await findOrCreateFolder(env, accessToken, "Board of Directors Governance Archive", rootId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      purpose:"Board of Directors Governance Documents"
    });
    governanceClassificationId = await findOrCreateFolder(env, accessToken, classification, governanceRootId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      classification,
      purpose:"Board of Directors Governance Signed Documents"
    });
    governanceFolderId = await findOrCreateFolder(env, accessToken, folderName, governanceClassificationId, {
      irpaGovernanceArchive:true,
      irpaBoardGovernanceArchive:true,
      purpose:"Board of Directors Governance Signed Document",
      documentId,
      documentUid:documentId,
      documentTitle:title,
      documentReference:reference,
      archiveCategory,
      classification
    });
    if (classification==="Public") await ensureAnyoneReaderPermission(env,accessToken,governanceFolderId);
  }

  return json({
    ok:true,
    documentUid:documentId,
    folderId,
    archiveRootId:signedRootId,
    categoryId,
    classificationId,
    archiveCategory,
    classification,
    archivePath:`IRPA Governance System/Signed Documents Archive/${archiveCategory}/${classification}/${folderName}`,
    archiveUidLink:`https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`,
    archiveCategoryUidLink:`https://drive.google.com/drive/folders/${encodeURIComponent(categoryId)}`,
    archiveAccess:classification==="Public"?"Public":"Restricted",
    governanceArchive:governanceFolderId ? {
      rootId:governanceRootId,
      classificationId:governanceClassificationId,
      folderId:governanceFolderId,
      archivePath:`IRPA Governance System/Board of Directors Governance Archive/${classification}/Signed Documents/${folderName}`,
      archiveUidLink:`https://drive.google.com/drive/folders/${encodeURIComponent(governanceFolderId)}`
    } : null
  },200,corsHeaders(request));
}

async function ensureSignatureWorkflowFolder(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();
  const envelopeId = cleanId(data.envelopeId || "");
  if (!envelopeId) return json({ok:false,error:"Signature workflow ID is required."},400,corsHeaders(request));
  const accessToken = await getDriveAccessToken(env);
  const rootId = await findOrCreateFolder(env, accessToken, getDriveRootFolderName(env));
  const workflowsId = await findOrCreateFolder(env, accessToken, "Signature Workflows", rootId, {
    irpaGovernanceSignatureWorkflow:true,
    purpose:"Signature Workflow Working Files"
  });
  const folderName = `IRPA-WORKFLOW-${envelopeId}`;
  const folderId = await findOrCreateFolder(env, accessToken, folderName, workflowsId, {
    irpaGovernanceSignatureWorkflow:true,
    envelopeId,
    ownerUid:claims.user_id,
    purpose:"Signature Workflow Working File"
  });
  return json({ok:true,envelopeId,folderId,folderName,archiveAccess:"Restricted",path:`IRPA Governance System/Signature Workflows/${folderName}`},200,corsHeaders(request));
}

async function getSessionProfile(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const [adminDoc, memberDoc, employeeDoc] = await Promise.all([
    getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token),
    getFirestoreDocument(env, `members/${claims.user_id}`, claims.token),
    getFirestoreDocument(env, `employees/${claims.user_id}`, claims.token)
  ]);
  const admin = firestoreDocumentToPlain(adminDoc);
  const member = firestoreDocumentToPlain(memberDoc);
  const employee = firestoreDocumentToPlain(employeeDoc);
  return json({
    ok:true,
    uid:claims.user_id,
    email:claims.email || member?.email || employee?.email || "",
    admin: admin && admin.active === true ? admin : null,
    member: member && member.status === "Active" ? member : null,
    employee: employee || null
  },200,corsHeaders(request));
}

async function lookupInductionRegistration(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();
  const enteredName = String(data.fullName || "").trim();
  if (enteredName.length < 2) return json({ok:true,matched:false,reason:"Enter at least 2 characters."},200,corsHeaders(request));

  const normalize = value => String(value || "").trim().toLowerCase().replace(/\\s+/g," ");
  const target = normalize(enteredName);
  const member = await getFirestoreDocument(env, `members/${cleanId(claims.user_id)}`, claims.token);
  const employee = await getFirestoreDocument(env, `employees/${cleanId(claims.user_id)}`, claims.token);
  const invitationRows = await queryFirestoreByEmail(env, "invitations", "email", claims.email || "", claims.token);

  const memberFields = member?.fields || {};
  const employeeFields = employee?.fields || {};
  const invitationRecords = invitationRows.map(row => row.document).filter(Boolean);
  const invitation = invitationRecords
    .map(doc => firestoreDocumentToPlain(doc))
    .filter(x => normalize(x.email) === normalize(claims.email) && normalize(x.name) === target)
    .sort((a,b) => Number(b.updatedAt?.timestampValue ? Date.parse(b.updatedAt.timestampValue) : 0) - Number(a.updatedAt?.timestampValue ? Date.parse(a.updatedAt.timestampValue) : 0))[0] || null;

  const memberPlain = firestoreDocumentToPlain(member);
  const employeePlain = firestoreDocumentToPlain(employee);
  const ownNames = [employeePlain?.name, memberPlain?.name].filter(Boolean).map(normalize);
  const nameMatchesOwnRecord = ownNames.includes(target);
  if (!nameMatchesOwnRecord && !invitation) {
    return json({ok:true,matched:false,reason:"No registration record matching the entered full name was found for the authenticated IRPA account."},200,corsHeaders(request));
  }

  const number = employeeFields.employeeNumber?.stringValue || memberFields.memberNumber?.stringValue || "";
  const merged = {
    fullName: employeePlain?.name || memberPlain?.name || invitation?.name || enteredName,
    email: claims.email || employeePlain?.email || memberPlain?.email || invitation?.email || "",
    registrationNumber: number,
    employeeNumber: employeeFields.employeeNumber?.stringValue || "",
    memberNumber: memberFields.memberNumber?.stringValue || "",
    role: employeePlain?.role || memberPlain?.role || invitation?.role || "",
    department: employeePlain?.department || memberPlain?.department || invitation?.department || "",
    unit: employeePlain?.unit || memberPlain?.unit || invitation?.unit || "",
    memberType: memberPlain?.memberType || invitation?.memberType || "",
    employmentType: employeePlain?.employmentType || invitation?.employmentType || "",
    employmentStatus: employeePlain?.status || employeePlain?.employmentStatus || "",
    memberStatus: memberPlain?.status || "",
    invitationStatus: invitation?.status || "",
    invitationId: invitation?.id || "",
    sources: [
      memberPlain ? "Members Registration" : null,
      employeePlain ? "Employees & Personnel Registration" : null,
      invitation ? "Member & Personnel Invitations" : null
    ].filter(Boolean)
  };
  return json({ok:true,matched:true,registration:merged},200,corsHeaders(request));
}

async function sendRegistrationNumber(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();
  const uid = cleanId(data.uid || claims.user_id);
  if (uid !== claims.user_id) return json({ok:false,error:"Registration-number email may only be requested for the authenticated account."},403,corsHeaders(request));
  const member = await getFirestoreDocument(env, `members/${uid}`, claims.token);
  const employee = await getFirestoreDocument(env, `employees/${uid}`, claims.token);
  const memberFields = member?.fields || {};
  const employeeFields = employee?.fields || {};
  const number = employeeFields.employeeNumber?.stringValue || memberFields.memberNumber?.stringValue || "";
  const email = String(claims.email || employeeFields.email?.stringValue || memberFields.email?.stringValue || "").trim().toLowerCase();
  const name = employeeFields.name?.stringValue || memberFields.name?.stringValue || "IRPA Member/Employee";
  if (!number) return json({ok:false,error:"No IRPA member/employee registration number is currently assigned to this account."},409,corsHeaders(request));
  if (!email) return json({ok:false,error:"No official email address is available for this account."},409,corsHeaders(request));
  const subject = "IRPA Digital Board Governance — Registration Number Confirmation";
  const text = `Dear ${name},

Your IRPA Digital Board Governance induction form has been saved successfully.

Your existing IRPA registration number is: ${number}

This number was retrieved from the IRPA registration system and was not entered or changed during induction. Keep it for your IRPA Digital Governance System records.

Your completed induction has been routed to the registered department/unit for role and duties assignment.

Regards,
IRPA Administration
info@irpa.or.tz`;
  const htmlBody = `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937"><h2>IRPA Digital Board Governance</h2><p>Dear ${escapeHtml(name)},</p><p>Your IRPA Digital Board Governance induction form has been saved successfully.</p><p><strong>Your IRPA registration number: ${escapeHtml(number)}</strong></p><p>This number was retrieved from the IRPA registration system and was not entered or changed during induction.</p><p>Your completed induction has been routed to the registered department/unit for role and duties assignment.</p><p>Regards,<br>IRPA Administration<br><a href="mailto:info@irpa.or.tz">info@irpa.or.tz</a></p></body></html>`;
  const messageId = await smtpSend(env,{to:email,subject,text,html:htmlBody});
  return json({ok:true,email,registrationNumber:number,emailRequested:true,provider:"IRPA Mail Server",deliveryStatus:"Submitted to mail.irpa.or.tz",messageId},200,corsHeaders(request));
}

async function sendGatewayInvitationEmail(request, env) {
  const supplied=String(request.headers.get("x-irpa-service-key")||"");
  const expected=String(env.INVITE_SERVICE_KEY||"");
  if(!supplied||!expected) return json({ok:false,error:"Unauthorized"},401,corsHeaders(request));
  const a=new TextEncoder().encode(supplied), b=new TextEncoder().encode(expected);
  let diff=a.length^b.length; const n=Math.max(a.length,b.length);
  for(let j=0;j<n;j++) diff|=(a[j%Math.max(1,a.length)]||0)^(b[j%Math.max(1,b.length)]||0);
  if(diff!==0) return json({ok:false,error:"Unauthorized"},401,corsHeaders(request));
  let data; try{data=await request.json();}catch{return json({ok:false,error:"Invalid JSON"},400,corsHeaders(request));}
  const to=validateRecipient(data?.to);
  if(!to) return json({ok:false,error:"Invalid recipient"},400,corsHeaders(request));
  const subject=validateMailHeader(String(data?.subject||""),"Subject");
  if(!subject) return json({ok:false,error:"Invalid subject"},400,corsHeaders(request));
  if(typeof data?.text!=="string"||typeof data?.html!=="string") return json({ok:false,error:"Invalid message body"},400,corsHeaders(request));
  try{
    const messageId=await sendWithRetry(()=>smtpSend(env,{to,subject,text:data.text,html:data.html}),{onFailure:async(error,attempt)=>console.error("IRPA invitation gateway SMTP failure",{recipientDomain:recipientDomain(to),attempt,error:safeMailError(error)})});
    return json({ok:true,messageId:String(messageId||"")},200,corsHeaders(request));
  }catch(error){
    console.error("INVITATION_GATEWAY_PROVIDER_FAILED",{recipientDomain:recipientDomain(to),error:safeMailError(error)});
    return json({ok:false,error:"EMAIL_PROVIDER_FAILED"},502,corsHeaders(request));
  }
}

async function notifyInvitationAdministrator(request, env, reason) {
  try {
    const body = await request.clone().json().catch(()=>({}));
    const token = String(body?.token||"").trim();
    const invitationId = token.split(".")[0] || "unknown";
    await smtpSend(env,{
      to: getAuthorizedDriveEmail(env),
      subject: "IRPA invitation requires a new link",
      text: `Invitation ${invitationId} could not be completed: ${String(reason||"expired or cancelled")}. The invitee has been instructed to request a new link.`,
      html: `<p>Invitation <strong>${invitationId}</strong> could not be completed: ${String(reason||"expired or cancelled")}. The invitee has been instructed to request a new link.</p>`
    });
  } catch (notificationError) {
    console.error("Invitation administrator notification failed", {message:String(notificationError?.message||notificationError)});
  }
}

async function withInvitationRetry(operation, stage) {
  let lastError;
  for (let attempt=1; attempt<=2; attempt+=1) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof InvitationRedemptionError) throw error;
      lastError=error;
      console.error("Invitation operation failure", {stage,attempt,message:String(error?.message||error)});
      if (attempt===2) break;
      await new Promise(resolve=>setTimeout(resolve,150));
    }
  }
  throw lastError || new Error("Invitation operation failed.");
}

async function sendMemberInvitation(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const admin = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
  await enforceMailRateLimit(env, claims.user_id);
  const data = await request.json();
  const invitationId = cleanId(data.invitationId || "");
  if (!invitationId) return json({ok:false,error:"Invitation ID is required."},400,corsHeaders(request));
  const invitation = await getFirestoreDocument(env, `invitations/${invitationId}`, claims.token);
  if (!invitation) return json({ok:false,error:"Invitation record was not found."},404,corsHeaders(request));
  const fields=invitation.fields||{};
  const forceResend=data.forceResend===true;
  const priorDeliveryStatus=String(fields.deliveryStatus?.stringValue||"").trim().toLowerCase();
  const priorTokenHash=String(fields.invitationTokenHash?.stringValue||"").trim();
  // Duplicate initial requests must reuse the existing activation state. Only the
  // explicit Resend action may rotate the invitation secret.
  if(priorTokenHash&&!forceResend&&priorDeliveryStatus==="sent"){
    return json({ok:true,email:fields.email?.stringValue||"",deliveryStatus:"Sent",alreadySent:true},200,corsHeaders(request));
  }
  if(priorTokenHash&&!forceResend&&priorDeliveryStatus==="queued"){
    return json({ok:true,email:fields.email?.stringValue||"",deliveryStatus:"Queued",alreadyProcessing:true},200,corsHeaders(request));
  }
  const email=validateRecipient(fields.email?.stringValue||"");
  if(!email) return json({ok:false,error:"Invalid recipient"},400,corsHeaders(request));
  const name=String(fields.name?.stringValue||"").trim();
  const role=String(fields.role?.stringValue||"IRPA Member").trim();
  let meetingOrganizer=false;
  if(data.meetingAccess){const meetingId=cleanId(data.meetingAccess.meetingId||"");if(meetingId){const meetingDoc=await getFirestoreDocument(env,`meetings/${meetingId}`,claims.token);const mf=meetingDoc?.fields||{};const actorEmail=String(claims.email||"").trim().toLowerCase();meetingOrganizer=String(mf.initiatorUid?.stringValue||"")===claims.user_id||String(mf.chairpersonUid?.stringValue||"")===claims.user_id||String(mf.secretaryUid?.stringValue||"")===claims.user_id||Boolean(actorEmail&&[mf.initiatorEmail?.stringValue,mf.chairpersonEmail?.stringValue,mf.secretaryEmail?.stringValue].some(v=>String(v||"").trim().toLowerCase()===actorEmail));}}
  if(!admin?.fields?.active?.booleanValue&&!meetingOrganizer)return json({ok:false,error:"Administrator or authorised meeting organiser access is required to send this invitation."},403,corsHeaders(request));
  const appUrl=String(env.IRPA_APP_URL||"https://irpa-digital-board-governance.web.app").replace(/\/$/,"");
  const invitationSecret=randomBase64Url(32);
  const invitationTokenHash=await sha256Hex(invitationSecret);
  const invitationExpiresAt=new Date(Date.now()+72*60*60*1000).toISOString();
  const link=`${appUrl}/?invitationToken=${encodeURIComponent(invitationId+"."+invitationSecret)}`;
  let meetingAccess=null;
  if(data.meetingAccess){
    const supplied=data.meetingAccess||{};
    const meetingId=cleanId(supplied.meetingId||"");
    const participantId=cleanId(supplied.participantId||"");
    const accessToken=String(supplied.accessToken||"").trim();
    const password=String(supplied.password||"").trim();
    if(!meetingId||!participantId||! /^[A-Za-z0-9_-]{32,128}$/.test(accessToken)||! /^[A-Z0-9]{8,20}$/.test(password)){
      return json({ok:false,error:"Invalid meeting access payload."},400,corsHeaders(request));
    }
    if(String(fields.meetingId?.stringValue||"")!==meetingId||String(fields.participantId?.stringValue||"")!==participantId){
      return json({ok:false,error:"The meeting access pass does not match the selected invitation record."},409,corsHeaders(request));
    }
    const [meetingDoc,participantDoc]=await Promise.all([
      getFirestoreDocument(env,`meetings/${meetingId}`,claims.token),
      getFirestoreDocument(env,`participants/${participantId}`,claims.token)
    ]);
    if(!meetingDoc||!participantDoc)return json({ok:false,error:"The meeting or participant record could not be verified."},404,corsHeaders(request));
    const meetingFields=meetingDoc.fields||{},participantFields=participantDoc.fields||{};
    const linkedMeeting=String(participantFields.meetingId?.stringValue||"");
    const participantEmail=String(participantFields.participantEmail?.stringValue||participantFields.email?.stringValue||"").trim().toLowerCase();
    if(linkedMeeting!==meetingId||participantEmail!==email){
      return json({ok:false,error:"The participant email and meeting relationship do not match this invitation."},403,corsHeaders(request));
    }
    const meetingStatus=String(meetingFields.status?.stringValue||"Scheduled").trim().toLowerCase();
    if(["closed","completed","cancelled","canceled","archived"].includes(meetingStatus)){
      return json({ok:false,error:"This meeting is closed and cannot issue a new access invitation."},409,corsHeaders(request));
    }
    const meetingReference=String(meetingFields.meetingReference?.stringValue||meetingFields.reference?.stringValue||meetingFields.title?.stringValue||"IRPA Meeting").trim();
    const meetingIdentity=String(meetingFields.meetingIdentity?.stringValue||`IRPA-MEET-${meetingId.toUpperCase()}`).trim();
    // Invitation particulars are sourced from the authoritative meeting document,
    // not client-supplied display fields, so the invitation cites the saved register.
    meetingAccess={
      link:`${appUrl}/?meetingToken=${encodeURIComponent(accessToken)}&meetingId=${encodeURIComponent(meetingId)}`,
      meetingIdentity,
      meetingReference,
      meetingTitle:String(meetingFields.title?.stringValue||meetingReference).trim(),
      meetingDate:String(meetingFields.date?.stringValue||""),
      meetingStartTime:String(meetingFields.startTime?.stringValue||""),
      meetingEndTime:String(meetingFields.endTime?.stringValue||""),
      meetingPlatform:String(meetingFields.meetingPlatform?.stringValue||"Platform not recorded"),
      platformAccessUrl:String(meetingFields.platformAccessUrl?.stringValue||""),
      platformMeetingId:String(meetingFields.platformMeetingId?.stringValue||""),
      platformPasscode:String(meetingFields.platformPasscode?.stringValue||""),
      meetingVenue:String(meetingFields.venue?.stringValue||""),
      meetingChairperson:String(meetingFields.chairperson?.stringValue||""),
      meetingAgenda:String(meetingFields.agenda?.stringValue||""),
      password,
      expiresAt:String(supplied.expiresAt||"")
    };
  }
  await updateFirestoreDocument(env,`invitations/${invitationId}`,claims.token,{
    invitationTokenHash:{stringValue:invitationTokenHash},invitationTokenVersion:{stringValue:"2"},invitationExpiresAt:{timestampValue:invitationExpiresAt},invitationRedeemedAt:{nullValue:null},invitationRedeemedUid:{nullValue:null},
    deliveryStatus:{stringValue:"Queued"},deliveryQueuedAt:{timestampValue:new Date().toISOString()},deliveryError:{stringValue:""},deliveryProvider:{stringValue:"IRPA Mail Server via Cloudflare Worker"}
  },["invitationTokenHash","invitationTokenVersion","invitationExpiresAt","invitationRedeemedAt","invitationRedeemedUid","deliveryStatus","deliveryQueuedAt","deliveryError","deliveryProvider"]);
  const message=buildInvitationMessage({name:name||"Member",link,meetingAccess,username:email});
  try{
    const result=await sendInvitationEmail({email,name:name||"Member",link,meetingAccess,smtpSend:async ({to,subject,text,html})=>smtpSend(env,{to,subject,text,html}),logger:{error:(label,meta)=>console.error(label,{recipientDomain:recipientDomain(email),attempt:meta?.attempt})}});
    const sentAt=new Date().toISOString();
    const messageId=result?.messageId||result;
    await updateFirestoreDocument(env,`invitations/${invitationId}`,claims.token,{status:{stringValue:"Sent"},deliveryStatus:{stringValue:"Sent"},deliverySentAt:{timestampValue:sentAt},deliveryError:{stringValue:""},deliveryMessageId:{stringValue:String(messageId||"")} },["status","deliveryStatus","deliverySentAt","deliveryError","deliveryMessageId"]);
    return json({ok:true,email,deliveryStatus:"Sent",sentAt,messageId,message:meetingAccess?{subject:message.subject,text:"Meeting access details were included in the invitation email."}:message,meetingAccessSent:Boolean(meetingAccess)},200,corsHeaders(request));
  }catch(error){
    const failedAt=new Date().toISOString(), safeError=safeMailError(error);
    // Preserve the provider failure even if Firestore refuses the status write.
    // Previously, a failed status update escaped this catch and masked the SMTP
    // error, leaving the register at "Preparing" with no useful diagnostic.
    try {
      await updateFirestoreDocument(env,`invitations/${invitationId}`,claims.token,{status:{stringValue:"Failed"},deliveryStatus:{stringValue:"Failed"},deliveryFailedAt:{timestampValue:failedAt},deliveryError:{stringValue:safeError}},["status","deliveryStatus","deliveryFailedAt","deliveryError"]);
    } catch (statusError) {
      console.error("IRPA invitation failure status could not be saved",{
        recipientDomain:recipientDomain(email),
        statusError:safeMailError(statusError)
      });
    }
    console.error("IRPA member invitation delivery failed",{recipientDomain:recipientDomain(email),error:safeError});
    return json({ok:false,error:safeError,code:"EMAIL_PROVIDER_FAILED",deliveryStatus:"Failed"},502,corsHeaders(request));
  }
}

async function sendSignatureInvitation(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  await enforceMailRateLimit(env, claims.user_id);
  const data = await request.json();
  const envelopeId = cleanId(data.envelopeId || "");
  const signerUid = cleanId(data.signerUid || "");
  if (!envelopeId || !signerUid) return json({ok:false,error:"Envelope ID and signer UID are required."},400,corsHeaders(request));
  const envelope = await getFirestoreDocument(env, `signatureEnvelopes/${envelopeId}`, claims.token);
  if (!envelope) return json({ok:false,error:"The signing envelope was not found."},404,corsHeaders(request));
  const fields = envelope.fields || {};
  const recipients = firestoreMapArray(fields.recipients);
  const recipient = recipients.find(x => String(x.uid || "") === signerUid);
  if (!recipient) return json({ok:false,error:"The selected signer is not a participant in this envelope."},403,corsHeaders(request));
  const ownerUid = String(fields.ownerUid?.stringValue || fields.senderUid?.stringValue || "");
  const currentSignerUid = String(fields.currentSignerUid?.stringValue || "");
  if (claims.user_id !== ownerUid && claims.user_id !== currentSignerUid) {
    return json({ok:false,error:"Only the document owner or the currently released signer may send this signing invitation."},403,corsHeaders(request));
  }
  const email = normalizeRecipientEmail(recipient.email || data.signerEmail || "");
  const name = String(recipient.name || data.signerName || "").trim();
  const role = String(recipient.role || data.role || "Signer").trim();
  const subject = validateMailHeader("IRPA Digital Board Governance — Signature Invitation", "Subject");
  const appUrl = String(env.IRPA_APP_URL || "https://irpa-digital-board-governance.web.app").replace(/\/$/,"");
  const link = `${appUrl}/?signEnvelope=${encodeURIComponent(envelopeId)}`;
  const text = `Dear ${name || "IRPA Signer"},\\n\\nYou have been invited to participate in a document-signing workflow in the IRPA Digital Board Governance System.\\n\\nAssigned action: ${role}\\n\\nOpen the secure signing invitation:\\n${link}\\n\\nRegards,\\nIRPA Administration\\ninfo@irpa.or.tz`;
  const htmlBody = `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937"><h2>IRPA Digital Board Governance</h2><p>Dear ${escapeMailHtml(name || "IRPA Signer")},</p><p>You have been invited to participate in a document-signing workflow.</p><p><strong>Assigned action:</strong> ${escapeMailHtml(role)}</p><p><a href="${escapeMailHtml(link)}">Open Secure Signing Invitation</a></p><p>Regards,<br>IRPA Administration</p></body></html>`;
  const queuedAt = new Date().toISOString();
  await updateFirestoreDocument(env, `signatureEnvelopes/${envelopeId}`, claims.token, {
    invitationDeliveryStatus:{stringValue:"Queued"},
    invitationDeliveryQueuedAt:{timestampValue:queuedAt},
    invitationDeliveryError:{stringValue:""}
  }, ["invitationDeliveryStatus","invitationDeliveryQueuedAt","invitationDeliveryError"]);
  try {
    const messageId = await sendWithRetry(
      () => smtpSend(env,{to:email,subject,text,html:htmlBody}),
      { onFailure: async (error, attempt) => console.error("IRPA signature invitation SMTP failure", {recipientDomain:recipientDomain(email),attempt,error:safeMailError(error)}) }
    );
    const sentAt = new Date().toISOString();
    await updateFirestoreDocument(env, `signatureEnvelopes/${envelopeId}`, claims.token, {
      invitationStatus:{stringValue:"Sent"},
      invitationDeliveryStatus:{stringValue:"Sent"},
      invitationSentAt:{timestampValue:sentAt},
      invitationDeliverySentAt:{timestampValue:sentAt},
      invitationDeliveryError:{stringValue:""},
      invitationDeliveryMessageId:{stringValue:String(messageId)}
    }, ["invitationStatus","invitationDeliveryStatus","invitationSentAt","invitationDeliverySentAt","invitationDeliveryError","invitationDeliveryMessageId"]);
    return json({ok:true,envelopeId,signerUid,email,deliveryStatus:"Sent",sentAt,messageId},200,corsHeaders(request));
  } catch (error) {
    const failedAt = new Date().toISOString();
    const safeError = safeMailError(error);
    await updateFirestoreDocument(env, `signatureEnvelopes/${envelopeId}`, claims.token, {
      invitationStatus:{stringValue:"Failed"},
      invitationDeliveryStatus:{stringValue:"Failed"},
      invitationDeliveryFailedAt:{timestampValue:failedAt},
      invitationDeliveryError:{stringValue:safeError}
    }, ["invitationStatus","invitationDeliveryStatus","invitationDeliveryFailedAt","invitationDeliveryError"]);
    console.error("IRPA signature invitation delivery failed", {recipientDomain:recipientDomain(email),error:safeError});
    throw error;
  }
}

async function enforceMailRateLimit(env, uid) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) throw new Error("Authenticated user is required.");
  const key = `mail-rate:${cleanUid}:${Math.floor(Date.now()/3600000)}`;
  const current = Number(await env.DRIVE_KV.get(key) || 0);
  if (current >= 10) throw new Error("Mail invitation rate limit reached. Please wait before sending more invitations.");
  await env.DRIVE_KV.put(key, String(current + 1), { expirationTtl: 3700 });
}


async function smtpSend(env,{to,subject,text,html}) {
  const toEmail = normalizeRecipientEmail(to);
  const cleanSubject = validateMailHeader(subject, "Subject");
  if (env.SMTP_MOCK === "success") return "250 MOCK ACCEPTED";
  if (env.SMTP_MOCK === "fail") throw new Error("Mock SMTP provider failure.");
  if (!env.SMTP_PASSWORD) throw new Error("IRPA SMTP password is not configured in the deployment environment.");
  const { connect } = await import("cloudflare:sockets");
  const socket = connect({hostname:SMTP_HOST,port:SMTP_PORT},{secureTransport:"on"});
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  let buffer = "";
  async function readResponse() {
    while (true) {
      const {value,done}=await reader.read();
      if (done) throw new Error("SMTP server closed the connection.");
      buffer += new TextDecoder().decode(value);
      const lines=buffer.split("\r\n"); buffer=lines.pop() || "";
      for (const line of lines) {
        if (/^\d{3} /.test(line)) {
          const code=Number(line.slice(0,3));
          if (code>=400) throw new Error("IRPA SMTP error " + code + ": " + line.slice(4));
          return line;
        }
      }
    }
  }
  async function command(value, expectedClass) {
    await writer.write(new TextEncoder().encode(value+"\r\n"));
    const line=await readResponse();
    if (expectedClass && !line.startsWith(String(expectedClass))) throw new Error("Unexpected SMTP response.");
    return line;
  }
  try {
    await readResponse();
    await command("EHLO irpa-digital-board-governance","2");
    await authenticateSmtpPlain({
      username:env.SMTP_USERNAME||SMTP_FROM,
      password:env.SMTP_PASSWORD,
      writeLine:async line=>writer.write(new TextEncoder().encode(line+"\r\n")),
      readResponse,
      command
    });
    await command("MAIL FROM:<"+SMTP_FROM+">","2");
    await command("RCPT TO:<"+toEmail+">","2");
    await command("DATA","3");
    const boundary="IRPA-"+crypto.randomUUID();
    const mime=[
      "From: \"IRPA Administration\" <"+SMTP_FROM+">",
      "To: <"+toEmail+">",
      "Subject: "+cleanSubject,
      "MIME-Version: 1.0",
      "Content-Type: multipart/alternative; boundary=\""+boundary+"\"","",
      "--"+boundary,
      "Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: 8bit","",text,"",
      "--"+boundary,
      "Content-Type: text/html; charset=UTF-8","Content-Transfer-Encoding: 8bit","",html,"",
      "--"+boundary+"--",""
    ].join("\r\n");
    await writer.write(new TextEncoder().encode(mime+"\r\n.\r\n"));
    let accepted;
    try {
      accepted=await readResponse();
    } catch (error) {
      // Once DATA has been written, a transport failure before the final SMTP
      // response is ambiguous: the provider may already have accepted the mail.
      // Do not retry this case automatically and risk duplicate invitations.
      if (!/^IRPA SMTP error \d{3}/i.test(String(error?.message||""))) {
        error.deliveryOutcome="unknown";
        error.retryable=false;
      }
      throw error;
    }
    if (!accepted.startsWith("2")) throw new Error("SMTP message was not accepted.");
    await command("QUIT","2");
    return accepted;
  } finally {
    try { reader.releaseLock(); } catch {}
    try { writer.releaseLock(); } catch {}
    try { socket.close(); } catch {}
  }
}

async function deleteDriveFile(request, env) {
  const claims = await authenticateFirebaseRequest(request, env);
  const data = await request.json();

  const fileId = String(data.fileId || "").trim();
  const documentId = String(data.documentId || "").trim();

  if (!fileId) {
    return json(
      { ok: false, error: "Google Drive file ID is required." },
      400,
      corsHeaders(request)
    );
  }

  if (!documentId) {
    return json(
      { ok: false, error: "Firestore document ID is required." },
      400,
      corsHeaders(request)
    );
  }

  const admin = await getFirestoreDocument(
    env,
    `adminProfiles/${claims.user_id}`,
    claims.token
  );

  if (!admin?.fields?.active?.booleanValue) {
    return json(
      { ok: false, error: "Administrator authorization is required." },
      403,
      corsHeaders(request)
    );
  }

  const document = await getFirestoreDocument(
    env,
    `documents/${documentId}`,
    claims.token
  );

  if (!document) {
    return json(
      { ok: false, error: "The controlled document record was not found." },
      404,
      corsHeaders(request)
    );
  }

  const storedFileId = document?.fields?.fileId?.stringValue || "";

  if (!storedFileId || storedFileId !== fileId) {
    return json(
      { ok: false, error: "The supplied Drive file does not match the controlled document record." },
      409,
      corsHeaders(request)
    );
  }

  const accessToken = await getDriveAccessToken(env);

  const metadata = await driveFetch(
    env,
    accessToken,
    `/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,description,trashed`
  );

  const description = parseDescription(metadata.description);

  if (!description?.irpaGovernance) {
    return json(
      { ok: false, error: "The requested file is not an IRPA governance document." },
      403,
      corsHeaders(request)
    );
  }

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Google Drive deletion failed (${response.status}): ${errorText.slice(0, 500)}`
    );
  }

  return json(
    {
      ok: true,
      fileId,
      fileName: metadata.name || "Document",
      documentId,
      deletedByUid: claims.user_id
    },
    200,
    corsHeaders(request)
  );
}



async function getDriveAccessToken(env) {
  const stored = await env.DRIVE_KV.get("google-drive-refresh-token", "json");
  if (!stored?.encrypted) throw new Error("Google Drive has not yet been authorized.");

  const refreshToken = await decryptText(stored.encrypted, env.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const tokens = await response.json();
  if (!response.ok || !tokens.access_token) throw new Error(tokens.error_description || "Google Drive access token refresh failed.");
  return tokens.access_token;
}

async function ensureSignatureFolderPermission(env, accessToken, folderId, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!folderId || !normalizedEmail) return false;

  try {
    const listed = await driveFetch(
      env,
      accessToken,
      `/drive/v3/files/${encodeURIComponent(folderId)}/permissions?fields=permissions(id,type,emailAddress,role)&pageSize=100`
    );
    const existing = (listed.permissions || []).find(
      p => p.type === "user" && String(p.emailAddress || "").trim().toLowerCase() === normalizedEmail
    );
    if (existing) return true;

    await driveFetch(
      env,
      accessToken,
      `/drive/v3/files/${encodeURIComponent(folderId)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "user",
          role: "reader",
          emailAddress: normalizedEmail
        })
      }
    );
    return true;
  } catch (error) {
    console.warn("Signature folder sharing was not completed", normalizedEmail, error?.message || error);
    return false;
  }
}

async function findOrCreateFolder(env, accessToken, name, parentId = null, descriptionData = null) {
  const safeName = name.replace(/'/g, "\\'");
  const q = [
    `name='${safeName}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    parentId ? `'${parentId}' in parents` : null
  ].filter(Boolean).join(" and ");
  const listed = await driveFetch(env, accessToken, `/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=10&fields=files(id,name,parents)`);
  if (listed.files?.[0]?.id) return listed.files[0].id;

  const created = await driveFetch(env, accessToken, "/drive/v3/files", {
    method: "POST",
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
      description: JSON.stringify(descriptionData || { irpaGovernanceFolder: true })
    })
  });
  return created.id;
}

async function driveFetch(env, accessToken, path, options = {}) {
  const response = await fetch(`https://www.googleapis.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data.error?.message || "Google Drive API request failed.");
  return data;
}

async function authenticateFirebaseRequest(request, env, options = {}) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Firebase authentication is required.");

  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid Firebase ID token.");

  const headerPart = JSON.parse(base64UrlDecode(parts[0]));
  const payload = JSON.parse(base64UrlDecode(parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== `https://securetoken.google.com/${getFirebaseProjectId(env)}`) throw new Error("Invalid Firebase token issuer.");
  if (payload.aud !== getFirebaseProjectId(env)) throw new Error("Invalid Firebase token audience.");
  if (!payload.sub || Number(payload.exp || 0) <= now) throw new Error("Firebase token is expired.");

  const jwks = await getFirebaseJwks();
  const jwk = jwks[headerPart.kid];
  if (!jwk) throw new Error("Firebase token signing key not found.");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new Error("Invalid Firebase ID token signature.");

  const claims = { token, user_id: payload.user_id || payload.sub, email: payload.email || null };
  if (options.skipActivation !== true) await assertActivatedPortalUser(claims, env);
  return claims;
}

async function assertActivatedPortalUser(claims, env) {
  const admin = await getFirestoreDocument(env, `adminProfiles/${claims.user_id}`, claims.token);
  if (admin?.fields?.active?.booleanValue === true) return;

  // Invitation activation preserves the canonical institutional record ID
  // and attaches the authenticated Firebase UID to that record. Some older
  // authorization paths incorrectly assumed the institutional document ID
  // was always identical to the Firebase UID. Resolve the same UID-first,
  // email-fallback profile used by upload authorization so activated
  // invitees are not rejected before the storage layer.
  const { memberRecord, employeeRecord } = await getInstitutionalProfileForUser(env, claims);
  const memberActivated = memberRecord && (
    memberRecord.fields?.registrationStatus?.stringValue === "Activated" ||
    memberRecord.fields?.status?.stringValue === "Activated" ||
    memberRecord.fields?.accountActivated?.booleanValue === true
  );
  const employeeActive = employeeRecord && (
    employeeRecord.fields?.registrationStatus?.stringValue === "Activated" ||
    employeeRecord.fields?.status?.stringValue === "Active" ||
    employeeRecord.fields?.employmentStatus?.stringValue === "Active"
  ) && employeeRecord.fields?.accountActivated?.booleanValue !== false;

  if (!memberActivated && !employeeActive) {
    const error = new Error("IRPA_INVITATION_FAILURE:PORTAL_ACTIVATION_REQUIRED");
    error.status = 403;
    throw error;
  }
}

async function getFirebaseJwks() {
  if (jwksCache && Date.now() - jwksFetchedAt < 60 * 60 * 1000) {
    return jwksCache;
  }

  const response = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  );

  if (!response.ok) {
    throw new Error("Unable to retrieve Firebase signing keys.");
  }

  const data = await response.json();

  if (!Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error("Firebase signing keys were not returned.");
  }

  jwksCache = Object.fromEntries(
    data.keys.map((key) => [key.kid, key])
  );

  jwksFetchedAt = Date.now();

  return jwksCache;
}


async function queryFirestoreByEmail(env, collectionName, fieldName, email, firebaseToken) {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return [];
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${getFirebaseProjectId(env)}/databases/(default)/documents:runQuery`, {
    method:"POST",
    headers:{"Authorization":`Bearer ${firebaseToken}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      structuredQuery:{
        from:[{collectionId:collectionName}],
        where:{fieldFilter:{field:{fieldPath:fieldName},op:"EQUAL",value:{stringValue:value}}},
        limit:10
      }
    })
  });
  if (!response.ok) {
    if (response.status === 403) return [];
    throw new Error("Unable to query the IRPA registration records.");
  }
  const rows=await response.json();
  return Array.isArray(rows)?rows:[];
}

function firestoreDocumentToPlain(document) {
  if (!document?.fields) return null;
  const convert = field => {
    if (!field) return null;
    if ("stringValue" in field) return field.stringValue;
    if ("booleanValue" in field) return field.booleanValue;
    if ("integerValue" in field) return Number(field.integerValue);
    if ("doubleValue" in field) return field.doubleValue;
    if ("timestampValue" in field) return field.timestampValue;
    if ("nullValue" in field) return null;
    if ("arrayValue" in field) return (field.arrayValue.values || []).map(convert);
    if ("mapValue" in field) return Object.fromEntries(Object.entries(field.mapValue.fields || {}).map(([k,v])=>[k,convert(v)]));
    return null;
  };
  return Object.fromEntries(Object.entries(document.fields).map(([k,v])=>[k,convert(v)]));
}
 
async function getFirestoreDocumentsByField(env, collectionName, fieldName, value, firebaseToken) {
  if (value === null || value === undefined || String(value) === "") return [];
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${getFirebaseProjectId(env)}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${firebaseToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: collectionName }],
        where: { fieldFilter: { field: { fieldPath: fieldName }, op: "EQUAL", value: { stringValue: String(value) } } },
        limit: 100
      }})
    }
  );
  if (!response.ok) {
    const error = new Error("Unable to query the Firestore register.");
    error.status = response.status;
    error.code = "firestore-query-" + response.status;
    throw error;
  }
  const rows = await response.json();
  return rows.filter(row => row.document).map(row => row.document);
}

async function getFirestoreDocumentsByEmail(env, collectionName, email, firebaseToken) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return [];
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${getFirebaseProjectId(env)}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firebaseToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: collectionName }],
          where: {
            fieldFilter: {
              field: { fieldPath: "email" },
              op: "EQUAL",
              value: { stringValue: normalizedEmail }
            }
          },
          limit: 5
        }
      })
    }
  );
  if (!response.ok) throw new Error("Unable to verify the Firestore institutional profile.");
  const rows = await response.json();
  return rows.filter(row => row.document).map(row => row.document);
}

async function getInstitutionalProfileForUser(env, claims) {
  const uid = claims.user_id;
  const email = String(claims.email || "").trim().toLowerCase();
  const directMember = await getFirestoreDocument(env, `members/${uid}`, claims.token);
  const directEmployee = await getFirestoreDocument(env, `employees/${uid}`, claims.token);
  if (directMember || directEmployee) return { memberRecord: directMember, employeeRecord: directEmployee };
  const [memberMatches, employeeMatches] = await Promise.all([
    getFirestoreDocumentsByEmail(env, "members", email, claims.token),
    getFirestoreDocumentsByEmail(env, "employees", email, claims.token)
  ]);
  return {
    memberRecord: memberMatches[0] || null,
    employeeRecord: employeeMatches[0] || null
  };
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlEncodeText(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function pemPrivateKeyBytes(pem) {
  const body = String(pem || "").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  if (!body) throw new Error("Privileged Firestore identity is not configured.");
  const binary = atob(body);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

let firestoreAdminTokenCache = { token: "", expiresAt: 0 };

async function getFirestoreAdminAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (firestoreAdminTokenCache.token && firestoreAdminTokenCache.expiresAt > now + 60) {
    return firestoreAdminTokenCache.token;
  }
  let diagnosticStep = "token creation";
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "");
  } catch {
    throw new Error("Privileged Firestore identity is not configured correctly.");
  }
  if (
    serviceAccount.project_id !== getFirebaseProjectId(env) ||
    typeof serviceAccount.client_email !== "string" ||
    !serviceAccount.client_email.endsWith(".iam.gserviceaccount.com") ||
    typeof serviceAccount.private_key !== "string"
  ) {
    throw new Error("Privileged Firestore identity is invalid for this Firebase project.");
  }

  const issuedAt = now;
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600
  };
  const unsigned = base64UrlEncodeText(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    base64UrlEncodeText(JSON.stringify(claims));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemPrivateKeyBytes(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const assertion = unsigned + "." + base64UrlEncodeBytes(new Uint8Array(signature));
  diagnosticStep = "token exchange";
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const result = await response.json();
  if (!response.ok || typeof result.access_token !== "string") {
    firestoreAdminTokenCache = { token: "", expiresAt: 0 };
    throw new Error("Privileged Firestore identity could not obtain an access token.");
  }
  firestoreAdminTokenCache = {
    token: result.access_token,
    expiresAt: now + Math.min(Number(result.expires_in) || 3600, 3600)
  };
  return firestoreAdminTokenCache.token;
}

export async function commitFirestoreDocumentAndAudit(env, documentId, _firebaseToken, documentFields, documentMask, auditFields, {createOnly=false,collectionName="documents"}={}) {
  const safeDocumentId=String(documentId||"").replace(/[^a-zA-Z0-9_-]/g,"");
  const safeCollection=String(collectionName||"documents");
  if(!safeDocumentId)throw new Error("A valid document ID is required for the atomic lifecycle commit.");
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(safeCollection) || !["documents","communicationMediaAssets","communicationMediaItems","communicationSocialPosts","communicationOperations","socialMediaAccounts"].includes(safeCollection))throw new Error("The requested Firestore collection is not approved for gateway writes.");
  const firebaseToken = await getFirestoreAdminAccessToken(env);
  const base=`projects/${getFirebaseProjectId(env)}/databases/(default)/documents`;
  const auditId=`${Date.now()}-${crypto.randomUUID()}`;
  const documentWrite={
    update:{name:`${base}/${safeCollection}/${safeDocumentId}`,fields:documentFields},
    updateMask:{fieldPaths:documentMask}
  };
  if(createOnly)documentWrite.currentDocument={exists:false};
  const writes=[
    documentWrite,
    {update:{name:`${base}/audit/${auditId}`,fields:auditFields},currentDocument:{exists:false}}
  ];
  const response=await fetch(`https://firestore.googleapis.com/v1/projects/${getFirebaseProjectId(env)}/databases/(default)/documents:commit`,{
    method:"POST",
    headers:{"Authorization":`Bearer ${firebaseToken}`,"Content-Type":"application/json"},
    body:JSON.stringify({writes})
  });
  if(!response.ok){
    let googleError={};
    try{googleError=(await response.clone().json())?.error||{};}catch{}
    const googleStatus=String(googleError.status||"UNKNOWN").replace(/[\\r\\n]/g," ").slice(0,100);
    const googleMessage=String(googleError.message||"No Google error message returned").replace(/[\\r\\n]/g," ").slice(0,500);
    console.error("Firestore atomic document/audit commit failed", {httpStatus:response.status,googleStatus,googleMessage});
    const error=new Error(`Unable to atomically commit the document and its audit event (HTTP ${response.status}; ${googleStatus}: ${googleMessage}).`);
    error.googleStatus=googleStatus;
    error.googleMessage=googleMessage;
    error.httpStatus=response.status;
    throw error;
  }
  return response.json();
}

async function recordDocumentLifecycleFailure(env, claims, documentId, action, details = {}) {
  const firebaseToken = await getFirestoreAdminAccessToken(env);
  const base = `projects/${getFirebaseProjectId(env)}/databases/(default)/documents`;
  const auditId = `lifecycle-failure-${Date.now()}-${crypto.randomUUID().slice(0, 12)}`;
  const auditFields = {
    action: {stringValue: `DOCUMENT_LIFECYCLE_${action}_FAILED`},
    collection: {stringValue: "documents"},
    recordId: {stringValue: String(documentId || "")},
    actorUid: {stringValue: String(claims?.user_id || "")},
    actorEmail: claims?.email ? {stringValue: String(claims.email)} : {nullValue: null},
    details: {mapValue: {fields: Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value == null ? {nullValue: null} : {stringValue: String(value).slice(0, 1000)}]))}},
    createdAt: {timestampValue: new Date().toISOString()}
  };
  const response = await fetch(`https://firestore.googleapis.com/v1/${base}/audit?documentId=${encodeURIComponent(auditId)}`, {
    method: "POST",
    headers: {"Authorization": `Bearer ${firebaseToken}`, "Content-Type": "application/json"},
    body: JSON.stringify({fields: auditFields})
  });
  if (!response.ok) throw new Error(`Unable to persist the document lifecycle failure audit event (HTTP ${response.status}).`);
  return {auditId};
}

async function updateFirestoreDocument(env, path, firebaseToken, fields, updateMask) {
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${getFirebaseProjectId(env)}/databases/(default)/documents/${path}`);
  for (const fieldPath of updateMask || Object.keys(fields)) url.searchParams.append("updateMask.fieldPaths", fieldPath);
  const response = await fetch(url.toString(), {
    method:"PATCH",
    headers:{"Authorization":`Bearer ${firebaseToken}`,"Content-Type":"application/json"},
    body:JSON.stringify({fields})
  });
  if (!response.ok) {
    let googleError = {};
    try {
      const body = await response.clone().json();
      googleError = body?.error || {};
    } catch {}
    const googleStatus = String(googleError.status || "UNKNOWN").replace(/[\\r\\n]/g, " ").slice(0, 100);
    const googleMessage = String(googleError.message || "No Google error message returned").replace(/[\\r\\n]/g, " ").slice(0, 500);
    throw new Error(`Firestore PATCH ${path} failed: HTTP ${response.status} ${googleStatus} ${googleMessage}`);
  }
  return response.json();
}

async function getFirestoreDocument(env, path, firebaseToken) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${getFirebaseProjectId(env)}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${firebaseToken}` }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    let googleError = {};
    try {
      const body = await response.clone().json();
      googleError = body?.error || {};
    } catch {}
    const googleStatus = String(googleError.status || "UNKNOWN").replace(/[\\r\\n]/g, " ").slice(0, 100);
    const googleMessage = String(googleError.message || "No Google error message returned").replace(/[\\r\\n]/g, " ").slice(0, 500);
    throw new Error(`Firestore GET ${path} failed: HTTP ${response.status} ${googleStatus} ${googleMessage}`);
  }
  return response.json();
}

function firestoreMapArray(field) {
  if (!Array.isArray(field?.arrayValue?.values)) return [];
  return field.arrayValue.values.map(v => {
    const m = v?.mapValue?.fields || {};
    const value = key => {
      const x = m[key];
      if (x?.stringValue !== undefined) return x.stringValue;
      if (x?.booleanValue !== undefined) return x.booleanValue;
      if (x?.integerValue !== undefined) return Number(x.integerValue);
      return null;
    };
    return {
      uid:value("uid"),
      email:value("email"),
      name:value("name"),
      role:value("role"),
      accessOnly:Boolean(value("accessOnly"))
    };
  });
}

function firestoreStringArray(field) {
  return field?.arrayValue?.values?.map(v => v.stringValue).filter(Boolean) || [];
}

async function encryptText(plaintext, secret) {
  const key = await crypto.subtle.importKey("raw", base64Bytes(secret), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  return JSON.stringify({
    iv: uint8ToBase64(iv),
    ciphertext: uint8ToBase64(ciphertext)
  });
}

async function decryptText(record, secret) {
  const parsed = typeof record === "string" ? JSON.parse(record) : record;
  const key = await crypto.subtle.importKey("raw", base64Bytes(secret), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Bytes(parsed.iv) }, key, base64Bytes(parsed.ciphertext));
  return new TextDecoder().decode(plaintext);
}

function buildMultipartBody(boundary, metadata, bytes, contentType) {
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return body;
}

function cleanName(value) {
  return String(value).trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 160) || "Document";
}

function cleanId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "");
}

function randomBase64Url(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return uint8ToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlDecode(value) {
  return new TextDecoder().decode(base64UrlBytes(value));
}

function base64UrlBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(normalized), c => c.charCodeAt(0));
}

function base64Bytes(value) {
  return Uint8Array.from(atob(String(value)), c => c.charCodeAt(0));
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseDescription(value) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function html(message, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>IRPA Google Drive</title></head><body><h2>${escapeHtml(message)}</h2></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === "https://irpa-digital-board-governance-frontend.irpa-governance.workers.dev" || origin === "https://irpa.or.tz" || origin === "https://www.irpa.or.tz" || origin === "https://irpa-digital-board-governance.web.app" || origin === "https://irpa-digital-board-governance.firebaseapp.com" || origin === "http://localhost:5173" || origin === "https://staging.irpa.or.tz" || origin === "https://irpa-dgb-meeting-room-staging.irpa-governance.workers.dev" || origin === "https://irpa-dbg-staging-a73ec.web.app" || origin === "https://irpa-dbg-staging-a73ec.firebaseapp.com";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://irpa.or.tz",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-IRPA-Invitation-Version, x-signing-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin"
  };
}

export { EsignRecordDurableObject };
