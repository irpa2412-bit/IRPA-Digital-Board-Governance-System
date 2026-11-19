import test from "node:test";
import assert from "node:assert/strict";
import { classifySmtpReplyCategory, EMAIL_LINK_STAGE_CODES, runEmailStage } from "../src/invitationEmail.mjs";
import { createSmtpSelfcheckRoute, SMTP_SELF_CHECK_STAGES, SMTP_REPLY_CATEGORIES } from "../src/smtpDiagnostics.mjs";

test("required SMTP stage codes are present and every stage emits a sanitized failure category",async()=>{
  for(const stage of SMTP_SELF_CHECK_STAGES){
    assert.ok(EMAIL_LINK_STAGE_CODES.includes(stage));
    let emitted;
    await assert.rejects(runEmailStage(stage,async()=>{throw new Error("temporary transport failure")},(code,outcome,category)=>{emitted={code,outcome,category};}));
    assert.deepEqual(emitted,{code:stage,outcome:"failure",category:"UNKNOWN"});
  }
  assert.deepEqual(SMTP_SELF_CHECK_STAGES,["BUILD_MESSAGE","SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"]);
});

test("SMTP reply categories classify rate limits, authentication, connection, mailbox, recipient and unknown",()=>{
  assert.equal(classifySmtpReplyCategory(new Error("IRPA SMTP error 421"),"SMTP_CONNECT"),"RATE_LIMITED");
  assert.equal(classifySmtpReplyCategory(new Error("IRPA SMTP error 535"),"SMTP_AUTH"),"AUTH_FAILED");
  assert.equal(classifySmtpReplyCategory(Object.assign(new Error("connect failed"),{code:"ECONNREFUSED"}),"SMTP_CONNECT"),"CONNECTION_REFUSED");
  assert.equal(classifySmtpReplyCategory(new Error("IRPA SMTP error 552 5.2.2 mailbox full"),"SUBMIT"),"MAILBOX_FULL");
  assert.equal(classifySmtpReplyCategory(new Error("IRPA SMTP error 550 5.1.1 recipient rejected"),"RCPT_ACCEPTED"),"RECIPIENT_REJECTED");
  assert.equal(classifySmtpReplyCategory(new Error("unclassified provider response"),"SUBMIT"),"UNKNOWN");
  assert.deepEqual(SMTP_REPLY_CATEGORIES,["RATE_LIMITED","AUTH_FAILED","CONNECTION_REFUSED","MAILBOX_FULL","RECIPIENT_REJECTED","UNKNOWN"]);
});

test("SMTP self-check rejects non-admin before sending and writes no SMTP stage",async()=>{
  let sends=0,audits=0;
  const route=createSmtpSelfcheckRoute({
    authenticateFirebaseRequest:async()=>({user_id:"member-1",email:"member@example.org",token:"test"}),
    getFirestoreDocument:async()=>({fields:{active:{booleanValue:true},role:{stringValue:"Member"}}}),
    smtpSend:async()=>{sends++;},writeAudit:async()=>{audits++;},
    json:(body,status)=>new Response(JSON.stringify(body),{status}),corsHeaders:()=>({})
  });
  const response=await route(new Request("https://gw.test/api/system/smtp-selfcheck",{method:"POST"}),{});
  assert.equal(response.status,403);
  assert.equal(sends,0);
  assert.equal(audits,0);
});

test("SMTP self-check sends exactly one message to the fixed IRPA mailbox and audits every successful stage",async()=>{
  const audits=[],sent=[];
  const route=createSmtpSelfcheckRoute({
    authenticateFirebaseRequest:async()=>({user_id:"admin-1",email:"admin@example.org",token:"test"}),
    getFirestoreDocument:async()=>({fields:{active:{booleanValue:true},role:{stringValue:"Administrator"}}}),
    smtpSend:async(_env,message)=>{sent.push(message);for(const stage of SMTP_SELF_CHECK_STAGES)await message.onStage(stage,"success","UNKNOWN");return "250 accepted";},
    writeAudit:async(_env,_claims,event)=>audits.push(event),
    json:(body,status)=>new Response(JSON.stringify(body),{status}),corsHeaders:()=>({})
  });
  const response=await route(new Request("https://gw.test/api/system/smtp-selfcheck",{method:"POST"}),{});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.ok,true);
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,"info@irpa.or.tz");
  assert.equal(audits.length,5);
  assert.deepEqual(audits.map(x=>x.stageCode),SMTP_SELF_CHECK_STAGES);
  assert.equal(JSON.stringify(body).includes("admin@example.org"),false);
});

test("SMTP self-check returns sanitized failing stage and category",async()=>{
  const audits=[];
  const route=createSmtpSelfcheckRoute({
    authenticateFirebaseRequest:async()=>({user_id:"admin-1",email:"irpa2412@gmail.com",token:"test"}),
    getFirestoreDocument:async()=>null,
    smtpSend:async(_env,message)=>{const error=new Error("IRPA SMTP error 550 5.1.1 recipient rejected at person@example.org");error.stageCode="RCPT_ACCEPTED";error.smtpReplyCategory="RECIPIENT_REJECTED";await message.onStage(error.stageCode,"failure",error.smtpReplyCategory);throw error;},
    writeAudit:async(_env,_claims,event)=>audits.push(event),
    json:(body,status)=>new Response(JSON.stringify(body),{status}),corsHeaders:()=>({})
  });
  const response=await route(new Request("https://gw.test/api/system/smtp-selfcheck",{method:"POST"}),{});
  const body=await response.json();
  assert.equal(response.status,502);
  assert.equal(body.stageCode,"RCPT_ACCEPTED");
  assert.equal(body.smtpReplyCategory,"RECIPIENT_REJECTED");
  assert.equal(JSON.stringify(body).includes("person@example.org"),false);
  assert.equal(audits.length,1);
});
