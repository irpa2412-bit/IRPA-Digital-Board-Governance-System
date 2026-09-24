const assert=require("node:assert/strict");
const {ORGANISATION,AUTHORIZATION_WORKFLOW_TRANSITIONS,evaluateAuthorizationWorkflowTransition}=require("./authorizationPolicy");

assert.equal(Object.keys(AUTHORIZATION_WORKFLOW_TRANSITIONS).length,8);

const base={actor:{uid:"reviewer",active:true,organisation:ORGANISATION},workflow:{
 workflowType:"Authorization",module:"Authorization & Approvals",status:"Submitted",
 requestedByUid:"requester",reviewerUid:"reviewer",approverUid:"approver",implementerUid:"implementer"
}};

let r=evaluateAuthorizationWorkflowTransition({...base,nextStatus:"Under Review",effectivePermissions:["authorization.workflow.review"]});
assert.equal(r.allow,true);

r=evaluateAuthorizationWorkflowTransition({...base,nextStatus:"Under Review",effectivePermissions:[]});
assert.equal(r.reason,"PERMISSION_DENIED");

r=evaluateAuthorizationWorkflowTransition({...base,actor:{uid:"other",active:true,organisation:ORGANISATION},nextStatus:"Under Review",effectivePermissions:["authorization.workflow.review"]});
assert.equal(r.reason,"NAMED_REVIEWER_REQUIRED");

r=evaluateAuthorizationWorkflowTransition({...base,workflow:{...base.workflow,status:"Under Review"},nextStatus:"Returned",effectivePermissions:["authorization.workflow.return"]});
assert.equal(r.reason,"DECISION_REASON_REQUIRED");

r=evaluateAuthorizationWorkflowTransition({...base,workflow:{...base.workflow,status:"Under Review"},nextStatus:"Returned",effectivePermissions:["authorization.workflow.return"],decisionReason:"Needs correction"});
assert.equal(r.allow,true);

r=evaluateAuthorizationWorkflowTransition({...base,actor:{uid:"approver",active:true,organisation:ORGANISATION},workflow:{...base.workflow,status:"Under Review"},nextStatus:"Approved",effectivePermissions:["authorization.workflow.approve"]});
assert.equal(r.allow,true);

r=evaluateAuthorizationWorkflowTransition({...base,actor:{uid:"requester",active:true,organisation:ORGANISATION},workflow:{...base.workflow,status:"Under Review"},nextStatus:"Approved",effectivePermissions:["authorization.workflow.approve"]});
assert.equal(r.reason,"SEPARATION_OF_DUTIES_VIOLATION");

r=evaluateAuthorizationWorkflowTransition({...base,actor:{uid:"approver",active:true,organisation:ORGANISATION},workflow:{...base.workflow,status:"Under Review"},nextStatus:"Rejected",effectivePermissions:["authorization.workflow.reject"],decisionReason:"Insufficient justification"});
assert.equal(r.allow,true);

r=evaluateAuthorizationWorkflowTransition({...base,actor:{uid:"implementer",active:true,organisation:ORGANISATION},workflow:{...base.workflow,status:"Approved"},nextStatus:"Completed",effectivePermissions:["authorization.workflow.complete"]});
assert.equal(r.allow,true);

r=evaluateAuthorizationWorkflowTransition({...base,nextStatus:"Approved",effectivePermissions:["authorization.workflow.approve"]});
assert.equal(r.reason,"NAMED_APPROVER_REQUIRED");

r=evaluateAuthorizationWorkflowTransition({...base,nextStatus:"Not A Stage",effectivePermissions:["authorization.workflow.review"]});
assert.equal(r.reason,"WORKFLOW_TRANSITION_NOT_PERMITTED");

r=evaluateAuthorizationWorkflowTransition({...base,workflow:{...base.workflow,module:"Voting"},nextStatus:"Under Review",effectivePermissions:["authorization.workflow.review"]});
assert.equal(r.reason,"WORKFLOW_MODULE_MISMATCH");

console.log("AUTHORIZATION_WORKFLOW_POLICY_TEST_OK");
