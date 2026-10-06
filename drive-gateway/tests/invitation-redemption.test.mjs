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
    if(String(url).includes("identitytoolkit.googleapis.com/v1/accounts:createAuthUri")) return new Response(JSON.stringify({registered:false,allProviders:[]}),{status:200});
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
      FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",
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
    if(String(url).includes("identitytoolkit.googleapis.com/v1/accounts:createAuthUri")) return new Response(JSON.stringify({registered:true,allProviders:["password"]}),{status:200});
    if(String(url).includes("identitytoolkit.googleapis.com/v1/projects/irpa-digital-board-governance/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"firebase-existing-uid",email:"invitee@example.org",providerUserInfo:[{providerId:"password",federatedId:"invitee@example.org"}]}]}),{status:200});
    throw new Error("Unexpected external request: "+url);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/redeem",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:`test-invitation.${tokenSecret}`})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),FIREBASE_WEB_API_KEY:"test-web-api-key"});
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
      FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",
      FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)
    });
    assert.equal(response.status,400);
    assert.deepEqual(await response.json(),{ok:false,status:400,error:"IRPA_INVITATION_FAILURE:REDEEM_TOKEN",message:"The invitation link is invalid."});
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
    FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",
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
    FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)
  });
  assert.equal(response.status,401);
  assert.deepEqual(await response.json(),{ok:false,error:"Firebase authentication is required."});
});




function makeFirebaseIdToken(uid){
  const header={alg:"RS256",kid:"invitation-test-key",typ:"JWT"};
  const payload={iss:"https://securetoken.google.com/irpa-digital-board-governance",aud:"irpa-digital-board-governance",sub:uid,user_id:uid,email:"invitee@example.org",exp:Math.floor(Date.now()/1000)+3600};
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
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),FIREBASE_WEB_API_KEY:"test-web-api-key"});
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
    if(target==="https://oauth2.googleapis.com/token") return new Response(JSON.stringify({access_token:"test-google-access-token",expires_in:3600}),{status:200});
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
    if(target.endsWith("/documents/members/board-123")){
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
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),FIREBASE_WEB_API_KEY:"test-web-api-key"});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,invitationId:"password-verification-confirmed",uid:"password-confirmed-uid",state:"ACTIVATED",activatedRecords:1});
    assert.ok(calls.some(c=>c.options.method==="PATCH"&&JSON.parse(c.options.body).fields.invitationRedemptionState?.stringValue==="ACTIVATED"));
    assert.ok(calls.some(c=>c.options.method==="PATCH"&&JSON.parse(c.options.body).fields.accountActivated?.booleanValue===true));
  } finally { global.fetch=originalFetch; }
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
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/redeem",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:id+"."+secret})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),FIREBASE_WEB_API_KEY:"test-web-api-key"});
    assert.equal(response.status,410);
    assert.match((await response.json()).error,/password-setup window has expired/i);
    assert.equal(calls.some(c=>c.options.method==="PATCH"),false);
  } finally { global.fetch=originalFetch; }
});

test("Cloudflare invitation redemption enforces the per-invitation rate limit", async()=>{
  const originalFetch=global.fetch;
  const id="rate-limit-invitation";
  const secret="rate-limit-invitation-secret-123";
  const hash=createHash("sha256").update(secret).digest("hex");
  const counts=new Map();
  const kv={get:async key=>counts.get(key)||null,put:async(key,value)=>counts.set(key,String(value))};
  global.fetch=async(url,options={})=>{
    const target=String(url);
    if(target==="https://oauth2.googleapis.com/token") return new Response(JSON.stringify({access_token:"test-google-access-token",expires_in:3600}),{status:200});
    if(target.includes("/databases/(default)/documents/invitations/"+id)) return new Response(JSON.stringify({
      fields:{...invitationFields,invitationTokenHash:{stringValue:hash},status:{stringValue:"Pending"}},
      updateTime:"2026-10-05T08:00:00.000000Z"
    }),{status:200});
    if(target.includes("/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"rate-limit-uid",email:"invitee@example.org",providerUserInfo:[{providerId:"password"}]}]}),{status:200});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const responses=[];
    for(let i=0;i<11;i++) responses.push(await handler.fetch(new Request("https://gw.test/api/invitations/redeem",{
      method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":"198.51.100.10"},
      body:JSON.stringify({token:id+"."+secret})
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),DRIVE_KV:kv}));
    assert.deepEqual(responses.slice(0,10).map(r=>r.status),Array(10).fill(409));
    assert.equal(responses[10].status,429);
    assert.match((await responses[10].json()).error,/REDEEM_RATE_LIMIT_INVITATION/);
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
        invitationRedeemedUid:{stringValue:"provisioning-pending-uid"},
        invitationRedemptionState:{stringValue:"PROVISIONING_PENDING"},
        invitationPasswordSetupExpiresAt:{timestampValue:"2099-01-01T00:00:00Z"}
      },
      updateTime:"2026-10-05T08:00:00.000000Z"
    }),{status:200});
    if(target.includes("/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"provisioning-pending-uid",providerUserInfo:[{providerId:"password"}]}]}),{status:200});
    if(options.method==="PATCH") patchCalled=true;
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{
      method:"POST",
      headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},
      body:JSON.stringify({invitationId:"provisioning-pending"})
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),FIREBASE_WEB_API_KEY:"test-web-api-key"});
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
    const response=await handler.fetch(new Request("https://gw.test/api/esign/cleanup",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:"{}"}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",ESIGN_MODULE_ENABLED:"true"});
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
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/session-state",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:"{}"}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),FIREBASE_WEB_API_KEY:"test-web-api-key"});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,state:"PASSWORD_SETUP_PENDING",invitationId:"session-state-id"});
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
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:JSON.stringify({invitationId:"wrong-uid-invitation"})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),FIREBASE_WEB_API_KEY:"test-web-api-key"});
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
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:JSON.stringify({invitationId:"wrong-email-invitation"})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),FIREBASE_WEB_API_KEY:"test-web-api-key"});
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
      const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:JSON.stringify({invitationId:"repeat-invitation"})}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),FIREBASE_WEB_API_KEY:"test-web-api-key"});
      assert.equal(response.status,200);
      assert.deepEqual(await response.json(),{ok:true,invitationId:"repeat-invitation",uid:"repeat-uid",state:"ACTIVATED"});
    }
    assert.equal(patchCount,0);
  } finally { global.fetch=originalFetch; }
});



test("Cloudflare invitation redemption enforces the per-IP rate limit independently of invitation identity", async()=>{
  const originalFetch=global.fetch;
  const counts=new Map();
  const kv={get:async key=>counts.get(key)||null,put:async(key,value)=>counts.set(key,String(value))};
  global.fetch=async()=>{ throw new Error("Malformed-token test must not reach Firebase."); };
  try{
    const responses=[];
    for(let i=0;i<31;i++) responses.push(await handler.fetch(new Request("https://gw.test/api/invitations/redeem",{
      method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":"198.51.100.20"},
      body:JSON.stringify({token:"bad"})
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),DRIVE_KV:kv}));
    assert.deepEqual(responses.slice(0,30).map(r=>r.status),Array(30).fill(400));
    assert.equal(responses[30].status,429);
    assert.match((await responses[30].json()).error,/REDEEM_RATE_LIMIT_IP/);
  } finally { global.fetch=originalFetch; }
});

test("password-set commits member activation and invitation activation atomically", async()=>{
  const originalFetch=global.fetch;
  const jwk=publicKey.export({format:"jwk"});
  const idToken=makeFirebaseIdToken("atomic-uid");
  const writes=[];
  global.fetch=async(url,options={})=>{
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target.includes("/documents/invitations/atomic-invitation")) return new Response(JSON.stringify({
      fields:{...invitationFields,invitationRedeemedUid:{stringValue:"atomic-uid"},invitationRedemptionState:{stringValue:"PASSWORD_SETUP_PENDING"}},
      updateTime:"2026-10-05T08:00:00.000000Z"
    }),{status:200});
    if(target.includes("/documents/members/atomic-uid")) return new Response("",{status:404});
    if(target.includes("/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"atomic-uid",email:"invitee@example.org",providerUserInfo:[{providerId:"password"}]}]}),{status:200});
    if(target.includes("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({access_token:"test-google-access-token",expires_in:3600}),{status:200});
    if(target.includes("/documents:commit")){
      const body=JSON.parse(options.body); writes.push(body.writes); return new Response(JSON.stringify({commitTime:"2099-01-01T00:00:00Z"}),{status:200});
    }
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{
      method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},
      body:JSON.stringify({invitationId:"atomic-invitation"})
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),FIREBASE_WEB_API_KEY:"test-web-api-key"});
    assert.equal(response.status,200);
    assert.equal(writes.length,1);
    assert.equal(writes[0].length,2);
    assert.match(writes[0][0].update.name,/\/members\/atomic-uid$/);
    assert.match(writes[0][1].update.name,/\/invitations\/atomic-invitation$/);
    assert.equal(writes[0][0].update.fields.accountActivated.booleanValue,true);
    assert.equal(writes[0][0].update.fields.registrationStatus.stringValue,"Activated");
    assert.equal(writes[0][1].update.fields.status.stringValue,"ACTIVATED");
  } finally { global.fetch=originalFetch; }
});

test("password-set refuses to overwrite an existing privileged member record", async()=>{
  const originalFetch=global.fetch;
  const jwk=publicKey.export({format:"jwk"});
  const idToken=makeFirebaseIdToken("privileged-uid");
  let commitCalled=false;
  global.fetch=async(url,options={})=>{
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target.includes("/documents/invitations/privileged-invitation")) return new Response(JSON.stringify({
      fields:{...invitationFields,invitationRedeemedUid:{stringValue:"privileged-uid"},invitationRedemptionState:{stringValue:"PASSWORD_SETUP_PENDING"}},
      updateTime:"2026-10-05T08:00:00.000000Z"
    }),{status:200});
    if(target.includes("/documents/members/privileged-uid")) return new Response(JSON.stringify({fields:{
      uid:{stringValue:"privileged-uid"},email:{stringValue:"invitee@example.org"},role:{stringValue:"Administrator"},admin:{booleanValue:true},status:{stringValue:"Active"}
    }}),{status:200});
    if(target.includes("/accounts:lookup")) return new Response(JSON.stringify({users:[{localId:"privileged-uid",email:"invitee@example.org",providerUserInfo:[{providerId:"password"}]}]}),{status:200});
    if(target.includes("/documents:commit")) {commitCalled=true; return new Response(JSON.stringify({}),{status:200});}
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/password-set",{
      method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},
      body:JSON.stringify({invitationId:"privileged-invitation"})
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance",FIREBASE_WEB_API_KEY:"test-web-api-key",FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount),FIREBASE_WEB_API_KEY:"test-web-api-key"});
    assert.equal(response.status,409);
    assert.match((await response.json()).error,/PASSWORD_MEMBER_CONFLICT/);
    assert.equal(commitCalled,false);
  } finally { global.fetch=originalFetch; }
});

test("portal activation gate accepts member status Active", async()=>{
  const originalFetch=global.fetch;
  const jwk=publicKey.export({format:"jwk"});
  const idToken=makeFirebaseIdToken("active-portal-uid");
  global.fetch=async(url)=>{
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target.includes("/documents/adminProfiles/active-portal-uid")) return new Response("",{status:404});
    if(target.includes("/documents/members/active-portal-uid")) return new Response(JSON.stringify({fields:{
      uid:{stringValue:"active-portal-uid"},email:{stringValue:"invitee@example.org"},status:{stringValue:"Active"},accountActivated:{booleanValue:true}
    }}),{status:200});
    if(target.includes("/documents/employees/active-portal-uid")) return new Response("",{status:404});
    if(target.includes("/documents:runQuery")) return new Response(JSON.stringify([]),{status:200});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/session/profile",{method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:"{}"}),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance"});
    assert.notEqual(response.status,403);
  } finally { global.fetch=originalFetch; }
});



test("session-state returns NONE when the authenticated UID has no invitation", async()=>{
  const originalFetch=global.fetch;
  const jwk=publicKey.export({format:"jwk"});
  const idToken=makeFirebaseIdToken("no-invitation-uid");
  global.fetch=async(url)=>{
    const target=String(url);
    if(target.includes("securetoken@system.gserviceaccount.com")) return new Response(JSON.stringify({keys:[{...jwk,kid:"invitation-test-key",alg:"RS256",use:"sig"}]}),{status:200});
    if(target==="https://oauth2.googleapis.com/token") return new Response(JSON.stringify({access_token:"test-google-access-token",expires_in:3600}),{status:200});
    if(target.includes("/documents:runQuery")) return new Response(JSON.stringify([]),{status:200});
    throw new Error("Unexpected external request: "+target);
  };
  try{
    const response=await handler.fetch(new Request("https://gw.test/api/invitations/session-state",{
      method:"POST",headers:{Authorization:"Bearer "+idToken,"Content-Type":"application/json"},body:"{}"
    }),{FIREBASE_PROJECT_ID:"irpa-digital-board-governance"});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,state:"NONE",invitationId:null});
  } finally { global.fetch=originalFetch; }
});
