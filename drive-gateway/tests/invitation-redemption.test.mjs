import test from "node:test";
import assert from "node:assert/strict";
import {createHash, generateKeyPairSync, createVerify, createSign} from "node:crypto";
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

function createHandler({fetch}){global.fetch=fetch;return handler;}

function decodePart(part){
  return JSON.parse(Buffer.from(part.replace(/-/g,"+").replace(/_/g,"/"),"base64").toString("utf8"));
}

test("Cloudflare invitation redemption creates/signs Firebase custom token and records PASSWORD_SETUP_PENDING without consuming invitation", async()=>{
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
    assert.equal(payload.claims.irpaInvitationId,"test-invitation");
    assert.equal(payload.claims.irpaInvitationRedemptionState,"PASSWORD_SETUP_PENDING");
    assert.equal(payload.claims.irpaInvitationRedeemed,undefined);

    const verifier=createVerify("RSA-SHA256");
    verifier.update(`${headerPart}.${payloadPart}`);
    verifier.end();
    assert.equal(verifier.verify(publicKeyPem,Buffer.from(signaturePart.replace(/-/g,"+").replace(/_/g,"/"),"base64")),true);

    const patch=calls.find(c=>c.options.method==="PATCH");
    assert.ok(patch);
    assert.match(patch.options.headers.Authorization,/Bearer test-google-access-token/);
    const patchBody=JSON.parse(patch.options.body);
    assert.equal(patchBody.fields.invitationRedeemedUid.stringValue,"firebase-test-uid");
    assert.equal(patchBody.fields.invitationRedemptionState.stringValue,"PASSWORD_SETUP_PENDING");
    assert.equal(patchBody.fields.invitationRedemptionStatus.stringValue,"Password Setup Pending");
    assert.ok(patchBody.fields.invitationPasswordSetupExpiresAt.timestampValue);
    assert.equal(patchBody.fields.invitationRedeemedAt,undefined);
  } finally {
    global.fetch=originalFetch;
  }
});


test("Cloudflare invitation redemption refuses an existing password account", async()=>{
  const originalFetch=global.fetch;
  const calls=[];
  global.fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url)==="https://oauth2.googleapis.com/token") return new Response(JSON.stringify({access_token:"test-google-access-token",expires_in:3600}),{status:200});
    if(String(url).includes("/databases/(default)/documents/invitations/")) return new Response(JSON.stringify({fields:invitationFields,updateTime:"2026-10-05T08:00:00.000000Z"}),{status:200});
    if(String(url).includes("identitytoolkit.googleapis.com/v1/projects/irpa-digital-board-governance/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"firebase-existing-uid",email:"invitee@example.org",providerUserInfo:[{providerId:"password",federatedId:"invitee@example.org"}]}]}),{status:200});
    throw new Error("Unexpected external request: "+url);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/redeem",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:`test-invitation.${tokenSecret}`})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
    assert.equal(response.status,409);
    assert.match((await response.json()).error,/normal IRPA login/i);
    assert.equal(calls.some(c=>c.options.method==="PATCH"),false);
  } finally { global.fetch=originalFetch; }
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


test("password-set returns 401 when Firebase authentication is missing", async()=>{
  const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({invitationId:"missing-auth"})
  }),{
    FIREBASE_PROJECT_ID:"irpa-digital-board-governance",
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)
  });
  assert.equal(response.status,401);
  assert.deepEqual(await response.json(),{ok:false,error:"Firebase authentication is required."});
});

test("session-state returns 401 when Firebase authentication is missing", async()=>{
  const response=await handler.fetch(new Request("https://gw.test/api/invitations/session-state",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:"{}"
  }),{
    FIREBASE_PROJECT_ID:"irpa-digital-board-governance",
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)
  });
  assert.equal(response.status,401);
  assert.deepEqual(await response.json(),{ok:false,error:"Firebase authentication is required."});
});




function makeFirebaseIdToken(uid,email="invitee@example.org"){
  const header={alg:"RS256",kid:"invitation-test-key",typ:"JWT"};
  const payload={iss:"https://securetoken.google.com/irpa-digital-board-governance",aud:"irpa-digital-board-governance",sub:uid,user_id:uid,email,exp:Math.floor(Date.now()/1000)+3600};
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned=encode(header)+"."+encode(payload);
  const signer=createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return unsigned+"."+signer.sign(privateKey).toString("base64url");
}

test("password-set refuses activation when Firebase Auth has not independently confirmed a password provider", async()=>{
  const originalFetch=global.fetch;
  const calls=[];
  const idToken=makeFirebaseIdToken("password-pending-uid");
  global.fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) {
      return new Response(JSON.stringify({invitationTestKey:undefined}),{status:200});
    }
    if(target.includes("/databases/(default)/documents/invitations/password-verification-pending")) {
      return new Response(JSON.stringify({
        fields:{
          email:{stringValue:"invitee@example.org"},
          invitationRedeemedUid:{stringValue:"password-pending-uid"},
          invitationRedemptionState:{stringValue:"PASSWORD_SETUP_PENDING"},
          invitationPasswordSetupExpiresAt:{timestampValue:"2099-01-01T00:00:00Z"}
        },
        updateTime:"2026-10-05T08:00:00.000000Z"
      }),{status:200});
    }
    if(target.includes("/accounts:lookup")) {
      return new Response(JSON.stringify({users:[{localId:"password-pending-uid",email:"invitee@example.org",providerUserInfo:[]}]}),{status:200});
    }
    throw new Error("Unexpected external request: "+target);
  };
  try{
    // The activation gate is bypassed only for this password-set endpoint; Firebase ID-token
    // signature verification still runs. Supply the exact public JWK expected by the verifier.
    const jwk=publicKey.export({format:"jwk"});
    global.fetch=async(url,options={})=>{
      calls.push({url:String(url),options});
      const target=String(url);
      if(target.includes("securetoken@system.gserviceaccount.com")) {
        return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
      }
      if(target.includes("/databases/(default)/documents/invitations/password-verification-pending")) {
        return new Response(JSON.stringify({
          fields:{
            email:{stringValue:"invitee@example.org"},
            invitationRedeemedUid:{stringValue:"password-pending-uid"},
            invitationRedemptionState:{stringValue:"PASSWORD_SETUP_PENDING"},
            invitationPasswordSetupExpiresAt:{timestampValue:"2099-01-01T00:00:00Z"}
          },
          updateTime:"2026-10-05T08:00:00.000000Z"
        }),{status:200});
      }
      if(target.includes("/accounts:lookup")) {
        return new Response(JSON.stringify({users:[{localId:"password-pending-uid",email:"invitee@example.org",providerUserInfo:[]}]}),{status:200});
      }
      throw new Error("Unexpected external request: "+target);
    };
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{
      method:"POST",
      headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},
      body:JSON.stringify({invitationId:"password-verification-pending"})
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
    assert.equal(response.status,409);
    assert.match((await response.json()).error,/not confirmed a password credential/i);
    assert.equal(calls.some(c=>c.options.method==="PATCH"),false);
  } finally { global.fetch=originalFetch; }
});

test("password-set verifies the password provider and activates the invitation on the server", async()=>{
  const originalFetch=global.fetch;
  const calls=[];
  const idToken=makeFirebaseIdToken("password-confirmed-uid");
  const jwk=publicKey.export({format:"jwk"});
  let invitationState="PASSWORD_SETUP_PENDING";
  global.fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target.includes("/databases/(default)/documents/invitations/password-verification-confirmed")){
      if(options.method==="PATCH"){
        const body=JSON.parse(options.body);
        if(body.fields.invitationRedemptionState?.stringValue==="PROVISIONING_PENDING") invitationState="PROVISIONING_PENDING";
        if(body.fields.invitationRedemptionState?.stringValue==="ACTIVATED") invitationState="ACTIVATED";
        return new Response(JSON.stringify({name:"patched"}),{status:200});
      }
      return new Response(JSON.stringify({
        name:"projects/irpa-digital-board-governance/databases/(default)/documents/invitations/password-verification-confirmed",
        fields:{...invitationFields,
          invitationRedeemedUid:{stringValue:"password-confirmed-uid"},
          invitationRedemptionState:{stringValue:invitationState},
          invitationPasswordSetupExpiresAt:{timestampValue:"2099-01-01T00:00:00Z"},
          role:{stringValue:"Board Member"},
          boardMemberId:{stringValue:"board-123"}
        },
        updateTime:"2026-10-05T08:00:00.000000Z"
      }),{status:200});
    }
    if(target.includes("/documents/members/board-123")){
      if(options.method==="PATCH") return new Response(JSON.stringify({name:"patched"}),{status:200});
      return new Response(JSON.stringify({name:"projects/irpa-digital-board-governance/databases/(default)/documents/members/board-123",fields:{
        email:{stringValue:"invitee@example.org"},role:{stringValue:"Board Member"},boardMember:{booleanValue:true}
      }}),{status:200});
    }
    if(target.includes("/documents:runQuery")) return new Response(JSON.stringify([]),{status:200});
    if(target.includes("/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"password-confirmed-uid",email:"invitee@example.org",providerUserInfo:[{providerId:"password",federatedId:"invitee@example.org"}]}]}),{status:200});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{
      method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},
      body:JSON.stringify({invitationId:"password-verification-confirmed"})
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,invitationId:"password-verification-confirmed",uid:"password-confirmed-uid",state:"ACTIVATED",activatedRecords:1});
    assert.ok(calls.some(c=>c.options.method==="PATCH"&&JSON.parse(c.options.body).fields.invitationRedemptionState?.stringValue==="ACTIVATED"));
    assert.ok(calls.some(c=>c.options.method==="PATCH"&&JSON.parse(c.options.body).fields.accountActivated?.booleanValue===true));
  } finally { global.fetch=originalFetch; }
});

test("password-set refuses activation when the registered member record does not exist", async()=>{
  const idToken=makeFirebaseIdToken("unregistered-member-uid");
  const invitationId="unregistered-member-invitation";
  const calls=[];
  const handler=createHandler({
    fetch:async(url,options={})=>{
      const target=String(url);
      calls.push({target,options});
      if(target.includes("/documents/invitations/unregistered-member-invitation")) return new Response(JSON.stringify({
        name:"projects/irpa-digital-board-governance/databases/(default)/documents/invitations/"+invitationId,
        fields:{
          ...invitationFields,
          email:{stringValue:"invitee@example.org"},
          invitationRedeemedUid:{stringValue:"unregistered-member-uid"},
          invitationRedemptionState:{stringValue:"PASSWORD_SETUP_PENDING"},
          invitationPasswordSetupExpiresAt:{timestampValue:"2099-01-01T00:00:00Z"},
          memberType:{stringValue:"Governance Member"},
          role:{stringValue:"Governance Member"},
          institutionalRecordType:{stringValue:"Member"}
        },
        updateTime:"2026-10-05T08:00:00.000000Z"
      }),{status:200});
      if(target.includes("/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"unregistered-member-uid",email:"invitee@example.org",providerUserInfo:[{providerId:"password"}]}]}),{status:200});
      if(target.includes("/documents:runQuery")) return new Response(JSON.stringify([]),{status:200});
      if(target.includes("/documents/members/")) return new Response(JSON.stringify({error:{status:"NOT_FOUND"}}),{status:404});
      throw new Error("Unexpected request: "+target);
    }
  });
  const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{
    method:"POST",
    headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},
    body:JSON.stringify({invitationId})
  }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/registered IRPA member record/i);
  assert.equal(calls.some(c=>c.target.includes("/documents/members/")&&c.options.method==="PATCH"),false);
});

test("Cloudflare invitation redemption rejects a PASSWORD_SETUP_PENDING invitation after its 60-minute window", async()=>{
  const originalFetch=global.fetch;
  const calls=[];
  const id="expired-password-setup";
  const secret="expired-secret";
  const hash=createHash("sha256").update(secret).digest("hex");
  global.fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    const target=String(url);
    if(target==="https://oauth2.googleapis.com/token") return new Response(JSON.stringify({access_token:"test-google-access-token",expires_in:3600}),{status:200});
    if(target.includes("/databases/(default)/documents/invitations/"+id)) return new Response(JSON.stringify({
      fields:{...invitationFields,invitationTokenHash:{stringValue:hash},invitationRedemptionState:{stringValue:"PASSWORD_SETUP_PENDING"},invitationPasswordSetupExpiresAt:{timestampValue:"2026-10-05T10:00:00Z"}},
      updateTime:"2026-10-05T08:00:00.000000Z"
    }),{status:200});
    if(target.includes("/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"expired-uid",email:"invitee@example.org",providerUserInfo:[]}]}),{status:200});
    if(target.includes("/accounts") && options.method==="POST") return new Response(JSON.stringify({localId:"expired-uid",email:"invitee@example.org"}),{status:200});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/redeem",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:id+"."+secret})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
    assert.equal(response.status,410);
    assert.match((await response.json()).error,/password-setup window has expired/i);
    assert.equal(calls.some(c=>c.options.method==="PATCH"),false);
  } finally { global.fetch=originalFetch; }
});

test("Cloudflare invitation redemption rate-limits the sixth attempt for one invitation", async()=>{
  const originalFetch=global.fetch;
  const id="rate-limit-invitation";
  const secret="rate-limit-secret";
  const hash=createHash("sha256").update(secret).digest("hex");
  global.fetch=async(url,options={})=>{
    const target=String(url);
    if(target==="https://oauth2.googleapis.com/token") return new Response(JSON.stringify({access_token:"test-google-access-token",expires_in:3600}),{status:200});
    if(target.includes("/databases/(default)/documents/invitations/"+id)) return new Response(JSON.stringify({
      fields:{...invitationFields,invitationTokenHash:{stringValue:hash},invitationRedemptionState:{stringValue:"PENDING"}},
      updateTime:"2026-10-05T08:00:00.000000Z"
    }),{status:200});
    if(target.includes("/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"rate-limit-uid",email:"invitee@example.org",providerUserInfo:[{providerId:"password"}]}]}),{status:200});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const responses=[];
    for(let i=0;i<6;i++) responses.push(await handler.fetch(new Request("https://gw.test/api/invitations/redeem",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:id+"."+secret})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)}));
    assert.deepEqual(responses.slice(0,5).map(r=>r.status),[409,409,409,409,409]);
    assert.equal(responses[5].status,429);
    assert.match((await responses[5].json()).error,/too many invitation redemption attempts/i);
  } finally { global.fetch=originalFetch; }
});

test("password-set is idempotent when invitation is already PROVISIONING_PENDING", async()=>{
  const originalFetch=global.fetch;
  const jwk=publicKey.export({format:"jwk"});
  const idToken=makeFirebaseIdToken("provisioning-pending-uid");
  let patchCalled=false;
  global.fetch=async(url,options={})=>{
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target.includes("/databases/(default)/documents/invitations/provisioning-pending")) return new Response(JSON.stringify({
      fields:{
        email:{stringValue:"invitee@example.org"},
        invitationRedeemedUid:{stringValue:"provisioning-pending-uid"},
        invitationRedemptionState:{stringValue:"PROVISIONING_PENDING"},
        invitationPasswordSetupExpiresAt:{timestampValue:"2099-01-01T00:00:00Z"}
      },
      updateTime:"2026-10-05T08:00:00.000000Z"
    }),{status:200});
    if(target.includes("/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"provisioning-pending-uid",email:"invitee@example.org",providerUserInfo:[{providerId:"password"}]}]}),{status:200});
    if(options.method==="PATCH") patchCalled=true;
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{
      method:"POST",
      headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},
      body:JSON.stringify({invitationId:"provisioning-pending"})
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,invitationId:"provisioning-pending",uid:"provisioning-pending-uid",state:"PROVISIONING_PENDING"});
    assert.equal(patchCalled,false);
  } finally { global.fetch=originalFetch; }
});

test("portal activation gate rejects a valid Firebase ID token whose member record is not Activated", async()=>{
  const originalFetch=global.fetch;
  const jwk=publicKey.export({format:"jwk"});
  const idToken=makeFirebaseIdToken("pending-portal-uid");
  global.fetch=async(url)=>{
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target.includes("/documents/adminProfiles/pending-portal-uid")) return new Response("",{status:404});
    if(target.includes("/documents/members/pending-portal-uid")) return new Response(JSON.stringify({fields:{status:{stringValue:"Pending"},accountActivated:{booleanValue:false}}}),{status:200});
    if(target.includes("/documents/employees/pending-portal-uid")) return new Response("",{status:404});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/esign/cleanup",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:"{}"}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",ESIGN_MODULE_ENABLED:"true"});
    assert.equal(response.status,403);
    assert.deepEqual(await response.json(),{ok:false,error:"IRPA_INVITATION_FAILURE:PORTAL_ACTIVATION_REQUIRED"});
  } finally { global.fetch=originalFetch; }
});

test("session-state returns the invitation state for the authenticated UID", async()=>{
  const originalFetch=global.fetch;
  const jwk=publicKey.export({format:"jwk"});
  const idToken=makeFirebaseIdToken("session-state-uid");
  global.fetch=async(url,options={})=>{
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target.includes("/documents:runQuery")) return new Response(JSON.stringify([{document:{name:"projects/irpa-digital-board-governance/databases/(default)/documents/invitations/session-state-id",fields:{
      invitationRedeemedUid:{stringValue:"session-state-uid"},invitationRedemptionState:{stringValue:"PASSWORD_SETUP_PENDING"},updatedAt:{timestampValue:"2099-01-01T00:00:00Z"}
    }}}]),{status:200});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/session-state",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:"{}"}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{state:"PASSWORD_SETUP_PENDING",invitationId:"session-state-id"});
  } finally { global.fetch=originalFetch; }
});

test("password-set rejects a UID that is not assigned to the invitation", async()=>{
  const originalFetch=global.fetch;
  const jwk=publicKey.export({format:"jwk"});
  const idToken=makeFirebaseIdToken("wrong-uid");
  global.fetch=async(url,options={})=>{
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target.includes("/documents/invitations/wrong-uid-invitation")) return new Response(JSON.stringify({fields:{...invitationFields,invitationRedeemedUid:{stringValue:"different-uid"},invitationRedemptionState:{stringValue:"PASSWORD_SETUP_PENDING"},invitationPasswordSetupExpiresAt:{timestampValue:"2099-01-01T00:00:00Z"}},updateTime:"2026-10-05T08:00:00.000000Z"}),{status:200});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:JSON.stringify({invitationId:"wrong-uid-invitation"})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
    assert.equal(response.status,403);
  } finally { global.fetch=originalFetch; }
});

test("password-set rejects a Firebase email that does not match the invitation email", async()=>{
  const originalFetch=global.fetch;
  const jwk=publicKey.export({format:"jwk"});
  const idToken=makeFirebaseIdToken("wrong-email-uid");
  global.fetch=async(url,options={})=>{
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target.includes("/documents/invitations/wrong-email-invitation")) return new Response(JSON.stringify({fields:{...invitationFields,email:{stringValue:"assigned@example.org"},invitationRedeemedUid:{stringValue:"wrong-email-uid"},invitationRedemptionState:{stringValue:"PASSWORD_SETUP_PENDING"},invitationPasswordSetupExpiresAt:{timestampValue:"2099-01-01T00:00:00Z"}},updateTime:"2026-10-05T08:00:00.000000Z"}),{status:200});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:JSON.stringify({invitationId:"wrong-email-invitation"})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
    assert.equal(response.status,403);
  } finally { global.fetch=originalFetch; }
});

test("password-set is idempotent after invitation activation", async()=>{
  const originalFetch=global.fetch;
  const jwk=publicKey.export({format:"jwk"});
  const idToken=makeFirebaseIdToken("repeat-uid");
  let patchCount=0;
  global.fetch=async(url,options={})=>{
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target.includes("/documents/invitations/repeat-invitation")) return new Response(JSON.stringify({fields:{...invitationFields,invitationRedeemedUid:{stringValue:"repeat-uid"},invitationRedemptionState:{stringValue:"ACTIVATED"}},updateTime:"2026-10-05T08:00:00.000000Z"}),{status:200});
    if(options.method==="PATCH"){patchCount++;return new Response(JSON.stringify({name:"patched"}),{status:200});}
    throw new Error("Unexpected external request: "+target);
  };
  try{
    for(let i=0;i<2;i++){
      const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:JSON.stringify({invitationId:"repeat-invitation"})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
      assert.equal(response.status,200);
      assert.deepEqual(await response.json(),{ok:true,invitationId:"repeat-invitation",uid:"repeat-uid",state:"ACTIVATED"});
    }
    assert.equal(patchCount,0);
  } finally { global.fetch=originalFetch; }
});



test("password-set activates a registered Special Invitee from the third register", async()=>{
  const originalFetch=global.fetch;
  const jwk=publicKey.export({format:"jwk"});
  const idToken=makeFirebaseIdToken("special-invitee-uid","special@example.org");
  const calls=[];
  global.fetch=async(url,options={})=>{
    const target=String(url); calls.push({target,options});
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target.includes("/documents/invitations/special-invitee-invitation")) return new Response(JSON.stringify({
      name:"projects/irpa-digital-board-governance/databases/(default)/documents/invitations/special-invitee-invitation",
      fields:{...invitationFields,email:{stringValue:"special@example.org"},invitationRedeemedUid:{stringValue:"special-invitee-uid"},invitationRedemptionState:{stringValue:"PASSWORD_SETUP_PENDING"},invitationPasswordSetupExpiresAt:{timestampValue:"2099-01-01T00:00:00Z"},institutionalRecordId:{stringValue:"special-profile-1"},institutionalRecordType:{stringValue:"Special Invitee"},role:{stringValue:"Special Invitee"}},
      updateTime:"2026-10-05T08:00:00.000000Z"
    }),{status:200});
    if(target.includes("/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"special-invitee-uid",email:"special@example.org",providerUserInfo:[{providerId:"password"}]}]}),{status:200});
    if(target.includes("/documents/auditorProfiles/special-profile-1")) return new Response(JSON.stringify({
      name:"projects/irpa-digital-board-governance/databases/(default)/documents/auditorProfiles/special-profile-1",
      fields:{email:{stringValue:"special@example.org"},name:{stringValue:"Special Invitee"},category:{stringValue:"Special Invitee"},permissions:{arrayValue:{values:[{stringValue:"Read"},{stringValue:"Upload"},{stringValue:"Sign"}]}},active:{booleanValue:true}}
    }),{status:200});
    if(options.method==="PATCH") return new Response(JSON.stringify({name:"patched"}),{status:200});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{
      method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},
      body:JSON.stringify({invitationId:"special-invitee-invitation"})
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.state,"ACTIVATED");
    assert.equal(body.activatedRecords,1);
    assert.ok(calls.some(c=>c.target.includes("/documents/auditorProfiles/special-profile-1")&&c.options.method==="PATCH"));
  } finally { global.fetch=originalFetch; }
});


async function runRegisteredActivationCase({label,institutionalRecordType,institutionalRecordId,recordCollection,recordFields,role}) {
  const originalFetch=global.fetch;
  const uid=`e2e-${label.toLowerCase().replace(/[^a-z]+/g,"-")}`;
  const idToken=makeFirebaseIdToken(uid);
  const invitationId=`e2e-${label.toLowerCase().replace(/[^a-z]+/g,"-")}-invitation`;
  const calls=[];
  global.fetch=async(url,options={})=>{
    const target=String(url);calls.push({target,options});
    if(target.includes("securetoken@system.gserviceaccount.com"))return new Response(JSON.stringify({invitationTestKey:undefined}),{status:200});
    if(target.includes(`/documents/invitations/${invitationId}`))return new Response(JSON.stringify({
      name:`projects/irpa-digital-board-governance/databases/(default)/documents/invitations/${invitationId}`,
      fields:{email:{stringValue:"invitee@example.org"},invitationRedeemedUid:{stringValue:uid},invitationRedemptionState:{stringValue:"PASSWORD_SETUP_PENDING"},invitationPasswordSetupExpiresAt:{timestampValue:"2099-01-01T00:00:00Z"},institutionalRecordId:{stringValue:institutionalRecordId},institutionalRecordType:{stringValue:institutionalRecordType},role:{stringValue:role}},
      updateTime:"2026-10-05T08:00:00.000000Z"
    }),{status:200});
    if(target.includes("/accounts:lookup"))return new Response(JSON.stringify({users:[{localId:uid,email:"invitee@example.org",providerUserInfo:[{providerId:"password"}]}]}),{status:200});
    if(target.includes(`/documents/${recordCollection}/${institutionalRecordId}`))return new Response(JSON.stringify({name:`projects/irpa-digital-board-governance/databases/(default)/documents/${recordCollection}/${institutionalRecordId}`,fields:recordFields}),{status:200});
    if(target.includes("/documents:runQuery"))return new Response(JSON.stringify([]),{status:200});
    if(options.method==="PATCH")return new Response(JSON.stringify({name:"patched"}),{status:200});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:JSON.stringify({invitationId})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)});
    assert.equal(response.status,200,`${label} activation failed`);
    const body=await response.json();
    assert.equal(body.state,"ACTIVATED");
    assert.equal(body.activatedRecords,1);
    assert.ok(calls.some(x=>x.target.includes(`/documents/${recordCollection}/${institutionalRecordId}`)&&x.options.method==="PATCH"),`${label} institutional record was not activated`);
  } finally {global.fetch=originalFetch;}
}

test("Board Member uses the identical password-set activation path",async()=>runRegisteredActivationCase({
  label:"Board Member",institutionalRecordType:"Board Member",institutionalRecordId:"board-e2e-1",recordCollection:"members",
  recordFields:{email:{stringValue:"invitee@example.org"},boardMember:{booleanValue:true},role:{stringValue:"Board Member"}},role:"Board Member"
}));
test("Employee uses the identical password-set activation path",async()=>runRegisteredActivationCase({
  label:"Employee",institutionalRecordType:"Employee",institutionalRecordId:"employee-e2e-1",recordCollection:"employees",
  recordFields:{email:{stringValue:"invitee@example.org"},role:{stringValue:"Employee"}},role:"Employee"
}));
test("Auditor uses the identical password-set activation path",async()=>runRegisteredActivationCase({
  label:"Auditor",institutionalRecordType:"Auditor",institutionalRecordId:"auditor-e2e-1",recordCollection:"auditorProfiles",
  recordFields:{email:{stringValue:"invitee@example.org"},category:{stringValue:"Auditor"},permissions:{arrayValue:{values:[{stringValue:"Read"},{stringValue:"Download"},{stringValue:"Print"}]}},active:{booleanValue:true}},role:"Auditor"
}));
