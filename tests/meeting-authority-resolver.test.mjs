import test from "node:test";
import assert from "node:assert/strict";
import { resolveMeetingAuthority } from "../shared/meetingAuthority.mjs";

const active = { status:"Active" };

test("resolves Internal Oversight Director by UID, email, member number and employee number",()=>{
  for (const [identity,record] of [
    [{uid:"u1"},{...active,uid:"u1",role:"Internal Oversight Director"}],
    [{email:"person@example.test"},{...active,email:"person@example.test",role:"Director Internal Oversight"}],
    [{memberNumber:"IRPA-MEM-0001"},{...active,memberNumber:"IRPA-MEM-0001",role:"Internal Oversight Director"}],
    [{employeeNumber:"IRPA-EMP-0001"},{...active,employeeNumber:"IRPA-EMP-0001",role:"Internal Oversight Director"}]
  ]) {
    const result=resolveMeetingAuthority(identity,{members:[record],employees:[]});
    assert.equal(result.fullMeetingAccess,true);
  }
});

test("resolves Executive Director from employee-only record and preserves multiple registered roles",()=>{
  const result=resolveMeetingAuthority({uid:"ed-uid"},{members:[],employees:[{...active,uid:"ed-uid",employeeNumber:"IRPA-EMP-0002",roles:["Executive Director","Head of Department","Programme Officer"]}]});
  assert.equal(result.fullMeetingAccess,true);
  assert.deepEqual(result.roles.map(item=>item.role),["Executive Director","Head of Department","Programme Officer"]);
});

test("resolves a head of every department from department-head register references",()=>{
  const departments=["Executive Office","Human Resources","Finance & Administration","Internal Oversight","Programmes","Procurement","Operations","Information Technology","Community Development","Livestock","Environment","Outreach","Field Operations","Research, Statistics and Knowledge Department"];
  for (const [index,department] of departments.entries()) {
    const uid="head-"+index;
    const result=resolveMeetingAuthority({uid},{members:[],employees:[],departments:[{...active,id:"dept-"+index,name:department,headOfDepartmentUid:uid}]});
    assert.equal(result.fullMeetingAccess,true,department);
    assert.equal(result.roles[0].department,department);
  }
});

test("joins a member record and employee record by shared email and derives active roles across both",()=>{
  const result=resolveMeetingAuthority({uid:"u",email:"shared@example.test"},{members:[{...active,memberNumber:"IRPA-MEM-0003",email:"shared@example.test",role:"Board Member"}],employees:[{...active,employeeNumber:"IRPA-EMP-0003",email:"shared@example.test",role:"Executive Director"}]});
  assert.equal(result.fullMeetingAccess,true);
  assert.deepEqual(new Set(result.registers),new Set(["Members","Employees"]));
  assert.equal(result.roles.length,2);
});

test("inactive, revoked, suspended and expired authority entries deny the grant",()=>{
  const records=[
    {...active,uid:"u",role:"Executive Director",status:"Inactive"},
    {...active,uid:"u",role:"Executive Director",revoked:true},
    {...active,uid:"u",role:"Executive Director",status:"Suspended"},
    {...active,uid:"u",role:"Executive Director",expiresAt:"2020-01-01T00:00:00.000Z"}
  ];
  for(const record of records)assert.equal(resolveMeetingAuthority({uid:"u"},{members:[record]}).fullMeetingAccess,false);
});

test("an active member-only or employee-only person is resolved without requiring the other register",()=>{
  assert.equal(resolveMeetingAuthority({uid:"m"},{members:[{...active,uid:"m",role:"Member"}],employees:[]}).active,true);
  assert.equal(resolveMeetingAuthority({uid:"e"},{members:[],employees:[{...active,uid:"e",role:"Employee"}]}).active,true);
});

test("Authorized User Access Categories data is treated as a registered authority source",()=>{
  const result=resolveMeetingAuthority({uid:"u"},{members:[],employees:[],accessCategories:[{...active,uid:"u",categories:["Executive Director"]}]});
  assert.equal(result.fullMeetingAccess,true);
});

test("department text alone never creates a head-of-department grant",()=>{
  const result=resolveMeetingAuthority({uid:"u"},{members:[],employees:[{...active,uid:"u",department:"Livestock"}]});
  assert.equal(result.fullMeetingAccess,false);
});

test("resolves register documents whose document IDs are IRPA member or employee numbers",()=>{
  assert.equal(resolveMeetingAuthority({memberNumber:"IRPA-MEM-00991"},{members:[{id:"IRPA-MEM-00991",status:"Active",role:"Executive Director"}]}).fullMeetingAccess,true);
  assert.equal(resolveMeetingAuthority({employeeNumber:"IRPA-EMP-00991"},{employees:[{id:"IRPA-EMP-00991",status:"Active",title:"Internal Oversight Director"}]}).fullMeetingAccess,true);
});

test("revoked or expired nested role assignments do not grant authority",()=>{
  const result=resolveMeetingAuthority({uid:"u"},{members:[{uid:"u",status:"Active",roleAssignments:[{role:"Executive Director",status:"Revoked"},{role:"Head of Department",status:"Expired"}]}]});
  assert.equal(result.fullMeetingAccess,false);
});

test("structured job title and position fields resolve authority without free-text department inference",()=>{
  assert.equal(resolveMeetingAuthority({uid:"ed"},{employees:[{uid:"ed",status:"Active",jobTitle:"Executive Director"}]}).fullMeetingAccess,true);
  assert.equal(resolveMeetingAuthority({uid:"staff"},{employees:[{uid:"staff",status:"Active",department:"Executive Director's Office"}]}).fullMeetingAccess,false);
});
