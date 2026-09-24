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

