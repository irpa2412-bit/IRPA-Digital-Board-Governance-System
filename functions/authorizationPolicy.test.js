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
