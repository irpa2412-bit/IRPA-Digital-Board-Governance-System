import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createMeetingPortalRouter } from "../drive-gateway/src/meetingPortal.mjs";
import { createDocumentLifecycleRouter } from "../drive-gateway/src/documentLifecycle.mjs";
import { createDocumentApprovalRouter } from "../drive-gateway/src/documentApproval.mjs";
import { redeemInvitationToken, InvitationRedemptionError } from "../drive-gateway/src/invitationRedemption.mjs";
import { sign } from "../drive-gateway/src/signing.mjs";
import { PDFDocument } from "pdf-lib";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-irpa-staging";
if (!getApps().length) initializeApp({ projectId: PROJECT });
const db = getFirestore();
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const originalFetch = globalThis.fetch;
const requestId = crypto.randomUUID().replace(/-/g, "");
const ids = {
  meeting: "chain-meeting-" + requestId,
  participant: "chain-participant-" + requestId,
  document: "chain-document-" + requestId,
  envelope: "chain-envelope-" + requestId,
  member: "chain-member-" + requestId,
  officer: "chain-officer-" + requestId,
  nonOfficer: "chain-nonofficer-" + requestId,
  invitation: "chain-invitation-" + requestId
};
const env = { FIREBASE_PROJECT_ID: PROJECT, IRPA_ENVIRONMENT: "staging" };
const authUid = "chain-host-" + requestId;
const signerUid = "chain-signer-" + requestId;
const officerUid = ids.officer;

function fsValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(fsValue) } };
  if (typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k,v]) => [k,fsValue(v)])) } };
  return { stringValue: String(value) };
}
function toRestFields(value) { return Object.fromEntries(Object.entries(value || {}).map(([k,v]) => [k,fsValue(v)])); }
function fromRestValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromRestValue);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k,x]) => [k,fromRestValue(x)]));
  return null;
}
function plain(raw) {
  if (!raw?.fields) return null;
  return { id: String(raw.name || "").split("/").pop(), ...Object.fromEntries(Object.entries(raw.fields).map(([k,v]) => [k,fromRestValue(v)])) };
}
function toRaw(snapshot, collection, id) {
  if (!snapshot) return null;
  return { name: `projects/${PROJECT}/databases/(default)/documents/${collection}/${id}`, fields: toRestFields(snapshot) };
}
async function getRecord(path) {
  const snap = await db.doc(path).get();
  return snap.exists ? toRaw(snap.data(), path.split("/")[0], path.split("/")[1]) : null;
}
async function putRecord(path, value) { await db.doc(path).set(value, { merge: true }); }
function json(data, status=200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }); }
function corsHeaders() { return { "content-type": "application/json" }; }
function request(path, body, uid, method="POST") {
  return new Request("https://gateway.test" + path, {
    method, headers: { "content-type": "application/json", "x-test-uid": uid || "" },
    body: method === "GET" ? undefined : JSON.stringify(body || {})
  });
}
function claimsFor(req) { return { user_id: req.headers.get("x-test-uid"), uid: req.headers.get("x-test-uid"), email: req.headers.get("x-test-uid") + "@example.test", token: "emulator-owner" }; }

const meetingCtx = {
  getFirebaseProjectId: () => PROJECT,
  getFirestoreAdminAccessToken: async () => "owner",
  authenticateFirebaseRequest: async req => claimsFor(req),
  json: (data,status,headers) => new Response(JSON.stringify(data),{status,headers}),
  corsHeaders
};
const meetingRouter = createMeetingPortalRouter(meetingCtx);

const lifecycleDeps = {
  allowedContentTypes: new Set(["text/plain", "application/pdf"]),
  authenticateFirebaseRequest: async req => claimsFor(req),
  getFirestoreDocument: async (_env,path) => {
    const [collection,id] = path.split("/");
    return getRecord(collection + "/" + id);
  },
  firestoreDocumentToPlain: plain,
  getFirebaseProjectId: () => PROJECT,
  getDriveAccessToken: async () => "fake-drive-token",
  findOrCreateFolder: async (_env,_token,name,parent) => "folder-" + String(parent || "root") + "-" + name.replace(/[^a-z0-9]/gi,""),
  fetch: async (url, init={}) => {
    if (String(url).startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
      return json({ id: "drive-file-" + requestId, name: "chain.txt", mimeType: "text/plain", webViewLink: "https://drive.test/" + requestId });
    }
    return originalFetch(url, init);
  },
  driveFetch: async () => ({}),
  updateFirestoreDocument: async (_env,path,_token,fields,mask) => {
    const [collection,id] = path.split("/");
    const patch = Object.fromEntries((mask || Object.keys(fields)).map(k => [k, fromRestValue(fields[k])]));
    await db.doc(collection + "/" + id).set(patch,{merge:true});
  },
  commitDocumentAndAudit: async (_env,documentId,_token,fields,mask,auditFields) => {
    const patch = Object.fromEntries((mask || Object.keys(fields)).map(k => [k, fromRestValue(fields[k])]));
    const batch = db.batch();
    batch.set(db.doc("documents/" + documentId), patch, {merge:true});
    batch.set(db.collection("audit").doc(), Object.fromEntries(Object.entries(auditFields).map(([k,v]) => [k,fromRestValue(v)])));
    await batch.commit();
  },
  recordLifecycleFailure: async () => {},
  json: (data,status,headers) => new Response(JSON.stringify(data),{status,headers}),
  corsHeaders
};
const lifecycleRouter = createDocumentLifecycleRouter(lifecycleDeps);
const approvalDeps = {
  authenticateFirebaseRequest: async req => claimsFor(req),
  getFirestoreDocument: async (_env,path) => {
    const [collection,id] = path.split("/");
    return getRecord(collection + "/" + id);
  },
  firestoreDocumentToPlain: plain,
  commitDocumentAndAudit: async (_env,documentId,_token,fields,mask,auditFields) => {
    const patch = Object.fromEntries((mask || Object.keys(fields)).map(k => [k,fromRestValue(fields[k])]));
    const batch = db.batch();
    batch.set(db.doc("documents/" + documentId),patch,{merge:true});
    batch.set(db.collection("audit").doc(),Object.fromEntries(Object.entries(auditFields).map(([k,v])=>[k,fromRestValue(v)])));
    await batch.commit();
  },
  json: (data,status,headers) => new Response(JSON.stringify(data),{status,headers}),
  corsHeaders
};
const approvalRouter = createDocumentApprovalRouter(approvalDeps);

async function cleanup() {
  for (const collection of ["meetings","participants","meetingAccessTokens","documents","envelopes","signatureEnvelopes","adminProfiles","members","employees","invitations","audit"]) {
    const snap = await db.collection(collection).get();
    const batch = db.batch();
    let count=0;
    for (const doc of snap.docs) {
      if (Object.values(ids).includes(doc.id) || doc.id.includes(requestId) || doc.id === ids.document || doc.id === ids.envelope) { batch.delete(doc.ref); count++; }
    }
    if (count) await batch.commit();
  }
}

test("five-portal chain: invitation redemption handler rejects malformed token and seeded fixture is isolated", async () => {
  await putRecord("invitations/" + ids.invitation, { email:"member@example.test", invitationRedemptionState:"PENDING", name:"Chain Member" });
  await assert.rejects(
    () => redeemInvitationToken(new Request("https://gateway.test/api/invitations/redeem", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:"not-a-valid-token"})}), env),
    error => error instanceof InvitationRedemptionError && error.status === 400
  );
  assert.equal((await db.doc("invitations/" + ids.invitation).get()).data().invitationRedemptionState,"PENDING");
});
test.todo("invitation creation uses a Firebase callable that needs the paid plan");

test("five-portal chain: real meeting, document upload, signature, and approval handlers preserve stage links and reject bypasses", async t => {
  t.after(async () => { globalThis.fetch = originalFetch; await cleanup(); });
  globalThis.fetch = async (input, init={}) => {
    const url = String(input);
    if (url.startsWith("https://firestore.googleapis.com/v1/")) {
      const rewritten = "http://" + EMULATOR + url.slice("https://firestore.googleapis.com".length);
      return originalFetch(rewritten, init);
    }
    return originalFetch(input, init);
  };
  await putRecord("meetings/" + ids.meeting, {
    reference:"CHAIN-" + requestId, title:"Five portal chain test", status:"Scheduled",
    initiatorUid:authUid, initiatorEmail:authUid + "@example.test"
  });
  await putRecord("participants/" + ids.participant, {
    meetingId:ids.meeting, participantName:"Chain Signer", participantEmail:signerUid + "@example.test", participantUid:signerUid
  });
  await putRecord("adminProfiles/" + officerUid, { role:"Authorization Officer", status:"Active" });
  await putRecord("adminProfiles/" + authUid, { role:"Administrator", status:"Active" });
  await putRecord("members/" + signerUid, { role:"Member", status:"Active" });
  await putRecord("members/" + ids.nonOfficer, { role:"Member", status:"Active" });

  const meetingResponse = await meetingRouter(request("/api/meeting-access/issue",{meetingId:ids.meeting,participantId:ids.participant},authUid),env,"/api/meeting-access/issue");
  assert.equal(meetingResponse.status,200,"meeting access stage should issue a real pass");
  const meetingResult = await meetingResponse.json();
  assert.equal(meetingResult.meetingId,ids.meeting);
  assert.equal(meetingResult.participantId,ids.participant);
  assert.ok((await db.doc("meetingAccessTokens/" + meetingResult.accessId).get()).exists);

  const unsigned = await approvalRouter(request("/api/document-lifecycle/approval/decide",{documentId:ids.document,decision:"approve"},officerUid),env);
  assert.equal(unsigned.status,409,"approval must not skip document creation/signature");

  const uploadResponse = await lifecycleRouter(request("/api/document-lifecycle/upload",{
    title:"Five portal chain fixture", fileName:"chain.txt", contentType:"text/plain", base64:Buffer.from("IRPA five portal chain").toString("base64"),
    classification:"Internal", archiveCategory:"Administrative Documents", recordOrigin:"TRIAL"
  },authUid),env);
  assert.equal(uploadResponse.status,201,"real document lifecycle upload handler should create the controlled document");
  const upload = await uploadResponse.json();
  ids.document = upload.documentId;
  const docSnap = await db.doc("documents/" + upload.documentId).get();
  assert.equal(docSnap.data().status,"WORKING");
  assert.equal(docSnap.data().reference,upload.reference);

  const pdfDoc = await PDFDocument.create(); pdfDoc.addPage([300,400]); const pdfBytes = new Uint8Array(await pdfDoc.save());
  const hash = crypto.createHash("sha256").update(pdfBytes).digest("hex");
  await db.doc("documents/" + upload.documentId).set({ status:"Stored", hash, primaryStorageId:"original-" + requestId, fileId:"original-" + requestId, ownerUid:authUid },{merge:true});
  const envelope = {
    id:ids.envelope, documentId:upload.documentId, documentHash:hash, title:"Five portal chain fixture",
    fileName:"chain.pdf", classification:"Internal", createdBy:authUid, status:"Sent",
    signers:[{id:"S1",email:signerUid+"@example.test",name:"Chain Signer",order:1,uid:signerUid,status:"Pending",tokenHash:crypto.createHash("sha256").update("chain-secret").digest("hex"),invitation:"Sent"}],
    archiveTargets:[],createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),events:[],completion:null,_v:1
  };
  await db.doc("envelopes/" + ids.envelope).set(envelope);
  const signingCtx = {
    env:{}, now:()=>new Date(), config:{appUrl:"https://gateway.test",ttlDays:14}, logger:{error(){}},
    verifyUser:async()=>({uid:signerUid,email:signerUid+"@example.test"}),
    meta:{
      get:async(collection,id)=>{const snap=await db.doc(collection+"/"+id).get();return snap.exists?snap.data():null;},
      update:async(collection,id,patch,options={})=>{const ref=db.doc(collection+"/"+id);const snap=await ref.get();if(options.ifVersion!=null&&snap.data()?._v!==options.ifVersion)throw new Error("unexpected version conflict");await ref.set({...patch,_v:(snap.data()?._v||0)+1},{merge:true});}
    },
    storage:{get:async id=>id==="original-"+requestId?pdfBytes:null,put:async()=>({id:"signed-"+requestId}),delete:async()=>{}},
    sendInvitation:null,allowReturnTokens:true
  };
  const signResult = await sign(signingCtx,{token:ids.envelope+".S1.chain-secret",signature:{type:"typed",value:"Chain Signer"},consent:true,ip:"127.0.0.1",userAgent:"chain-test",user:{uid:signerUid,email:signerUid+"@example.test"}});
  assert.equal(signResult.ok,true);
  assert.equal((await db.doc("envelopes/" + ids.envelope).get()).data().signers[0].status,"Signed");
  assert.equal((await db.doc("envelopes/" + ids.envelope).get()).data().status,"Completed");
  await db.doc("signatureEnvelopes/" + ids.envelope).set({documentId:upload.documentId,status:"Completed",lastSignedByUid:signerUid,signers:[{uid:signerUid,status:"Signed"}]});
  await db.doc("documents/" + upload.documentId).set({status:"SIGNED",signatureStatus:"COMPLETED",signatureEnvelopeId:ids.envelope,signedByUid:signerUid},{merge:true});

  await assert.rejects(() => sign(signingCtx,{token:ids.envelope+".S1.chain-secret",signature:{type:"typed",value:"Chain Signer"},consent:true,user:{uid:signerUid,email:signerUid+"@example.test"}}),"signature token reuse should fail");
  const memberApproval = await approvalRouter(request("/api/document-lifecycle/approval/decide",{documentId:upload.documentId,decision:"approve"},ids.nonOfficer),env);
  assert.equal(memberApproval.status,403,"non-officer approval must be denied");
  const signerApproval = await approvalRouter(request("/api/document-lifecycle/approval/decide",{documentId:upload.documentId,decision:"approve"},signerUid),env);
  assert.equal(signerApproval.status,403,"the signer must not approve their own document");
  const approvalResponse = await approvalRouter(request("/api/document-lifecycle/approval/decide",{documentId:upload.documentId,decision:"approve"},officerUid),env);
  assert.equal(approvalResponse.status,200,"Authorization Officer should approve completed signed document");
  const approval = await approvalResponse.json();
  assert.equal(approval.approval.documentId,upload.documentId);
  assert.equal(approval.approval.envelopeId,ids.envelope);
  const finalDoc = (await db.doc("documents/" + upload.documentId).get()).data();
  assert.equal(finalDoc.approvalStatus,"APPROVED");
  assert.equal(finalDoc.approval.officerUid,officerUid);
  assert.ok(finalDoc.signatureEnvelopeId);
});
