import test from "node:test";
import assert from "node:assert/strict";
import { classifySmtpReplyCategory, EMAIL_LINK_STAGE_CODES, runEmailStage } from "../src/invitationEmail.mjs";
import { createSmtpSelfcheckRoute, SMTP_SELF_CHECK_STAGES, SMTP_REPLY_CATEGORIES } from "../src/smtpDiagnostics.mjs";

const response = async route => {
  const result=await route(new Request("https://gw.test/api/system/smtp-selfcheck",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({to:"recipient@gmail.com"})
  }),{SMTP_FROM:"info@irpa.or.tz"});
  return {result,body:await result.json()};
};

test("required SMTP stage codes are present and each failure emits a sanitized stage category",async()=>{
  for(const stage of SMTP_SELF_CHECK_STAGES){
    assert.ok(EMAIL_LINK_STAGE_CODES.includes(stage));
    let emitted;
    await assert.rejects(runEmailStage(stage,async()=>{throw new Error("temporary transport failure")},(code,outcome,category)=>{emitted={code,outcome,category};}));
    assert.deepEqual(emitted,{code:stage,outcome:"failure",category:stage==="SMTP_AUTH"?"AUTH_FAILED":"UNKNOWN"});
  }
  assert.deepEqual(SMTP_SELF_CHECK_STAGES,["BUILD_MESSAGE","SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"]);
});

test("SMTP reply categories classify provider responses",()=>{
  assert.equal(classifySmtpReplyCategory(new Error("IRPA SMTP error 421"),"SMTP_CONNECT"),"RATE_LIMITED");
  assert.equal(classifySmtpReplyCategory(new Error("IRPA SMTP error 535"),"SMTP_AUTH"),"AUTH_FAILED");
  assert.equal(classifySmtpReplyCategory(Object.assign(new Error("connect failed"),{code:"ECONNREFUSED"}),"SMTP_CONNECT"),"CONNECTION_REFUSED");
  assert.equal(classifySmtpReplyCategory(new Error("IRPA SMTP error 552 5.2.2 mailbox full"),"SUBMIT"),"MAILBOX_FULL");
  assert.equal(classifySmtpReplyCategory(new Error("452 4.2.2 mailbox full"),"SUBMIT"),"MAILBOX_FULL");
  assert.equal(classifySmtpReplyCategory(new Error("IRPA SMTP error 550 5.1.1 recipient rejected"),"RCPT_ACCEPTED"),"RECIPIENT_REJECTED");
  assert.equal(classifySmtpReplyCategory(new Error("unclassified provider response"),"SUBMIT"),"UNKNOWN");
  assert.deepEqual(SMTP_REPLY_CATEGORIES,["ACCEPTED","RATE_LIMITED","AUTH_FAILED","CONNECTION_REFUSED","MAILBOX_FULL","RECIPIENT_REJECTED","UNKNOWN"]);
});

test("SMTP self-check rejects non-admins before sending",async()=>{
  let sends=0,audits=0;
  const route=createSmtpSelfcheckRoute({
    authenticateFirebaseRequest:async()=>({user_id:"member-1",email:"member@example.org",token:"test"}),
    getFirestoreDocument:async()=>({fields:{active:{booleanValue:true},role:{stringValue:"Member"}}}),
    smtpSend:async()=>{sends++;},writeAudit:async()=>{audits++;},
    json:(body,status)=>new Response(JSON.stringify(body),{status}),corsHeaders:()=>({})
  });
  const result=await response(route);
  assert.equal(result.result.status,403);
  assert.equal(sends,0);
  assert.equal(audits,0);
});

test("owner/admin SMTP self-check sends exactly one message to the entered recipient and returns all stage replies",async()=>{
  const audits=[],sent=[];
  const route=createSmtpSelfcheckRoute({
    authenticateFirebaseRequest:async()=>({user_id:"admin-1",email:"admin@example.org",token:"test"}),
    getFirestoreDocument:async()=>({fields:{active:{booleanValue:true},role:{stringValue:"Administrator"}}}),
    smtpSend:async(_env,message)=>{
      sent.push(message);
      for(const stageCode of ["SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"]){
        const accepted=["RCPT_ACCEPTED","SUBMIT"].includes(stageCode);
        await message.onStage(stageCode,"success",accepted?"ACCEPTED":"UNKNOWN",{
          messageId:message.messageId,
          smtpReplyCode:accepted?250:250,
          smtpReply:stageCode==="RCPT_ACCEPTED"?"250 2.1.5 Recipient OK":stageCode==="SUBMIT"?"250 2.0.0 queued":"250 OK"
        });
      }
      return "250 2.0.0 queued";
    },
    writeAudit:async(_env,_claims,event)=>audits.push(event),
    json:(body,status)=>new Response(JSON.stringify(body),{status}),corsHeaders:()=>({})
  });
  const result=await response(route);
  const body=result.body;
  assert.equal(result.result.status,200);
  assert.equal(body.ok,true);
  assert.equal(body.acceptedByMailServer,true);
  assert.match(body.deliveryMeaning,/not proof of inbox delivery/i);
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,"recipient@gmail.com");
  assert.match(sent[0].rawMime,/From: IRPA Digital Signing <info@irpa\.or\.tz>/);
  assert.match(sent[0].rawMime,/To: <recipient@gmail\.com>/);
  assert.match(sent[0].rawMime,/Message-ID: <.+@irpa\.or\.tz>/);
  assert.equal(body.stages.length,5);
  assert.deepEqual(body.stages.map(x=>x.stageCode),SMTP_SELF_CHECK_STAGES);
  assert.equal(body.messageId,sent[0].messageId);
  assert.equal(body.smtpReplyCode,250);
  assert.equal(body.stages.at(-1).smtpReply,"250 2.0.0 queued");
  assert.equal(audits.length,5);
  assert.equal(JSON.stringify(body).includes("admin@example.org"),false);
});

test("system owner profile is authorized for SMTP self-check",async()=>{
  const route=createSmtpSelfcheckRoute({
    authenticateFirebaseRequest:async()=>({user_id:"owner-1",email:"owner@example.org",token:"test"}),
    getFirestoreDocument:async()=>({fields:{active:{booleanValue:true},isOwner:{booleanValue:true},role:{stringValue:"Owner"}}}),
    smtpSend:async(_env,message)=>{for(const stageCode of ["SMTP_CONNECT","SMTP_AUTH","RCPT_ACCEPTED","SUBMIT"])await message.onStage(stageCode,"success","ACCEPTED",{messageId:message.messageId,smtpReplyCode:250,smtpReply:"250 accepted"});return "250 accepted";},
    writeAudit:async()=>{},json:(body,status)=>new Response(JSON.stringify(body),{status}),corsHeaders:()=>({})
  });
  const result=await response(route);
  assert.equal(result.result.status,200);
  assert.equal(result.body.ok,true);
});

test("SMTP self-check returns the exact failing stage, reply category and sanitized SMTP reply",async()=>{
  const audits=[];
  const route=createSmtpSelfcheckRoute({
    authenticateFirebaseRequest:async()=>({user_id:"admin-1",email:"admin@example.org",token:"test"}),
    getFirestoreDocument:async()=>({fields:{active:{booleanValue:true},role:{stringValue:"Administrator"}}}),
    smtpSend:async(_env,message)=>{
      await message.onStage("SMTP_CONNECT","success","UNKNOWN",{messageId:message.messageId,smtpReplyCode:250,smtpReply:"250 connected"});
      const error=new Error("IRPA SMTP error 550");
      error.stageCode="RCPT_ACCEPTED";
      error.smtpResponseCode=550;
      error.smtpReply="550 5.1.1 recipient rejected";
      error.smtpReplyCategory="RECIPIENT_REJECTED";
      await message.onStage(error.stageCode,"failure",error.smtpReplyCategory,{messageId:message.messageId,smtpReplyCode:550,smtpReply:error.smtpReply});
      throw error;
    },
    writeAudit:async(_env,_claims,event)=>audits.push(event),
    json:(body,status)=>new Response(JSON.stringify(body),{status}),corsHeaders:()=>({})
  });
  const result=await response(route);
  assert.equal(result.result.status,502);
  assert.equal(result.body.stageCode,"RCPT_ACCEPTED");
  assert.equal(result.body.smtpReplyCategory,"RECIPIENT_REJECTED");
  assert.equal(result.body.smtpReplyCode,550);
  assert.equal(result.body.smtpReply,"550 5.1.1 recipient rejected");
  assert.match(result.body.messageId,/@irpa\.or\.tz/);
  assert.equal(audits.length,3);
  assert.deepEqual(audits.map(event=>event.stageCode),["BUILD_MESSAGE","SMTP_CONNECT","RCPT_ACCEPTED"]);
  assert.equal(JSON.stringify(result.body).includes("recipient@gmail.com"),false);
});
