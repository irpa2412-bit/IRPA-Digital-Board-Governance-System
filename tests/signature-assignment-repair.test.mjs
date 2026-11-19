import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFieldAssignments, findDuplicateParticipantGroups, mergeDuplicateParticipants, repairDraftAssignments, relinkOrphanedField } from "../src/utils/signatureAssignmentRepair.mjs";

const participants=[
 {uid:"gloria-a",name:"Gloria Labarani",email:"gloria@example.org",role:"Attendance",roleAssignments:[{role:"Attendance"}]},
 {uid:"gloria-b",name:"Gloria Labarani",email:"GLORIA@example.org",role:"Secretary",roleAssignments:[{role:"Secretary"}]},
 {uid:"abednego",name:"Abednego Daniel Kinasha",email:"abednego@example.org",role:"Participant"}
];
const fields=[
 {fieldId:"attendance-1",type:"Name",page:1,x:12,y:20,width:20,height:5,signerUid:"gloria-a"},
 {fieldId:"attendance-2",type:"Signature",page:2,x:14,y:25,width:18,height:6,signerUid:"gloria-a"},
 {fieldId:"secretary-signature",type:"Signature",page:4,x:30,y:70,width:18,height:6,signerUid:"gloria-b"},
 {fieldId:"abednego-signature",type:"Signature",page:4,x:55,y:70,width:18,height:6,signerUid:"abednego"}
];

test("duplicate participant is detected by exact normalized name and email, not by email alone",()=>{
 const groups=findDuplicateParticipantGroups(participants);
 assert.equal(groups.length,1);
 assert.deepEqual(groups[0].map(p=>p.uid),["gloria-a","gloria-b"]);
 assert.equal(findDuplicateParticipantGroups([{uid:"a",name:"A",email:"same@example.org"},{uid:"b",name:"B",email:"same@example.org"}]).length,0);
});

test("merge duplicate participant keeps the identity with most fields and moves all fields to it",()=>{
 const result=mergeDuplicateParticipants(participants,fields);
 assert.equal(result.recipients.some(p=>p.uid==="gloria-b"),false);
 assert.equal(result.recipients.find(p=>p.uid==="gloria-a").roleAssignments.length,2);
 assert.equal(result.fields.find(f=>f.fieldId==="secretary-signature").signerUid,"gloria-a");
 assert.equal(result.fields.find(f=>f.fieldId==="secretary-signature").roleAssignmentIndex,1);
 assert.equal(result.fields.find(f=>f.fieldId==="secretary-signature").signerEmail,"gloria@example.org");
 assert.equal(result.fields.find(f=>f.fieldId==="attendance-1").signerUid,"gloria-a");
 assert.equal(result.merged.length,1);
});

test("one participant may hold attendance and Secretary roles without becoming a duplicate",()=>{
 const one=[{uid:"same-person",name:"Gloria Labarani",email:"gloria@example.org",roleAssignments:[{role:"Attendance"},{role:"Secretary"}]}];
 const assigned=[{fieldId:"attendance",page:1,signerUid:"same-person"},{fieldId:"secretary",page:4,signerUid:"same-person"}];
 assert.equal(findDuplicateParticipantGroups(one).length,0);
 assert.deepEqual(analyzeFieldAssignments({recipients:one,fields:assigned}).fieldIssues,[]);
});

test("missing signer links are diagnosed and unambiguous name/email snapshots are repaired",()=>{
 const draftFields=[...fields,{fieldId:"legacy-orphan",type:"Signature",page:3,x:20,y:30,width:18,height:6,signerUid:"old-gloria-id",signerName:"Gloria Labarani",signerEmail:"gloria@example.org"}];
 const repaired=repairDraftAssignments({recipients:participants,fields:draftFields});
 assert.equal(repaired.merged.length,1);
 assert.equal(repaired.relinked,1);
 assert.equal(repaired.fields.find(f=>f.fieldId==="legacy-orphan").signerUid,"gloria-a");
 assert.equal(repaired.unresolvedOrphans.length,0);
});

test("orphaned field remains explicitly orphaned when there is no safe identity match and can be re-linked",()=>{
 const orphan={fieldId:"orphan",type:"Signature",page:3,x:10,y:20,width:18,height:6,signerUid:"deleted-id"};
 const diagnosed=analyzeFieldAssignments({recipients:[participants[0]],fields:[orphan]});
 assert.equal(diagnosed.orphanedFields.length,1);
 assert.equal(diagnosed.orphanedFields[0].reason,"signer not in list");
 const linked=relinkOrphanedField([orphan],"orphan","gloria-a",[participants[0]]);
 assert.equal(linked[0].signerUid,"gloria-a");
 assert.equal(linked[0].signerName,"Gloria Labarani");
 assert.equal(linked[0].signerEmail,"gloria@example.org");
});

test("field diagnostics identify no signer, signer not in list, and owner signing off with page and field numbers",()=>{
 const result=analyzeFieldAssignments({
  ownerUid:"owner",ownerSigningEnabled:false,
  recipients:[{uid:"signer",name:"Signer",email:"signer@example.org"}],
  fields:[{fieldId:"f1",page:1,signerUid:""},{fieldId:"f2",page:2,signerUid:"missing"},{fieldId:"f3",page:4,signerUid:"owner"},{fieldId:"f4",page:3,signerUid:"signer"}]
 });
 assert.deepEqual(result.fieldIssues.map(x=>[x.page,x.fieldNumber,x.reason]),[[1,1,"no signer"],[2,2,"signer not in list"],[4,3,"owner signing is off"]]);
});

test("merge and repair preserve coordinates and page references on 0, 90, 180 and 270 degree pages",()=>{
 const rotations=[0,90,180,270];
 const rotated=rotations.map((rotation,index)=>({fieldId:"rot-"+rotation,type:"Signature",page:index+1,x:11+index,y:21+index,width:19,height:7,pageRotation:rotation,signerUid:index%2?"gloria-b":"gloria-a"}));
 const result=mergeDuplicateParticipants(participants,rotated);
 for(const rotation of rotations){
  const before=rotated.find(f=>f.pageRotation===rotation),after=result.fields.find(f=>f.pageRotation===rotation);
  assert.equal(after.page,before.page);assert.equal(after.x,before.x);assert.equal(after.y,before.y);assert.equal(after.width,before.width);assert.equal(after.height,before.height);assert.equal(after.pageRotation,rotation);assert.equal(after.signerUid,"gloria-a");
 }
});

test("participant with no fields is listed for owner repair rather than silently discarded",()=>{
 const result=analyzeFieldAssignments({recipients:[{uid:"empty",name:"Ndang...",email:"n@example.org"}],fields:[]});
 assert.deepEqual(result.recipientsWithoutFields.map(x=>[x.name,x.fieldCount]),[["Ndang...",0]]);
});
