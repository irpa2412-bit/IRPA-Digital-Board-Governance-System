const ORGANISATION = "Improvement of Rangeland in Pastoral Areas";

const PERMISSIONS = Object.freeze([
  "authorization.permission.view",
  "authorization.permission.grant",
  "authorization.permission.revoke",
  "authorization.workflow.submit",
  "authorization.workflow.review",
  "authorization.workflow.approve",
  "authorization.workflow.return",
  "authorization.workflow.reject",
  "authorization.workflow.complete",
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
// Proposed operational role catalogue. This is a policy definition only; it does
// not provision Firestore access until each role is explicitly approved and tested.
const OPERATIONAL_ROLE_PERMISSIONS = Object.freeze({
  "Director Internal Oversight": ["authorization.permission.view","authorization.permission.grant","authorization.permission.revoke","resolution.view","reports.view"],
  "Internal Oversight Officer": ["authorization.permission.view","resolution.view","reports.view"],
  "Director Human Resources": ["member.create","member.update","member.remove","reports.view"],
  "HR Manager": ["member.create","member.update","reports.view"],
  "Director Finance & Administration": ["finance.view","finance.create","finance.approve","reports.view","document.view"],
  "Finance Manager": ["finance.view","finance.create","reports.view","document.view"],
  "Programme/Technical Officer": ["meeting.create","meeting.edit","meeting.view","document.create","document.edit","document.view","reports.create","reports.view"],
  "Operations Manager": ["meeting.create","meeting.edit","meeting.view","document.view","reports.create","reports.view"],
  "Executive Director": ["authorization.permission.view","meeting.view","resolution.view","resolution.approve","document.view","document.sign","signature.sign","finance.view","finance.approve","reports.view","reports.create"],
  "Director Livestock": ["document.create","document.edit","document.view","meeting.view","reports.create","reports.view"],
  "Director Environment": ["document.create","document.edit","document.view","meeting.view","reports.create","reports.view"],
  "Director Outreach": ["meeting.view","document.create","document.edit","document.view","reports.create","reports.view"],
  "Director Community Development": ["meeting.view","document.create","document.edit","document.view","reports.create","reports.view"],
  "Field Department": ["meeting.view","document.view","reports.create","reports.view"]
});


function clean(value){ return String(value ?? "").trim(); }

function getOperationalRolePermissions(role){
  const key=clean(role);
  const permissions=OPERATIONAL_ROLE_PERMISSIONS[key];
  return permissions ? [...permissions] : [];
}

function buildRoleProvisioningPlan({role,currentPermissions=[]}={}){
  const requested=getOperationalRolePermissions(role);
  const current=new Set((currentPermissions||[]).map(clean).filter(validPermission));
  const requestedSet=new Set(requested);
  return {
    role:clean(role),
    organisation:ORGANISATION,
    requestedPermissions:requested,
    additions:requested.filter(p=>!current.has(p)),
    removals:[],
    destructiveChanges:false,
    requiresExplicitApproval:true
  };
}

const OPERATIONAL_DEPARTMENT_ACCESS = Object.freeze({
  "Internal Oversight": ["Director Internal Oversight","Internal Oversight Officer"],
  "Human Resources": ["Director Human Resources","HR Manager"],
  "Finance & Administration": ["Director Finance & Administration","Finance Manager"],
  "Programme & Technical": ["Programme/Technical Officer"],
  "Operations": ["Operations Manager"],
  "Executive Management": ["Executive Director"],
  "Livestock": ["Director Livestock"],
  "Environment": ["Director Environment"],
  "Outreach": ["Director Outreach"],
  "Community Development": ["Director Community Development"],
  "Field": ["Field Department"]
});

function validateInstitutionalRoleRecord(record={}){
  const status=clean(record.status||record.employmentStatus);
  const role=clean(record.role);
  const department=clean(record.department);
  return {
    active: status==="Active",
    role,
    department,
    recognisedRole: !!OPERATIONAL_ROLE_PERMISSIONS[role],
    recognisedDepartment: Object.prototype.hasOwnProperty.call(OPERATIONAL_DEPARTMENT_ACCESS,department),
    provisionable: status==="Active" && !!OPERATIONAL_ROLE_PERMISSIONS[role],
    reason: status!=="Active"?"INSTITUTIONAL_RECORD_NOT_ACTIVE":!OPERATIONAL_ROLE_PERMISSIONS[role]?"ROLE_NOT_IN_CONTROLLED_CATALOG":"READY_FOR_EXPLICIT_PROVISIONING"
  };
}

function buildDepartmentalProvisioningPlan({currentByRole={}}={}){
  const departments={};
  for(const [department,roles] of Object.entries(OPERATIONAL_DEPARTMENT_ACCESS)){
    departments[department]=roles.map(role=>buildRoleProvisioningPlan({
      role,
      currentPermissions:Array.isArray(currentByRole?.[role])?currentByRole[role]:[]
    }));
  }
  return {
    organisation:ORGANISATION,
    departments,
    destructiveChanges:false,
    requiresExplicitApproval:true,
    writesPerformed:false
  };
}

const AUTHORIZATION_WORKFLOW_TRANSITIONS = Object.freeze({
  "Draft->Submitted": "authorization.workflow.submit",
  "Submitted->Under Review": "authorization.workflow.review",
  "Submitted->Returned": "authorization.workflow.return",
  "Under Review->Approved": "authorization.workflow.approve",
  "Under Review->Rejected": "authorization.workflow.reject",
  "Under Review->Returned": "authorization.workflow.return",
  "Returned->Submitted": "authorization.workflow.submit",
  "Approved->Completed": "authorization.workflow.complete"
});

function evaluateAuthorizationWorkflowTransition({actor, workflow, nextStatus, effectivePermissions=[]}={}){
  const from=clean(workflow?.status);
  const next=clean(nextStatus);
  const permission=AUTHORIZATION_WORKFLOW_TRANSITIONS[from+"->"+next];
  if(!clean(actor?.uid)) return {allow:false,reason:"AUTHENTICATION_REQUIRED",policyVersion:"1.0"};
  if(actor?.active!==true) return {allow:false,reason:"ACTOR_NOT_ACTIVE",policyVersion:"1.0"};
  if(clean(actor?.organisation||ORGANISATION)!==ORGANISATION) return {allow:false,reason:"ORGANISATION_BOUNDARY_MISMATCH",policyVersion:"1.0"};
  if(!permission) return {allow:false,reason:"WORKFLOW_TRANSITION_NOT_PERMITTED",policyVersion:"1.0"};
  if(!new Set((effectivePermissions||[]).map(clean)).has(permission)) return {allow:false,reason:"PERMISSION_DENIED",policyVersion:"1.0"};
  if(clean(workflow?.workflowType)!=="Authorization" || clean(workflow?.module)!=="Authorization & Approvals")
    return {allow:false,reason:"WORKFLOW_MODULE_MISMATCH",policyVersion:"1.0"};
  if(["Approved","Rejected","Completed"].includes(next) && workflow?.requestedByUid===actor.uid)
    return {allow:false,reason:"SEPARATION_OF_DUTIES_VIOLATION",policyVersion:"1.0"};
  if(next==="Under Review" && workflow?.reviewerUid!==actor.uid) return {allow:false,reason:"NAMED_REVIEWER_REQUIRED",policyVersion:"1.0"};
  if(["Approved","Rejected"].includes(next) && workflow?.approverUid!==actor.uid) return {allow:false,reason:"NAMED_APPROVER_REQUIRED",policyVersion:"1.0"};
  if(next==="Completed" && workflow?.implementerUid!==actor.uid) return {allow:false,reason:"NAMED_IMPLEMENTER_REQUIRED",policyVersion:"1.0"};
  if(next==="Returned" && workflow?.reviewerUid!==actor.uid) return {allow:false,reason:"NAMED_REVIEWER_REQUIRED",policyVersion:"1.0"};
  if(["Rejected","Returned"].includes(next) && !String(workflow?.decisionReason||"").trim())
    return {allow:false,reason:"DECISION_REASON_REQUIRED",policyVersion:"1.0"};
  return {allow:true,reason:"PERMISSION_GRANTED",policyVersion:"1.0",action:permission,from,next};
}

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

module.exports = { ORGANISATION, PERMISSIONS, OPERATIONAL_ROLE_PERMISSIONS, OPERATIONAL_DEPARTMENT_ACCESS, validPermission, getOperationalRolePermissions, buildRoleProvisioningPlan, buildDepartmentalProvisioningPlan, validateInstitutionalRoleRecord, AUTHORIZATION_WORKFLOW_TRANSITIONS, evaluateAuthorizationWorkflowTransition, evaluatePolicy };
