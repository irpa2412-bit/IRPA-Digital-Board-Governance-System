import test from "node:test";
import assert from "node:assert/strict";
import {buildDailyAttendanceSignerAssignments} from "../src/utils/dailyAttendanceSigners.mjs";

test("registered member retains account UID and independent signer ID",()=>{
 const [s]=buildDailyAttendanceSignerAssignments([{participantId:"member-1",participantUid:"auth-1",name:"Registered Member",email:"member@example.test"}],"2026-11-20");
 assert.equal(s.accountUid,"auth-1");assert.equal(s.signerUid,"auth-1");assert.equal(s.identityType,"account");assert.equal(s.signerId,"ATT-2026-11-20-member-1");
});
test("unregistered guest receives a unique email-link identity without an account",()=>{
 const [s]=buildDailyAttendanceSignerAssignments([{participantId:"guest-1",name:"Guest",email:"shared@example.test"}],"2026-11-20");
 assert.equal(s.accountUid,null);assert.equal(s.identityType,"email-link");assert.match(s.signerUid,/^email-link-/);
});
test("three positions sharing one email retain three separate signer IDs and identities",()=>{
 const rows=[1,2,3].map(n=>({participantId:"position-"+n,name:"Guest "+n,email:"shared@example.test"}));
 const signers=buildDailyAttendanceSignerAssignments(rows,"2026-11-20");
 assert.equal(signers.length,3);assert.equal(new Set(signers.map(s=>s.signerId)).size,3);assert.equal(new Set(signers.map(s=>s.signerUid)).size,3);assert.ok(signers.every(s=>s.email==="shared@example.test"));
});
test("same signer ID twice is rejected; email equality alone is not a duplicate",()=>{
 assert.throws(()=>buildDailyAttendanceSignerAssignments([{participantId:"one",signerId:"SAME",name:"One",email:"x@example.test"},{participantId:"two",signerId:"SAME",name:"Two",email:"x@example.test"}],"2026-11-20"),/same signer ID/);
 assert.equal(buildDailyAttendanceSignerAssignments([{participantId:"one",name:"One",email:"x@example.test"},{participantId:"two",name:"Two",email:"x@example.test"}],"2026-11-20").length,2);
});
test("a guest without a participant identity is rejected",()=>{
 assert.throws(()=>buildDailyAttendanceSignerAssignments([{name:"Guest",email:"x@example.test"}],"2026-11-20"),/participant ID/);
});
