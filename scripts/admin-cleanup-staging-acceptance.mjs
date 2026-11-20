import crypto from "node:crypto";

const project = String(process.env.STAGING_FIREBASE_PROJECT_ID || "").trim(); // staging-only assertion
const apiKey = String(process.env.STAGING_FIREBASE_WEB_API_KEY || "").trim();
const adminEmail = String(process.env.STAGING_TEST_EMAIL || "").trim().toLowerCase();
const adminPassword = String(process.env.STAGING_TEST_PASSWORD || "");
const stagingUrl = String(process.env.STAGING_URL || "").replace(/\/+$/, "");
const serviceAccount = JSON.parse(process.env.STAGING_FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
if (project !== "irpa-dbg-staging-a73ec" || serviceAccount.project_id !== project) throw new Error("Refusing cleanup acceptance outside the approved staging Firebase project.");
if (!apiKey || !adminEmail || !adminPassword || !stagingUrl) throw new Error("Required staging acceptance configuration is missing.");
const host = new URL(stagingUrl).hostname.toLowerCase();
if (!host.endsWith(".workers.dev") || host.includes("irpa.or.tz")) throw new Error("Staging Worker host assertion failed.");

const b64 = value => Buffer.from(value).toString("base64url");
async function serviceToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const claims = b64(JSON.stringify({
    iss:serviceAccount.client_email,
    scope:"https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
    aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600
  }));
  const unsigned = header + "." + claims;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = unsigned + "." + signer.sign(serviceAccount.private_key).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})
  });
  const body = await response.json().catch(()=>({}));
  if (!response.ok || !body.access_token) throw new Error("Staging service-account token exchange failed.");
  return body.access_token;
}
async function firebaseAuth(path, body) {
  const response = await fetch("https://identitytoolkit.googleapis.com/v1/"+path+"?key="+encodeURIComponent(apiKey),{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  const payload = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error("Staging Firebase Auth request failed: "+String(payload.error?.message||response.status));
  return payload;
}
const token = await serviceToken();
const base = "https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(project)+"/databases/(default)/documents/";
const firestoreWrite = async (collection,id,fields) => {
  const response = await fetch(base+collection+"?documentId="+encodeURIComponent(id),{
    method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({fields})
  });
  if (!response.ok) throw new Error("Could not create isolated cleanup fixture in "+collection+" (HTTP "+response.status+").");
};
const firestoreRead = async path => {
  const response = await fetch(base+path,{headers:{Authorization:"Bearer "+token}});
  if (response.status===404) return null;
  if (!response.ok) throw new Error("Could not verify staging cleanup record "+path+" (HTTP "+response.status+").");
  return response.json();
};
const firestoreDelete = async path => {
  const response = await fetch(base+path,{method:"DELETE",headers:{Authorization:"Bearer "+token}});
  if (!response.ok && response.status!==404) throw new Error("Could not remove staging-only fixture "+path+" (HTTP "+response.status+").");
};
const string = value => ({stringValue:String(value)});
const bool = value => ({booleanValue:Boolean(value)});
const map = value => ({mapValue:{fields:value}});
const array = values => ({arrayValue:{values}});
const decodeString = value => value?.stringValue || "";
const runId = crypto.randomUUID();
const email = "cleanup-fixture-"+runId+"@example.com";
const password = crypto.randomBytes(24).toString("base64url")+"aA1!";
const invitationId = "cleanup-fixture-invite-"+runId;
const envelopeId = "cleanup-fixture-envelope-"+runId;
const eventId = "cleanup-fixture-audit-"+runId;
let uid = "";
let adminIdToken = "";
let completed = false;

try {
  const admin = await firebaseAuth("accounts:signInWithPassword",{email:adminEmail,password:adminPassword,returnSecureToken:true});
  adminIdToken = admin.idToken;
  if (!adminIdToken || String(admin.email||"").toLowerCase()!==adminEmail) throw new Error("Staging administrator sign-in identity mismatch.");
  const fixture = await firebaseAuth("accounts:signUp",{email,password,returnSecureToken:true});
  uid = fixture.localId;
  if (!uid) throw new Error("Staging-only cleanup fixture account was not created.");

  await firestoreWrite("members",uid,{
    uid:string(uid),email:string(email),fullName:string("Staging Cleanup Acceptance Fixture"),
    role:string("Trial Cleanup Fixture"),status:string("Trial"),recordOrigin:string("TRIAL"),trialData:bool(true)
  });
  await firestoreWrite("invitations",invitationId,{
    uid:string(uid),email:string(email),name:string("Staging Cleanup Acceptance Fixture"),
    status:string("Pending"),invitationRedemptionState:string("PENDING"),recordOrigin:string("TRIAL")
  });
  await firestoreWrite("signatureEnvelopes",envelopeId,{
    status:string("Draft"),recordOrigin:string("TRIAL"),trialData:bool(true),
    participantUids:array([string(uid)]),actionUids:array([string(uid)]),
    recipients:array([map({uid:string(uid),email:string(email),status:string("Invited")})]),
    fields:array([map({id:string("fixture-field"),signerUid:string(uid),signerEmail:string(email)})]),
    signers:array([map({uid:string(uid),email:string(email),name:string("Staging Cleanup Acceptance Fixture"),status:string("Invited")})])
  });
  await firestoreWrite("signatureEvents",eventId,{
    eventType:string("STAGING_CLEANUP_ACCEPTANCE_FIXTURE_CREATED"),envelopeId:string(envelopeId),
    actorEmail:string(adminEmail),createdAt:string(new Date().toISOString())
  });

  const call = async (path, method="GET", body) => {
    const response = await fetch(stagingUrl+path,{
      method,headers:{Authorization:"Bearer "+adminIdToken,Accept:"application/json",...(body?{"Content-Type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error("Cleanup staging API "+path+" failed (HTTP "+response.status+"): "+String(payload.error||payload.code||"unknown"));
    return payload;
  };

  const inventory = await call("/api/admin/cleanup/inventory");
  if (inventory.ok!==true || inventory.mandatoryBeforeReset!==true) throw new Error("Inventory-first gate did not return a valid staging inventory.");
  const member = inventory.records.find(row=>row.key==="members/"+uid);
  if (!member || member.name!=="Staging Cleanup Acceptance Fixture" || member.decision!=="STAYS") throw new Error("Staging fixture was not inventoried by full name with STAYS default.");
  if (inventory.records.some(row=>row.sourceDocument)) throw new Error("Raw Firestore documents leaked into the public inventory response.");

  const plan = await call("/api/admin/cleanup/plan","POST",{
    inventoryId:inventory.inventoryId,selections:[{key:"members/"+uid,decision:"GOES"}]
  });
  if (plan.summary?.goes!==2) throw new Error("Member cascade did not explicitly include its pending invitation.");
  if (!plan.executionOperations.some(operation=>operation.type==="auth-delete") ||
      !plan.executionOperations.some(operation=>operation.type==="update-signers") ||
      !plan.executionOperations.some(operation=>operation.key==="invitations/"+invitationId)) {
    throw new Error("Reviewed member cleanup plan omitted Auth, invitation or unsent signer-assignment operations.");
  }
  const result = await call("/api/admin/cleanup/execute","POST",{planId:plan.planId,confirmation:"DELETE"});
  if (result.status!=="COMPLETE" || !result.backupDriveFileId || !result.backupUrl) throw new Error("Cleanup did not complete with a durable Drive backup.");
  if ((result.operationOutcomes||[]).some(item=>!["DELETED","ALREADY_DELETED","UPDATED","ALREADY_REMOVED"].includes(item.status))) throw new Error("Cleanup returned an unsuccessful operation outcome.");

  if (await firestoreRead("members/"+uid)) throw new Error("Member register entry remained after cleanup.");
  if (await firestoreRead("invitations/"+invitationId)) throw new Error("Pending invitation remained after member cleanup.");
  const envelope = await firestoreRead("signatureEnvelopes/"+envelopeId);
  if (!envelope) throw new Error("The envelope containing the unsent assignment was unexpectedly deleted.");
  for (const field of ["signers","recipients","fields","participantUids","actionUids"]) {
    if ((envelope.fields?.[field]?.arrayValue?.values||[]).length!==0) throw new Error("Unsent signing assignment reference remained in "+field+".");
  }
  if (!await firestoreRead("signatureEvents/"+eventId)) throw new Error("Immutable signature event history was deleted.");
  const loginCheck = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="+encodeURIComponent(apiKey),{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})
  });
  if (loginCheck.ok) throw new Error("Deleted staging fixture Firebase Auth account can still sign in.");

  completed = true;
  console.log("STAGING_CLEANUP_INVENTORY_DEFAULT_STAYS_PASS");
  console.log("STAGING_CLEANUP_MEMBER_INVITATION_AUTH_CASCADE_PASS");
  console.log("STAGING_CLEANUP_UNSENT_SIGNER_ASSIGNMENT_REMOVAL_PASS");
  console.log("STAGING_CLEANUP_IMMUTABLE_AUDIT_PRESERVATION_PASS");
  console.log("STAGING_CLEANUP_DURABLE_DRIVE_BACKUP_PASS");
  console.log("STAGING_CLEANUP_PRODUCTION_ISOLATION_PASS project="+project+" worker="+host);
} finally {
  if (!completed) {
    if (uid) {
      await firestoreDelete("members/"+uid).catch(()=>{});
      await fetch("https://identitytoolkit.googleapis.com/v1/projects/"+encodeURIComponent(project)+"/accounts:delete",{
        method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({localId:uid})
      }).catch(()=>{});
    }
    await firestoreDelete("invitations/"+invitationId).catch(()=>{});
  }
  await firestoreDelete("signatureEnvelopes/"+envelopeId).catch(()=>{});
}
