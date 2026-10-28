import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFName } from "pdf-lib";
import { chainEvents, declineSigning, getSigningPdf, openSigning, sign, verifySigningPdf } from "../src/signing.mjs";
import { route } from "../src/router.mjs";
import { sha256Hex } from "../src/util.mjs";

const NOW = new Date("2026-10-07T17:00:00.000Z");
const ORIGINAL = await (async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  pdf.addPage([300, 400]);
  pdf.addPage([300, 400]);
  return pdf.save();
})();
const SIGNATURE_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

async function makeFixture({ signerUid, signerEmail, secondSigner = true } = {}) {
  const secret = "a".repeat(64);
  const tokenHash = await sha256Hex(secret);
  const documentHash = await sha256Hex(ORIGINAL);
  const envelopeId = "ENV-TEST123";
  const signerId = "S1";
  const signers = [
    {
      id: signerId,
      email: signerEmail || "member@example.org",
      name: "Institutional Signer",
      order: 1,
      uid: signerUid,
      status: "Pending",
      tokenHash,
      invitation: "Sent"
    }
  ];
  if (secondSigner) {
    signers.push({
      id: "S2",
      email: "second@example.org",
      name: "Second Signer",
      order: 2,
      uid: "second-user",
      status: "Pending",
      tokenHash: null,
      invitation: "Pending"
    });
  }
  const envelope = {
    id: envelopeId,
    documentId: "DOC-TEST123",
    documentHash,
    title: "Controlled Signing Test",
    fileName: "controlled-test.pdf",
    classification: "Restricted",
    createdBy: "owner-user",
    status: "Sent",
    signers,
    archiveTargets: [],
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 86400000).toISOString(),
    events: await chainEvents([], { type: "envelope.created", at: NOW.toISOString(), actor: "owner-user" }),
    completion: null,
    _v: 1
  };
  const state = new Map([["envelopes", envelope], ["documents", {
    id: envelope.documentId,
    status: "Stored",
    ownerUid: envelope.createdBy,
    hash: documentHash,
    primaryStorageId: "original-1"
  }]]);
  const storedFiles = new Map();
  return {
    token: envelopeId + "." + signerId + "." + secret,
    envelope,
    ctx: {
      env: {},
      now: () => new Date(NOW),
      config: { appUrl: "https://example.test", ttlDays: 14 },
      logger: { error() {} },
      verifyUser: async () => ({ uid: signerUid, email: signerEmail }),
      meta: {
        async get(collection, id) {
          if (collection === "envelopes" && id === envelopeId) return structuredClone(state.get("envelopes"));
          if (collection === "documents" && id === envelope.documentId) return structuredClone(state.get("documents"));
          return null;
        },
        async update(collection, id, patch, options = {}) {
          const current = state.get(collection);
          if (options.ifVersion != null && current._v !== options.ifVersion) throw new Error("unexpected version conflict");
          const next = { ...current, ...structuredClone(patch), _v: current._v + 1 };
          state.set(collection, next);
        }
      },
      storage: {
        async get(id) {
          if (id === "original-1") return ORIGINAL;
          return storedFiles.get(id) || null;
        },
        async put({bytes}) { const id="stored-test-"+storedFiles.size;storedFiles.set(id,bytes);return {id}; },
        async delete(id) { storedFiles.delete(id); }
      },
      sendInvitation: null,
      allowReturnTokens: true
    }
  };
}

test("Member: unauthenticated and wrong UID cannot open an institutional signing link", async () => {
  const fixture = await makeFixture({ signerUid: "member-uid", signerEmail: "member@example.org" });
  await assert.rejects(
    () => openSigning(fixture.ctx, fixture.token, null),
    error => error.status === 403 && error.message.includes("invited signer")
  );
  await assert.rejects(
    () => openSigning(fixture.ctx, fixture.token, { uid: "other-member", email: "member@example.org" }),
    error => error.status === 403
  );
});

test("Member: matching Firebase UID can open and retrieve the signing PDF", async () => {
  const fixture = await makeFixture({ signerUid: "member-uid", signerEmail: "member@example.org" });
  const opened = await openSigning(fixture.ctx, fixture.token, {
    uid: "member-uid",
    email: "member@example.org"
  });
  assert.equal(opened.canSign, true);
  assert.equal(opened.signer.authenticated, true);

  const pdf = await getSigningPdf(fixture.ctx, fixture.token, {
    uid: "member-uid",
    email: "member@example.org"
  });
  assert.equal(pdf.fileName, "controlled-test.pdf");
  assert.deepEqual(pdf.bytes, ORIGINAL);
});

test("Member: matching UID can complete its signing action and the envelope advances", async () => {
  const fixture = await makeFixture({ signerUid: "member-uid", signerEmail: "member@example.org" });
  const result = await sign(fixture.ctx, {
    token: fixture.token,
    signature: { type: "typed", value: "Member Signer" },
    consent: true,
    ip: "127.0.0.1",
    userAgent: "controlled-test",
    user: { uid: "member-uid", email: "member@example.org" }
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "InProgress");
  assert.equal(result.completed, false);
  assert.equal(fixture.ctx.meta ? (await fixture.ctx.meta.get("envelopes", fixture.envelope.id)).signers[0].status : null, "Signed");
});

test("Employee: matching Firebase UID is accepted; email alone is not an identity substitute", async () => {
  const fixture = await makeFixture({ signerUid: "employee-uid", signerEmail: "employee@example.org" });
  await assert.rejects(
    () => openSigning(fixture.ctx, fixture.token, { uid: "different-uid", email: "employee@example.org" }),
    error => error.status === 403
  );
  const opened = await openSigning(fixture.ctx, fixture.token, {
    uid: "employee-uid",
    email: "employee@example.org"
  });
  assert.equal(opened.signer.authenticated, true);
});

test("Employee: authenticated router path passes the verified UID to open and submit", async () => {
  const fixture = await makeFixture({ signerUid: "employee-uid", signerEmail: "employee@example.org" });
  fixture.ctx.verifyUser = async () => ({ uid: "employee-uid", email: "employee@example.org" });

  const openRequest = new Request("https://example.test/api/sign/open", {
    headers: { "x-signing-token": fixture.token }
  });
  const openResponse = await route(openRequest, fixture.ctx);
  assert.equal(openResponse.status, 200);
  const openBody = await openResponse.json();
  assert.equal(openBody.signer.authenticated, true);
  assert.equal(openBody.canSign, true);

  const submitRequest = new Request("https://example.test/api/sign/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: fixture.token,
      signature: { type: "typed", value: "Employee Signer" },
      consent: true
    })
  });
  const submitResponse = await route(submitRequest, fixture.ctx);
  assert.equal(submitResponse.status, 200);
  const submitBody = await submitResponse.json();
  assert.equal(submitBody.ok, true);
  assert.equal(submitBody.status, "InProgress");
});

test("UID-bound signer can decline only with the matching authenticated UID", async () => {
  const fixture = await makeFixture({ signerUid: "member-uid", signerEmail: "member@example.org" });
  await assert.rejects(
    () => declineSigning(fixture.ctx, {
      token: fixture.token,
      reason: "controlled negative-path test",
      user: { uid: "wrong-user" }
    }),
    error => error.status === 403
  );
  const result = await declineSigning(fixture.ctx, {
    token: fixture.token,
    reason: "controlled positive-path test",
    user: { uid: "member-uid" }
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "Declined");
});

test("External token signer remains usable without Firebase authentication", async () => {
  const fixture = await makeFixture({ signerUid: null, signerEmail: "external@example.org" });
  const opened = await openSigning(fixture.ctx, fixture.token, null);
  assert.equal(opened.signer.authenticated, false);
  assert.equal(opened.canSign, true);
  const pdf = await getSigningPdf(fixture.ctx, fixture.token, null);
  assert.deepEqual(pdf.bytes, ORIGINAL);
});


test("Gateway open returns only fields assigned to the authenticated signer", async () => {
  const fixture = await makeFixture({ signerUid:"member-uid", signerEmail:"member@example.org" });
  fixture.envelope.fields = [
    {fieldId:"member-name",type:"Name",page:1,x:10,y:20,width:30,height:8,signerUid:"member-uid",required:true},
    {fieldId:"second-signature",type:"Signature",page:1,x:50,y:20,width:30,height:8,signerUid:"second-user",required:true}
  ];
  const opened = await openSigning(fixture.ctx,fixture.token,{uid:"member-uid",email:"member@example.org"});
  assert.equal(opened.fields.length,1);
  assert.equal(opened.fields[0].fieldId,"member-name");
  assert.equal(opened.fields.some(field=>field.signerUid==="second-user"),false);
});

test("Gateway signing refuses missing required assigned fields before mutating the signer", async () => {
  const fixture = await makeFixture({ signerUid:"member-uid", signerEmail:"member@example.org" });
  fixture.envelope.fields = [
    {fieldId:"approval-reason",type:"Text",page:1,x:10,y:20,width:30,height:8,signerUid:"member-uid",required:true}
  ];
  await assert.rejects(
    () => sign(fixture.ctx,{
      token:fixture.token,
      signature:{type:"typed",value:"Member Signer"},
      fieldValues:{},
      consent:true,
      user:{uid:"member-uid",email:"member@example.org"}
    }),
    error=>error.status===400&&error.message.includes("required text field")
  );
  const current=await fixture.ctx.meta.get("envelopes",fixture.envelope.id);
  assert.equal(current.signers[0].status,"Pending");
});

test("Gateway signing stores only the authenticated signer's assigned field values", async () => {
  const fixture = await makeFixture({ signerUid:"member-uid", signerEmail:"member@example.org" });
  fixture.envelope.fields = [
    {fieldId:"member-name",type:"Name",page:1,x:10,y:20,width:30,height:8,signerUid:"member-uid",required:true},
    {fieldId:"second-name",type:"Name",page:1,x:50,y:20,width:30,height:8,signerUid:"second-user",required:true}
  ];
  const result=await sign(fixture.ctx,{
    token:fixture.token,
    signature:{type:"typed",value:"Member Signer"},
    fieldValues:{"member-name":"Member Name","second-name":"Injected Other Signer"},
    consent:true,
    user:{uid:"member-uid",email:"member@example.org"}
  });
  assert.equal(result.status,"InProgress");
  const current=await fixture.ctx.meta.get("envelopes",fixture.envelope.id);
  assert.deepEqual(current.signers[0].fieldValues,{"member-name":"Member Name"});
  assert.equal(current.signers[0].fieldValues["second-name"],undefined);
});


test("Gateway idempotent signing retry still requires the invited authenticated UID", async () => {
  const fixture = await makeFixture({ signerUid:"member-uid", signerEmail:"member@example.org" });
  await sign(fixture.ctx,{
    token:fixture.token,
    signature:{type:"typed",value:"Member Signer"},
    consent:true,
    user:{uid:"member-uid",email:"member@example.org"}
  });
  await assert.rejects(
    () => sign(fixture.ctx,{
      token:fixture.token,
      signature:{type:"typed",value:"Member Signer"},
      consent:true,
      user:{uid:"wrong-user",email:"member@example.org"}
    }),
    error=>error.status===403
  );
});


test("Gateway completed-PDF verification accepts the exact hash and rejects tampered bytes", async () => {
  const fixture=await makeFixture({signerUid:"member-uid",signerEmail:"member@example.org"});
  const finalHash=await sha256Hex(ORIGINAL);
  fixture.envelope.status="Completed";
  fixture.envelope.completion={finalHash,cryptographicEvidenceIds:["CRYPTO-TEST"]};
  const user={uid:"member-uid",email:"member@example.org"};
  const accepted=await verifySigningPdf(fixture.ctx,fixture.token,user,new Uint8Array(ORIGINAL));
  assert.equal(accepted.verified,true);
  assert.equal(accepted.documentHash,finalHash);
  const tampered=new Uint8Array(ORIGINAL);
  tampered[tampered.length-1]^=1;
  await assert.rejects(
    ()=>verifySigningPdf(fixture.ctx,fixture.token,user,tampered),
    error=>error.status===409&&error.message.includes("does not match")
  );
});

test("Gateway completed-PDF verification requires the invited UID even for a valid hash", async () => {
  const fixture=await makeFixture({signerUid:"member-uid",signerEmail:"member@example.org"});
  fixture.envelope.status="Completed";
  fixture.envelope.completion={finalHash:await sha256Hex(ORIGINAL),cryptographicEvidenceIds:[]};
  await assert.rejects(
    ()=>verifySigningPdf(fixture.ctx,fixture.token,{uid:"wrong-user",email:"member@example.org"},new Uint8Array(ORIGINAL)),
    error=>error.status===403
  );
});


test("Production-mode Gateway signing fails closed without server-side Member/Employee authority verification", async () => {
  const fixture=await makeFixture({signerUid:"member-uid",signerEmail:"member@example.org"});
  fixture.ctx.env={DRIVE_MOCK:"false",IRPA_ENVIRONMENT:"staging"};
  await assert.rejects(
    ()=>sign(fixture.ctx,{
      token:fixture.token,
      signature:{type:"typed",value:"Member Signer"},
      consent:true,
      manualAuthorityIdentification:"Board Member",
      user:{uid:"member-uid",email:"member@example.org"}
    }),
    error=>error.status===503&&error.message.includes("Signing authority verification is not configured on this gateway.")
  );
  const current=await fixture.ctx.meta.get("envelopes",fixture.envelope.id);
  assert.equal(current.signers[0].status,"Pending");
});

test("Production-mode Gateway signing records the server-verified authority in the audit chain", async () => {
  const fixture=await makeFixture({signerUid:"member-uid",signerEmail:"member@example.org"});
  fixture.ctx.env={DRIVE_MOCK:"false",IRPA_ENVIRONMENT:"staging"};
  fixture.ctx.verifySigningAuthority=async(user,manualAuthorityIdentification)=>{
    assert.equal(user.uid,"member-uid");
    assert.equal(manualAuthorityIdentification,"Board Member");
    return {verified:true,authorityRole:"Board Member",authoritySourceCollection:"members",authoritySourceRecordId:"member-uid",verificationMethod:"Authenticated Gateway Member/Employee Register Match"};
  };
  const result=await sign(fixture.ctx,{
    token:fixture.token,
    signature:{type:"typed",value:"Member Signer"},
    consent:true,
    manualAuthorityIdentification:"Board Member",
    user:{uid:"member-uid",email:"member@example.org"}
  });
  assert.equal(result.status,"InProgress");
  const current=await fixture.ctx.meta.get("envelopes",fixture.envelope.id);
  assert.equal(current.signers[0].authorityVerification.authorityRole,"Board Member");
  assert.equal(current.events.at(-1).authoritySourceCollection,"members");
});


test("signature application without explicit confirmation is rejected", async () => {
  const fixture=await makeFixture({signerUid:"member-uid",signerEmail:"member@example.org",secondSigner:false});
  fixture.envelope.fields=[{fieldId:"page-three-signature",type:"Signature",page:3,x:20,y:30,width:35,height:10,signerUid:"member-uid",required:true}];
  await assert.rejects(()=>sign(fixture.ctx,{
    token:fixture.token,signature:{type:"drawn",value:SIGNATURE_PNG},
    fieldValues:{"page-three-signature":SIGNATURE_PNG},consent:true,
    user:{uid:"member-uid",email:"member@example.org"}
  }),error=>error.status===400&&/confirm/i.test(error.message));
  const current=await fixture.ctx.meta.get("envelopes",fixture.envelope.id);
  assert.equal(current.signers[0].status,"Pending");
});

test("confirmed signature is rendered on the saved third-page field position", async () => {
  const fixture=await makeFixture({signerUid:"member-uid",signerEmail:"member@example.org",secondSigner:false});
  const field={fieldId:"page-three-signature",type:"Signature",page:3,x:20,y:30,width:35,height:10,signerUid:"member-uid",required:true};
  fixture.envelope.fields=[field];
  const result=await sign(fixture.ctx,{
    token:fixture.token,signature:{type:"drawn",value:SIGNATURE_PNG},
    fieldValues:{},fieldApplications:[{...field,confirmed:true,value:SIGNATURE_PNG}],
    signatureConfirmed:true,consent:true,
    user:{uid:"member-uid",email:"member@example.org"}
  });
  assert.equal(result.status,"Completed");
  const current=await fixture.ctx.meta.get("envelopes",fixture.envelope.id);
  assert.equal(current.fields[0].page,3);
  assert.deepEqual(current.signers[0].fieldValues,{"page-three-signature":SIGNATURE_PNG});
  const signed=await getSigningPdf(fixture.ctx,fixture.token,{uid:"member-uid",email:"member@example.org"});
  const pdf=await PDFDocument.load(signed.bytes);
  assert.equal(pdf.getPageCount(),4,"three source pages plus the signature certificate");
  const pageThree=pdf.getPages()[2];
  const xObjects=pageThree.node.Resources()?.lookup(PDFName.of("XObject"));
  assert.ok(xObjects && xObjects.size()>0,"the confirmed signature image must be on page 3");
  const pageOne=pdf.getPages()[0];
  const firstPageObjects=pageOne.node.Resources()?.lookup(PDFName.of("XObject"));
  assert.ok(!firstPageObjects||firstPageObjects.size()===0,"the page-3 signature must not be moved to page 1");
});

test("a non-assigned signer cannot apply another officer's signature field", async () => {
  const fixture=await makeFixture({signerUid:"member-uid",signerEmail:"member@example.org"});
  fixture.envelope.fields=[{fieldId:"other-signature",type:"Signature",page:3,x:20,y:30,width:35,height:10,signerUid:"second-user",required:true}];
  await assert.rejects(()=>sign(fixture.ctx,{
    token:fixture.token,signature:{type:"drawn",value:SIGNATURE_PNG},
    fieldApplications:[{fieldId:"other-signature",confirmed:true,page:3,x:20,y:30,width:35,height:10,value:SIGNATURE_PNG}],
    signatureConfirmed:true,consent:true,user:{uid:"member-uid",email:"member@example.org"}
  }),error=>error.status===403);
});

test("Gateway open keeps later signers' assignments hidden while retaining the assigned field page", async () => {
  const fixture=await makeFixture({signerUid:"member-uid",signerEmail:"member@example.org"});
  fixture.envelope.fields=[
    {fieldId:"first-signature",type:"Signature",page:3,x:20,y:30,width:35,height:10,signerUid:"member-uid",required:true},
    {fieldId:"later-signature",type:"Signature",page:3,x:60,y:30,width:30,height:10,signerUid:"second-user",required:true}
  ];
  const opened=await openSigning(fixture.ctx,fixture.token,{uid:"member-uid",email:"member@example.org"});
  assert.deepEqual(opened.fields.map(field=>field.fieldId),["first-signature"]);
  assert.equal(opened.fields[0].page,3);
  assert.equal(opened.fields.some(field=>field.signerUid==="second-user"),false);
});
