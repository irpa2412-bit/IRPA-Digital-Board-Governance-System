const assert = require("node:assert/strict");
const { ORGANISATION, validPermission, evaluatePolicy } = require("./authorizationPolicy");

assert.equal(validPermission("authorization.permission.grant"), true);
assert.equal(validPermission("not-a-real-permission"), false);

const base={actor:{uid:"u1",active:true},organisation:ORGANISATION,action:"authorization.permission.grant",resource:{},context:{},effectivePermissions:["authorization.permission.grant"]};
assert.equal(evaluatePolicy(base).allow,true);

assert.equal(evaluatePolicy({...base,actor:{uid:"u1",active:false}}).reason,"ACTOR_NOT_ACTIVE");
assert.equal(evaluatePolicy({...base,organisation:"Wrong Organisation"}).reason,"ORGANISATION_BOUNDARY_MISMATCH");
assert.equal(evaluatePolicy({...base,effectivePermissions:[]}).reason,"PERMISSION_DENIED");
assert.equal(evaluatePolicy({...base,action:"not-a-real-permission"}).reason,"PERMISSION_NOT_IN_CONTROLLED_CATALOG");

const sod=evaluatePolicy({
  ...base,
  action:"resolution.approve",
  effectivePermissions:["resolution.approve"],
  resource:{requestedByUid:"u1"}
});
assert.equal(sod.allow,false);
assert.equal(sod.reason,"SEPARATION_OF_DUTIES_VIOLATION");

const signature=evaluatePolicy({
  ...base,
  action:"document.sign",
  effectivePermissions:["document.sign"],
  context:{signatureAuthorityRequired:true,signatureAuthorityVerified:false}
});
assert.equal(signature.allow,false);
assert.equal(signature.reason,"SIGNATURE_AUTHORITY_NOT_VERIFIED");

console.log("Central Authorization policy tests passed.");

const denyReasonTest=evaluatePolicy({actor:{uid:"u2",active:true},organisation:ORGANISATION,action:"signature.sign",effectivePermissions:["signature.sign"],context:{ownerOnly:true},resource:{ownerUid:"u1"}});
assert.equal(denyReasonTest.allow,false);
assert.equal(denyReasonTest.reason,"RESOURCE_OWNER_REQUIRED");

const { PERMISSIONS } = require("./authorizationPolicy");

assert.equal(PERMISSIONS.length, new Set(PERMISSIONS).size, "Permission catalog must contain unique entries.");
assert.equal(PERMISSIONS.includes("authorization.permission.grant"), true);
assert.equal(PERMISSIONS.includes("authorization.permission.revoke"), true);

const unauthenticated=evaluatePolicy({
  organisation:ORGANISATION,
  action:"authorization.permission.grant",
  effectivePermissions:["authorization.permission.grant"]
});
assert.equal(unauthenticated.allow,false);
assert.equal(unauthenticated.reason,"AUTHENTICATION_REQUIRED");

const financeSod=evaluatePolicy({
  actor:{uid:"u1",active:true},
  organisation:ORGANISATION,
  action:"finance.approve",
  effectivePermissions:["finance.approve"],
  resource:{requestedByUid:"u1"}
});
assert.equal(financeSod.allow,false);
assert.equal(financeSod.reason,"SEPARATION_OF_DUTIES_VIOLATION");

const signatureVerified=evaluatePolicy({
  actor:{uid:"u1",active:true},
  organisation:ORGANISATION,
  action:"signature.sign",
  effectivePermissions:["signature.sign"],
  context:{signatureAuthorityRequired:true,signatureAuthorityVerified:true}
});
assert.equal(signatureVerified.allow,true);

const ownerAllowed=evaluatePolicy({
  actor:{uid:"u1",active:true},
  organisation:ORGANISATION,
  action:"document.edit",
  effectivePermissions:["document.edit"],
  context:{ownerOnly:true},
  resource:{ownerUid:"u1",id:"doc-1"}
});
assert.equal(ownerAllowed.allow,true);
assert.equal(ownerAllowed.resourceId,"doc-1");

const whitespacePermission=evaluatePolicy({
  actor:{uid:"u1",active:true},
  organisation:ORGANISATION,
  action:" authorization.permission.grant ",
  effectivePermissions:["authorization.permission.grant"]
});
assert.equal(whitespacePermission.allow,true);

console.log("Authorization policy denial/allow matrix passed.");
const { OPERATIONAL_ROLE_PERMISSIONS } = require("./authorizationPolicy");
for(const [role,permissions] of Object.entries(OPERATIONAL_ROLE_PERMISSIONS)){
  assert.ok(role.trim(), "Operational role names must be non-empty.");
  assert.equal(new Set(permissions).size, permissions.length, `Duplicate permissions for ${role}`);
  for(const permission of permissions) assert.equal(validPermission(permission),true,`Unknown permission for ${role}: ${permission}`);
}
assert.ok(OPERATIONAL_ROLE_PERMISSIONS["Director Finance & Administration"].includes("finance.approve"));
assert.ok(OPERATIONAL_ROLE_PERMISSIONS["Director Human Resources"].includes("member.update"));
assert.ok(OPERATIONAL_ROLE_PERMISSIONS["Programme/Technical Officer"].includes("document.edit"));
assert.ok(OPERATIONAL_ROLE_PERMISSIONS["Executive Director"].includes("resolution.approve"));
console.log("Operational role permission catalogue tests passed.");
const { getOperationalRolePermissions, buildRoleProvisioningPlan } = require("./authorizationPolicy");
assert.deepEqual(getOperationalRolePermissions("Finance Manager"),["finance.view","finance.create","reports.view","document.view"]);
assert.deepEqual(getOperationalRolePermissions("Unknown Role"),[]);
const plan=buildRoleProvisioningPlan({role:"Finance Manager",currentPermissions:["finance.view"]});
assert.deepEqual(plan.additions,["finance.create","reports.view","document.view"]);
assert.deepEqual(plan.removals,[]);
assert.equal(plan.destructiveChanges,false);
assert.equal(plan.requiresExplicitApproval,true);
const unknownPlan=buildRoleProvisioningPlan({role:"Unknown Role",currentPermissions:["finance.view"]});
assert.deepEqual(unknownPlan.additions,[]);
assert.deepEqual(unknownPlan.removals,[]);
console.log("Non-destructive departmental provisioning plan tests passed.");


const { OPERATIONAL_DEPARTMENT_ACCESS, buildDepartmentalProvisioningPlan } = require("./authorizationPolicy");
const departmentPlan=buildDepartmentalProvisioningPlan({
  currentByRole:{
    "Finance Manager":["finance.view"],
    "Director Human Resources":["member.create"]
  }
});
assert.equal(Object.keys(departmentPlan.departments).length,Object.keys(OPERATIONAL_DEPARTMENT_ACCESS).length);
assert.deepEqual(departmentPlan.departments["Finance & Administration"][1].additions,["finance.create","reports.view","document.view"]);
assert.deepEqual(departmentPlan.departments["Human Resources"][0].additions,["member.update","member.remove","reports.view"]);
for(const plans of Object.values(departmentPlan.departments)){
  for(const plan of plans){
    assert.deepEqual(plan.removals,[]);
    assert.equal(plan.destructiveChanges,false);
    assert.equal(plan.requiresExplicitApproval,true);
  }
}
assert.equal(departmentPlan.writesPerformed,false);
console.log("Simultaneous departmental provisioning plan tests passed.");

const { validateInstitutionalRoleRecord } = require("./authorizationPolicy");
assert.equal(validateInstitutionalRoleRecord({status:"Active",role:"Finance Manager",department:"Finance & Administration"}).provisionable,true);
assert.equal(validateInstitutionalRoleRecord({status:"Inactive",role:"Finance Manager",department:"Finance & Administration"}).reason,"INSTITUTIONAL_RECORD_NOT_ACTIVE");
assert.equal(validateInstitutionalRoleRecord({status:"Active",role:"Unknown Role",department:"Finance & Administration"}).provisionable,false);
assert.equal(validateInstitutionalRoleRecord({status:"Active",role:"Finance Manager",department:"Finance & Administration"}).recognisedDepartment,true);
console.log("Institutional role verification tests passed.");
