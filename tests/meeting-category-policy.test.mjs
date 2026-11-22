import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canAccessMeetingCategory,
  canRegisterMeeting,
  canEditMeeting,
  canVoteInMeeting,
  meetingCapabilities,
  resolveMeetingAuthorityForIdentity
} from "../src/firebase/meetingPolicy.js";

const governance = {
  id: "meeting-1",
  meetingCategory: "GOVERNANCE",
  meetingPolicyId: "GOVERNANCE",
  status: "Scheduled",
  initiatorUid: "secretary-1"
};

test("governance category denies an unrelated active staff identity", () => {
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "staff-1", active: true, activeEmployee: true, role: "Staff"
  }), false);
});

test("governance category allows authorised board roles and administrators", () => {
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "board-1", active: true, activeMember: true, isBoardMember: true, role: "Board Member"
  }), true);
  assert.equal(canAccessMeetingCategory(governance, { uid: "admin-1", isAdmin: true }), true);
});

test("general meetings allow active institutional members and employees", () => {
  const general = { meetingCategory: "GENERAL", meetingPolicyId: "GENERAL" };
  assert.equal(canAccessMeetingCategory(general, { active: true, activeMember: true }), true);
  assert.equal(canAccessMeetingCategory(general, { active: true, activeEmployee: true }), true);
});

test("explicitly invited participants can access their meeting regardless of institutional role", () => {
  assert.equal(canAccessMeetingCategory(governance, {
    uid: "external-expert", active: true, role: "External Expert"
  }, { isInvited: true }), true);
});

test("meeting registration requires an active designated institutional role", () => {
  assert.equal(canRegisterMeeting({ active: true, role: "Departmental Director" }), true);
  assert.equal(canRegisterMeeting({ active: false, role: "Departmental Director" }), false);
  assert.equal(canRegisterMeeting({ active: true, role: "Staff" }), false);
  assert.equal(canRegisterMeeting({ isAdmin: true }), true);
});

test("released meeting edits are administrator-only", () => {
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Registered" }, {
    uid: "secretary-1", active: true, role: "Board Secretary"
  }), false);
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Registered" }, { isAdmin: true }), true);
});

test("a designated initiator may edit only an unreleased meeting they initiated", () => {
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Draft" }, {
    uid: "secretary-1", active: true, role: "Board Secretary"
  }), true);
  assert.equal(canEditMeeting({ ...governance, registerStatus: "Draft" }, {
    uid: "another-user", active: true, role: "Board Secretary"
  }), false);
});

test("voting is restricted to active registered board members in governance meetings", () => {
  assert.equal(canVoteInMeeting(governance, {
    active: true, activeMember: true, isBoardMember: true, role: "Board Member"
  }), true);
  assert.equal(canVoteInMeeting(governance, {
    active: true, activeMember: true, role: "Staff"
  }), false);
  assert.equal(canVoteInMeeting({ meetingCategory: "STAFF", meetingPolicyId: "STAFF" }, {
    active: true, activeMember: true, isBoardMember: true, role: "Board Member"
  }), false);
});

test("category capabilities keep voting and resolutions disabled outside governance", () => {
  const staff = meetingCapabilities({ meetingCategory: "STAFF", meetingPolicyId: "STAFF" });
  assert.equal(staff.voting, false);
  assert.equal(staff.resolutions, false);
  assert.equal(staff.facilities.signature, false);
  const governanceCapabilities = meetingCapabilities(governance);
  assert.equal(governanceCapabilities.voting, true);
  assert.equal(governanceCapabilities.resolutions, true);
});

const meetingDataSource = readFileSync(new URL("../src/firebase/data.js", import.meta.url), "utf8");
test("meeting reads use the server-authorized Cloudflare gateway", () => {
  const start = meetingDataSource.indexOf("export async function getAccessibleMeetingRecords");
  const end = meetingDataSource.indexOf("function meetingCreatedAt", start);
  assert.ok(start >= 0 && end > start, "meeting retrieval function must be present");
  const source = meetingDataSource.slice(start, end);
  assert.match(source, /callMeetingGateway\("\/api\/meeting-register\/list"/);
  assert.doesNotMatch(source, /getDocs|collection\(db/);
  assert.match(meetingDataSource, /collectionName===COLLECTIONS\.meetings\)return getAccessibleMeetingRecords\(\)/);
  assert.match(meetingDataSource, /collectionName===COLLECTIONS\.meetings\)\{const result=await callMeetingGateway\("\/api\/meeting-register\/get"/);
});

test("full register authority grants all Meeting Portal screen duties without changing category quorum policy",()=>{
  const identity={uid:"oversight-1",active:true,fullMeetingAccess:true};
  assert.equal(canRegisterMeeting(identity),true);
  assert.equal(canAccessMeetingCategory(governance,identity),true);
  assert.equal(canEditMeeting({...governance,registerStatus:"Registered"},identity),true);
  assert.equal(canVoteInMeeting(governance,identity),true);
  assert.equal(meetingCapabilities({...governance,meetingType:"Board Meeting"}).quorumRequired,true);
});

test("screen grant is derived by the same resolver and does not infer from department text",()=>{
  const grant=resolveMeetingAuthorityForIdentity({uid:"ed"},{employees:[{uid:"ed",status:"Active",role:"Executive Director"}]});
  assert.equal(grant.fullMeetingAccess,true);
  assert.equal(canEditMeeting({...governance,registerStatus:"Registered"},{uid:"ed",active:grant.active,fullMeetingAccess:grant.fullMeetingAccess}),true);
  const noGrant=resolveMeetingAuthorityForIdentity({uid:"staff"},{employees:[{uid:"staff",status:"Active",department:"Executive Director Office"}]});
  assert.equal(noGrant.fullMeetingAccess,false);
});


// Seeded register-resolution cases are kept in the existing Meeting Portal policy suite.

const activeRegister = { status:"Active" };

test("resolves Internal Oversight Director by UID, email, member number and employee number",()=>{
  for (const [identity,record] of [
    [{uid:"u1"},{...activeRegister,uid:"u1",role:"Internal Oversight Director"}],
    [{email:"person@example.test"},{...activeRegister,email:"person@example.test",role:"Director Internal Oversight"}],
    [{memberNumber:"IRPA-MEM-0001"},{...activeRegister,memberNumber:"IRPA-MEM-0001",role:"Internal Oversight Director"}],
    [{employeeNumber:"IRPA-EMP-0001"},{...activeRegister,employeeNumber:"IRPA-EMP-0001",role:"Internal Oversight Director"}]
  ]) {
    const result=resolveMeetingAuthorityForIdentity(identity,{members:[record],employees:[]});
    assert.equal(result.fullMeetingAccess,true);
  }
});

test("resolves Executive Director from employee-only record and preserves multiple registered roles",()=>{
  const result=resolveMeetingAuthorityForIdentity({uid:"ed-uid"},{members:[],employees:[{...activeRegister,uid:"ed-uid",employeeNumber:"IRPA-EMP-0002",roles:["Executive Director","Head of Department","Programme Officer"]}]});
  assert.equal(result.fullMeetingAccess,true);
  assert.deepEqual(result.roles.map(item=>item.role),["Executive Director","Head of Department","Programme Officer"]);
});

test("resolves a head of every department from department-head register references",()=>{
  const departments=["Executive Office","Human Resources","Finance & Administration","Internal Oversight","Programmes","Procurement","Operations","Information Technology","Community Development","Livestock","Environment","Outreach","Field Operations","Research, Statistics and Knowledge Department"];
  for (const [index,department] of departments.entries()) {
    const uid="head-"+index;
    const result=resolveMeetingAuthorityForIdentity({uid},{members:[],employees:[],departments:[{...activeRegister,id:"dept-"+index,name:department,headOfDepartmentUid:uid}]});
    assert.equal(result.fullMeetingAccess,true,department);
    assert.equal(result.roles[0].department,department);
  }
});

test("joins a member record and employee record by shared email and derives active roles across both",()=>{
  const result=resolveMeetingAuthorityForIdentity({uid:"u",email:"shared@example.test"},{members:[{...activeRegister,memberNumber:"IRPA-MEM-0003",email:"shared@example.test",role:"Board Member"}],employees:[{...activeRegister,employeeNumber:"IRPA-EMP-0003",email:"shared@example.test",role:"Executive Director"}]});
  assert.equal(result.fullMeetingAccess,true);
  assert.deepEqual(new Set(result.registers),new Set(["Members","Employees"]));
  assert.equal(result.roles.length,2);
});

test("inactive, revoked, suspended and expired authority entries deny the grant",()=>{
  const records=[
    {...activeRegister,uid:"u",role:"Executive Director",status:"Inactive"},
    {...activeRegister,uid:"u",role:"Executive Director",revoked:true},
    {...activeRegister,uid:"u",role:"Executive Director",status:"Suspended"},
    {...activeRegister,uid:"u",role:"Executive Director",expiresAt:"2020-01-01T00:00:00.000Z"}
  ];
  for(const record of records)assert.equal(resolveMeetingAuthorityForIdentity({uid:"u"},{members:[record]}).fullMeetingAccess,false);
});

test("an active member-only or employee-only person is resolved without requiring the other register",()=>{
  assert.equal(resolveMeetingAuthorityForIdentity({uid:"m"},{members:[{...activeRegister,uid:"m",role:"Member"}],employees:[]}).active,true);
  assert.equal(resolveMeetingAuthorityForIdentity({uid:"e"},{members:[],employees:[{...activeRegister,uid:"e",role:"Employee"}]}).active,true);
});

test("Authorized User Access Categories data is treated as a registered authority source",()=>{
  const result=resolveMeetingAuthorityForIdentity({uid:"u"},{members:[],employees:[],accessCategories:[{...activeRegister,uid:"u",categories:["Executive Director"]}]});
  assert.equal(result.fullMeetingAccess,true);
});

test("department text alone never creates a head-of-department grant",()=>{
  const result=resolveMeetingAuthorityForIdentity({uid:"u"},{members:[],employees:[{...activeRegister,uid:"u",department:"Livestock"}]});
  assert.equal(result.fullMeetingAccess,false);
});

test("resolves register documents whose document IDs are IRPA member or employee numbers",()=>{
  assert.equal(resolveMeetingAuthorityForIdentity({memberNumber:"IRPA-MEM-00991"},{members:[{id:"IRPA-MEM-00991",status:"Active",role:"Executive Director"}]}).fullMeetingAccess,true);
  assert.equal(resolveMeetingAuthorityForIdentity({employeeNumber:"IRPA-EMP-00991"},{employees:[{id:"IRPA-EMP-00991",status:"Active",title:"Internal Oversight Director"}]}).fullMeetingAccess,true);
});

test("revoked or expired nested role assignments do not grant authority",()=>{
  const result=resolveMeetingAuthorityForIdentity({uid:"u"},{members:[{uid:"u",status:"Active",roleAssignments:[{role:"Executive Director",status:"Revoked"},{role:"Head of Department",status:"Expired"}]}]});
  assert.equal(result.fullMeetingAccess,false);
});

test("structured job title and position fields resolve authority without free-text department inference",()=>{
  assert.equal(resolveMeetingAuthorityForIdentity({uid:"ed"},{employees:[{uid:"ed",status:"Active",jobTitle:"Executive Director"}]}).fullMeetingAccess,true);
  assert.equal(resolveMeetingAuthorityForIdentity({uid:"staff"},{employees:[{uid:"staff",status:"Active",department:"Executive Director's Office"}]}).fullMeetingAccess,false);
});

test("accepts canonical and historical Internal Oversight Director titles",()=>{
  for(const role of ["Director of Internal Oversight","Internal Oversight Director","Director of International Oversight","Director Internal Oversight"]){
    const result=resolveMeetingAuthorityForIdentity({uid:"oversight-"+role},{members:[{...activeRegister,uid:"oversight-"+role,role}],employees:[]});
    assert.equal(result.fullMeetingAccess,true,role);
  }
});

test("normalizes repeated whitespace in register role titles",()=>{
  const result=resolveMeetingAuthorityForIdentity({uid:"spacing"},{members:[{...activeRegister,uid:"spacing",role:"Director   of   Internal Oversight"}],employees:[]});
  assert.equal(result.fullMeetingAccess,true);
});

test("missing register status defaults to deny while nested roles inherit an explicitly active parent",()=>{
  assert.equal(resolveMeetingAuthorityForIdentity({uid:"missing"},{employees:[{uid:"missing",role:"Executive Director"}]}).fullMeetingAccess,false);
  assert.equal(resolveMeetingAuthorityForIdentity({uid:"active"},{employees:[{uid:"active",status:"Active",roleAssignments:[{role:"Executive Director"}]}]}).fullMeetingAccess,true);
});

