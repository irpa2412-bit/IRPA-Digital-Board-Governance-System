import test from "node:test";
import assert from "node:assert/strict";
import {createHash, generateKeyPairSync, createVerify} from "node:crypto";
import handler from "../src/index.js";

const {privateKey, publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const privateKeyPem=privateKey.export({type:"pkcs8",format:"pem"});
const publicKeyPem=publicKey.export({type:"spki",format:"pem"});
const serviceAccount={
  client_email:"irpa-test@irpa-digital-board-governance.iam.gserviceaccount.com",
  private_key:privateKeyPem
};
const tokenSecret="unit-test-invitation-secret";
const invitationHash=createHash("sha256").update(tokenSecret).digest("hex");
const invitationFields={
  email:{stringValue:"invitee@example.org"},
  name:{stringValue:"Test Invitee"},
  status:{stringValue:"Pending"},
  invitationTokenVersion:{stringValue:"2"},
  invitationTokenHash:{stringValue:invitationHash},
  invitationExpiresAt:{timestampValue:"2099-01-01T00:00:00Z"}
};

function decodePart(part){
  return JSON.parse(Buffer.from(part.replace(/-/g,"+").replace(/_/g,"/"),"base64").toString("utf8"));
}

test("Cloudflare invitation redemption creates/signs Firebase custom token and redeems Firestore record", async()=>{
  const originalFetch=global.fetch;
  const calls=[];
  global.fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url)==="https://oauth2.googleapis.com/token"){
      return new Response(JSON.stringify({access_token:"test-google-access-token",expires_in:3600}),{status:200});
    }
    if(String(url).includes("/databases/(default)/documents/invitations/")){
      if(options.method==="PATCH"){
        return new Response(JSON.stringify({name:"redeemed"}),{status:200});
      }
      return new Response(JSON.stringify({
        name:"projects/irpa-digital-board-governance/databases/(default)/documents/invitations/test-invitation",
        fields:invitationFields,
        updateTime:"2026-10-05T08:00:00.000000Z"
      }),{status:200});
    }
    if(String(url).includes("identitytoolkit.googleapis.com/v1/projects/irpa-digital-board-governance/accounts:lookup")){
      return new Response(JSON.stringify({users:[]}),{status:200});
    }
    if(String(url).includes("identitytoolkit.googleapis.com/v1/projects/irpa-digital-board-governance/accounts")){
      return new Response(JSON.stringify({localId:"firebase-test-uid",email:"invitee@example.org"}),{status:200});
    }
    throw new Error("Unexpected external request: "+url);
  };

  try{
    const request=new Request("https://gw.test/api/invitations/redeem",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token:`test-invitation.${tokenSecret}`})
    });
    const response=await handler.fetch(request,{
      FIREBASE_PROJECT_ID:"irpa-digital-board-governance",
      FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)
    });
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.ok,true);
    assert.equal(body.invitationId,"test-invitation");
    assert.equal(body.uid,"firebase-test-uid");
    assert.match(body.customToken,/^[^.]+\.[^.]+\.[^.]+$/);

    const [headerPart,payloadPart,signaturePart]=body.customToken.split(".");
    const header=decodePart(headerPart);
    const payload=decodePart(payloadPart);
    assert.equal(header.alg,"RS256");
    assert.equal(payload.uid,"firebase-test-uid");
    assert.equal(payload.irpaInvitationId,"test-invitation");
    assert.equal(payload.claims.irpaInvitationRedeemed,true);

    const verifier=createVerify("RSA-SHA256");
    verifier.update(`${headerPart}.${payloadPart}`);
    verifier.end();
    assert.equal(verifier.verify(publicKeyPem,Buffer.from(signaturePart.replace(/-/g,"+").replace(/_/g,"/"),"base64")),true);

    const patch=calls.find(c=>c.options.method==="PATCH");
    assert.ok(patch);
    assert.match(patch.options.headers.Authorization,/Bearer test-google-access-token/);
    const patchBody=JSON.parse(patch.options.body);
    assert.equal(patchBody.fields.invitationRedeemedUid.stringValue,"firebase-test-uid");
    assert.equal(patchBody.fields.invitationRedemptionStatus.stringValue,"Redeemed — Awaiting Activation");
  } finally {
    global.fetch=originalFetch;
  }
});

test("Cloudflare invitation redemption rejects malformed tokens before contacting Firebase", async()=>{
  const originalFetch=global.fetch;
  let calls=0;
  global.fetch=async()=>{calls++;throw new Error("fetch must not be called");};
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/redeem",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token:"malformed"})
    }),{
      FIREBASE_PROJECT_ID:"irpa-digital-board-governance",
      FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)
    });
    assert.equal(response.status,400);
    assert.deepEqual(await response.json(),{ok:false,error:"The invitation token is invalid."});
    assert.equal(calls,0);
  } finally {
    global.fetch=originalFetch;
  }
});

// Isolated CI gate.
