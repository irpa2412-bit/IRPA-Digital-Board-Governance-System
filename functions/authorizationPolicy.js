const ORGANISATION = "Improvement of Rangeland in Pastoral Areas";

const PERMISSIONS = Object.freeze([
  "authorization.permission.view",
  "authorization.permission.grant",
  "authorization.permission.revoke",
  "administrator.create",
  "administrator.remove",
  "member.create",
  "member.update",
  "member.remove",
  "meeting.create",
  "meeting.edit",
  "meeting.view",
  "resolution.view",
  "resolution.approve",
  "document.create",
  "document.edit",
  "document.view",
  "document.sign",
  "voting.cast",
  "voting.close",
  "signature.sign",
  "signature.revoke",
  "finance.view",
  "finance.create",
  "finance.approve",
  "reports.view",
  "reports.create"
]);

const PERMISSION_SET = new Set(PERMISSIONS);

function clean(value){ return String(value ?? "").trim(); }

function validPermission(permission){
  return PERMISSION_SET.has(clean(permission));
}

/**
 * Pure policy decision function.
 * It deliberately has no Firebase dependency so the decision semantics can be
 * tested independently from Firestore and Cloud Functions.
 */
function evaluatePolicy({ actor, organisation, action, resource = {}, context = {}, effectivePermissions = [] } = {}){
  const permission = clean(action);
  if(!clean(actor?.uid)) return {allow:false,reason:"AUTHENTICATION_REQUIRED",policyVersion:"1.0"};
  if(actor?.active !== true) return {allow:false,reason:"ACTOR_NOT_ACTIVE",policyVersion:"1.0"};
  if(clean(organisation) !== ORGANISATION) return {allow:false,reason:"ORGANISATION_BOUNDARY_MISMATCH",policyVersion:"1.0"};
  if(!validPermission(permission)) return {allow:false,reason:"PERMISSION_NOT_IN_CONTROLLED_CATALOG",policyVersion:"1.0"};

  const permissions = new Set((effectivePermissions || []).map(clean).filter(Boolean));
  if(!permissions.has(permission)) return {allow:false,reason:"PERMISSION_DENIED",policyVersion:"1.0"};

  // Separation of duties is explicit and applies before any approval action.
  if(["resolution.approve","finance.approve"].includes(permission)){
    const requesterUid = clean(resource?.requestedByUid || context?.requesterUid);
    if(requesterUid && requesterUid === clean(actor.uid))
      return {allow:false,reason:"SEPARATION_OF_DUTIES_VIOLATION",policyVersion:"1.0"};
  }

  // Signature authority is intentionally not inferred from a generic role.
  if(["document.sign","signature.sign"].includes(permission) && context?.signatureAuthorityRequired === true && context?.signatureAuthorityVerified !== true){
    return {allow:false,reason:"SIGNATURE_AUTHORITY_NOT_VERIFIED",policyVersion:"1.0"};
  }

  // Resource ownership can be required by the calling protected operation.
  if(context?.ownerOnly === true && clean(resource?.ownerUid) !== clean(actor.uid))
    return {allow:false,reason:"RESOURCE_OWNER_REQUIRED",policyVersion:"1.0"};

  return {
    allow:true,
    reason:"PERMISSION_GRANTED",
    policyVersion:"1.0",
    action:permission,
    resourceId:clean(resource?.id || resource?.resourceId || ""),
    context
  };
}

module.exports = { ORGANISATION, PERMISSIONS, validPermission, evaluatePolicy };
