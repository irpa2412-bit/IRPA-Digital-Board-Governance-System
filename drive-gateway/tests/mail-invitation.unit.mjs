import test from "node:test";
import assert from "node:assert/strict";
import { handleSendInvitationEmail, sendWithRetry, isRetryableMailError, isInvitationQueueActive } from "../src/invitationEmail.mjs";
import { queueInductionEmail } from "../../functions/queueInductionEmail.mjs";

const quiet = { error() {}, log() {} };
const sleep = async () => {};

function makeEnv() {
  const store = new Map();
  return { INVITE_SERVICE_KEY:"test-key", IRPA_APP_URL:"https://app.example.test", DRIVE_KV:{get:async k=>store.get(k)??null,put:async(k,v)=>void store.set(k,v)} };
}
function req(body, token="valid-token") {
  return new Request("https://gw.test/api/send-invitation-email", {
    method:"POST", headers:token?{authorization:"Bearer "+token,"content-type":"application/json"}:{"content-type":"application/json"},
    body:typeof body==="string"?body:JSON.stringify(body)
  });
}
function legacyReq(body,key="test-key") {
  return new Request("https://gw.test/api/send-invitation-email", {
    method:"POST", headers:{"x-irpa-service-key":key,"content-type":"application/json"},
    body:JSON.stringify(body)
  });
}
const good = {to:"a@example.org",name:"Amina",subject:"IRPA test",text:"Hello",html:"<p>Hello</p>"};
const serviceClaims={user_id:"irpa-email-dispatcher",firebaseClaims:{emailDeliveryService:true}};
function deps(overrides={}) {
  return {
    authenticateFirebaseRequest:async(_request,_env,options)=>{assert.equal(options.skipActivation,true);return serviceClaims;},
    enforceRateLimit:async()=>{},
    smtpSend:async()=>({messageId:"m-1"}),
    logger:quiet,
    ...overrides
  };
}

test("rejects requests without Firebase service authentication",async()=>{
  const result=await handleSendInvitationEmail(req(good,null),makeEnv(),deps({authenticateFirebaseRequest:async()=>{throw new Error("no token");}}));
  assert.equal(result.status,401);
});
test("accepts the old service key only as a temporary compatibility path",async()=>{
  const sent=[];
  const result=await handleSendInvitationEmail(legacyReq(good),makeEnv(),deps({smtpSend:async(_env,message)=>{sent.push(message);return{messageId:"legacy-1"};}}));
  assert.equal(result.status,200);assert.equal(sent.length,1);
  assert.equal((await handleSendInvitationEmail(legacyReq(good,"wrong-key"),makeEnv(),deps())).status,401);
});
test("rejects authenticated users that are not the dedicated email service",async()=>{
  const result=await handleSendInvitationEmail(req(good),makeEnv(),deps({authenticateFirebaseRequest:async()=>({user_id:"ordinary-user",firebaseClaims:{emailDeliveryService:true}})}));
  assert.equal(result.status,403);
});
test("rejects a service UID without the verified service claim",async()=>{
  const result=await handleSendInvitationEmail(req(good),makeEnv(),deps({authenticateFirebaseRequest:async()=>({user_id:"irpa-email-dispatcher",firebaseClaims:{emailDeliveryService:false}})}));
  assert.equal(result.status,403);
});
test("rejects malformed JSON, invalid recipients and unsafe headers",async()=>{
  assert.equal((await handleSendInvitationEmail(req("{"),makeEnv(),deps())).status,400);
  assert.equal((await handleSendInvitationEmail(req({...good,to:"not-an-email"}),makeEnv(),deps())).status,400);
  assert.equal((await handleSendInvitationEmail(req({...good,to:"a@example.org\r\nBcc: x@y.z"}),makeEnv(),deps())).status,400);
  assert.equal((await handleSendInvitationEmail(req({...good,subject:"Hello\r\nBcc: x@y.z"}),makeEnv(),deps())).status,400);
});
test("requires text and HTML message bodies",async()=>{
  assert.equal((await handleSendInvitationEmail(req({...good,html:7}),makeEnv(),deps())).status,400);
});
test("sends only after Firebase service identity and recipient rate limit pass",async()=>{
  const calls=[];
  const result=await handleSendInvitationEmail(req(good),makeEnv(),deps({
    enforceRateLimit:async(_env,to)=>calls.push(to),
    smtpSend:async(_env,message)=>{calls.push(message);return{messageId:"m-2"}}
  }));
  assert.equal(result.status,200);
  assert.equal((await result.json()).messageId,"m-2");
  assert.equal(calls[0],"a@example.org");
  assert.equal(calls[1].subject,"IRPA test");
});
test("fails closed when the service rate limiter is unavailable or exhausted",async()=>{
  assert.equal((await handleSendInvitationEmail(req(good),makeEnv(),deps({enforceRateLimit:async()=>{throw Object.assign(new Error("limit"),{status:429});}}))).status,429);
  assert.equal((await handleSendInvitationEmail(req(good),makeEnv(),deps({enforceRateLimit:async()=>{throw new Error("kv down");}}))).status,503);
});
test("retries transient SMTP failure then succeeds",async()=>{
  let n=0;
  const result=await handleSendInvitationEmail(req(good),makeEnv(),deps({smtpSend:async()=>{if(++n===1)throw new Error("temporary");return{messageId:"m-3"};}}));
  assert.equal(result.status,200);assert.equal(n,2);
});
test("returns 502 after final SMTP failure",async()=>{
  let n=0;
  const result=await handleSendInvitationEmail(req(good),makeEnv(),deps({smtpSend:async()=>{n++;throw new Error("provider down");}}));
  assert.equal(result.status,502);assert.equal(n,3);
});
function fakeDb(){const docs=new Map();return{docs,collection:c=>({doc:id=>({set:async d=>void docs.set(`${c}/${id}`,{...d}),update:async d=>void docs.set(`${c}/${id}`,{...docs.get(`${c}/${id}`),...d})})})};}
const base=db=>({db,invitationId:"INV-1",recipientEmail:"a@example.org",recipientName:"Amina",subject:"IRPA test",text:"Hello",html:"<p>Hello</p>",invitedByUid:"u1"});
test("queueInductionEmail uses a short-lived Firebase bearer token and records success",async()=>{
  const db=fakeDb(),headers=[];
  const fetchFn=async(url,options)=>{headers.push({url,options});return{ok:true,status:200,json:async()=>({ok:true,messageId:"m-9"})};};
  const out=await queueInductionEmail(base(db),{fetchFn,env:{GATEWAY_URL:"https://gw.test"},getServiceIdToken:async()=> "firebase-id-token",logger:quiet,sleep});
  assert.equal(out.status,"Sent");assert.equal(db.docs.get("emailQueue/INV-1").status,"Sent");
  assert.equal(headers[0].url,"https://gw.test/api/send-invitation-email");
  assert.equal(headers[0].options.headers.authorization,"Bearer firebase-id-token");
  assert.equal(headers[0].options.headers["x-irpa-service-key"],undefined);
});
test("queueInductionEmail retries transient Gateway failures then marks Failed",async()=>{
  const db=fakeDb();let n=0;
  const fetchFn=async()=>{n++;return{ok:false,status:502,json:async()=>({})};};
  const out=await queueInductionEmail(base(db),{fetchFn,env:{GATEWAY_URL:"https://gw.test"},getServiceIdToken:async()=> "token",logger:quiet,sleep});
  assert.equal(out.status,"Failed");assert.equal(n,3);assert.equal(db.docs.get("emailQueue/INV-1").status,"Failed");
});
test("queueInductionEmail does not retry permanent Gateway authorization failures",async()=>{
  const db=fakeDb();let n=0;
  const out=await queueInductionEmail(base(db),{fetchFn:async()=>{n++;return{ok:false,status:403,json:async()=>({})};},env:{GATEWAY_URL:"https://gw.test"},getServiceIdToken:async()=> "token",logger:quiet,sleep});
  assert.equal(out.status,"Failed");assert.equal(n,1);
});

import { authenticateSmtpPlain } from "../src/smtpAuth.mjs";
import { resolveSmtpConfiguration } from "../src/smtpConfig.mjs";

test("SMTP AUTH PLAIN accepts servers that immediately return success", async () => {
  const writes=[];
  const response=await authenticateSmtpPlain({
    username:"info@irpa.or.tz",password:"test-password",
    writeLine:async line=>writes.push(line),
    readResponse:async()=>"235 2.7.0 Authentication successful",
    command:async()=>{throw new Error("Challenge command must not be used");}
  });
  assert.match(response,/^235 /);
  assert.match(writes[0],/^AUTH PLAIN /);
});

test("SMTP AUTH PLAIN completes servers that first issue a 334 challenge", async () => {
  const writes=[],commands=[];
  const response=await authenticateSmtpPlain({
    username:"smtp-user",password:"test-password",
    writeLine:async line=>writes.push(line),
    readResponse:async()=>"334 ",
    command:async(payload,expected)=>{commands.push({payload,expected});return "235 2.7.0 Authentication successful";}
  });
  assert.match(response,/^235 /);
  assert.equal(writes.length,1);
  assert.equal(commands.length,1);
  assert.equal(commands[0].expected,"2");
  assert.equal(commands[0].payload,writes[0].slice("AUTH PLAIN ".length));
});

test("SMTP AUTH PLAIN fails closed on rejected credentials and unsafe usernames", async () => {
  const options={
    username:"smtp-user",password:"test-password",
    writeLine:async()=>{},
    readResponse:async()=>"535 5.7.8 Authentication credentials invalid",
    command:async()=>{throw new Error("Unexpected challenge");}
  };
  await assert.rejects(authenticateSmtpPlain(options),/authentication was rejected/i);
  await assert.rejects(authenticateSmtpPlain({...options,username:"smtp-user\r\nAUTH LOGIN"}),/username is invalid/i);
});


test("queued invitation delivery lease expires so interrupted sends can be retried",()=>{
  const now=Date.parse("2026-11-20T00:00:00.000Z");
  assert.equal(isInvitationQueueActive("2026-11-19T23:56:00.000Z",now),true);
  assert.equal(isInvitationQueueActive("2026-11-19T23:54:59.000Z",now),false);
  assert.equal(isInvitationQueueActive("",now),false);
  assert.equal(isInvitationQueueActive("not-a-date",now),false);
});


test("SMTP configuration uses the declared Gateway sender, TLS endpoint and optional username",()=>{
  assert.deepEqual(resolveSmtpConfiguration({SMTP_HOST:"mail.irpa.or.tz",SMTP_PORT:"465",SMTP_FROM:"info@irpa.or.tz",SMTP_PASSWORD:"secret"}),{host:"mail.irpa.or.tz",port:465,from:"info@irpa.or.tz",username:"info@irpa.or.tz",password:"secret"});
  assert.equal(resolveSmtpConfiguration({SMTP_FROM:"mailbox@irpa.or.tz",SMTP_USERNAME:"smtp-login@irpa.or.tz",SMTP_PASSWORD:"secret"}).username,"smtp-login@irpa.or.tz");
});

test("SMTP configuration rejects malformed host, port, sender and username without exposing credentials",()=>{
  assert.throws(()=>resolveSmtpConfiguration({SMTP_HOST:"mail.irpa.or.tz\r\nX"}),/host configuration is invalid/);
  assert.throws(()=>resolveSmtpConfiguration({SMTP_PORT:"70000"}),/port configuration is invalid/);
  assert.throws(()=>resolveSmtpConfiguration({SMTP_FROM:"not-an-email"}),/sender configuration is invalid/);
  assert.throws(()=>resolveSmtpConfiguration({SMTP_USERNAME:"smtp-user\r\nAUTH LOGIN"}),/username configuration is invalid/);
});
