const clean = v => String(v ?? "").trim();
export class PcuValidationError extends Error { constructor(message, code="PCU_VALIDATION_ERROR"){ super(message); this.name="PcuValidationError"; this.code=code; } }
const validId = (v, field) => { const s=clean(v); if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(s)) throw new PcuValidationError("Invalid "+field,"INVALID_ID"); return s; };
export function validateOrganisation(c){
 if(!c||typeof c!=="object") throw new PcuValidationError("Organisation configuration is required");
 const tenant=validId(c.tenantId,"tenantId"), types=c.nodeTypes||[], nodes=c.nodes||[], edges=c.reportingEdges||[];
 if(!types.length) throw new PcuValidationError("At least one configurable node type is required");
 const typeIds=types.map(x=>validId(x.id,"node type id")); if(new Set(typeIds).size!==typeIds.length) throw new PcuValidationError("Duplicate node type","DUPLICATE_ID");
 const ids=nodes.map(x=>validId(x.id,"node id")); if(new Set(ids).size!==ids.length) throw new PcuValidationError("Duplicate node","DUPLICATE_ID");
 const map=new Map(nodes.map(x=>[x.id,x]));
 for(const n of nodes){if(n.tenantId!==tenant)throw new PcuValidationError("Cross-tenant node rejected","TENANT_MISMATCH");if(!typeIds.includes(n.typeId))throw new PcuValidationError("Unknown node type","UNKNOWN_NODE_TYPE");for(const p of n.parentIds||[])if(!map.has(p))throw new PcuValidationError("Unknown parent","UNKNOWN_PARENT");}
 const state=new Map(); const visit=id=>{if(state.get(id)===1)throw new PcuValidationError("Circular hierarchy","CIRCULAR_HIERARCHY");if(state.get(id)===2)return;state.set(id,1);for(const p of map.get(id).parentIds||[])visit(p);state.set(id,2);}; for(const id of ids)visit(id);
 for(const e of edges){if(e.tenantId!==tenant)throw new PcuValidationError("Cross-tenant reporting edge rejected","TENANT_MISMATCH");if(!map.has(e.fromNodeId)||!map.has(e.toNodeId))throw new PcuValidationError("Unknown reporting node","UNKNOWN_REPORTING_NODE");if(e.fromNodeId===e.toNodeId)throw new PcuValidationError("Self-reporting is not allowed","CIRCULAR_REPORTING");}
 const reportState=new Map();const visitReport=id=>{if(reportState.get(id)===1)throw new PcuValidationError("Circular reporting graph","CIRCULAR_REPORTING");if(reportState.get(id)===2)return;reportState.set(id,1);for(const e of edges.filter(x=>x.fromNodeId===id&&x.active!==false))visitReport(e.toNodeId);reportState.set(id,2);};for(const id of ids)visitReport(id);
 return {tenantId:tenant,nodeTypes:types,nodes,nodeMap:map,reportingEdges:edges};
}
export function resolveApprovalPath({tenantId,fromNodeId,toNodeId,edges=[]}){
 validId(tenantId,"tenantId");const scoped=edges.filter(e=>e.tenantId===tenantId&&e.active!==false),paths=[];
 const walk=(node,path,seen)=>{if(node===toNodeId){paths.push(path);return;}for(const e of scoped.filter(x=>x.fromNodeId===node)){if(!seen.has(e.toNodeId)){const next=new Set(seen);next.add(e.toNodeId);walk(e.toNodeId,[...path,e],next);}}};
 walk(fromNodeId,[],new Set([fromNodeId]));if(paths.length===0)throw new PcuValidationError("No approval path","NO_APPROVAL_PATH");if(paths.length!==1)throw new PcuValidationError("Ambiguous approval path","AMBIGUOUS_APPROVAL_PATH");return paths[0];
}
export function createDutyAssignment(i){
 const tenantId=validId(i?.tenantId,"tenantId"),assigneeType=i.assigneeType;if(!["ORG_NODE","IDENTITY"].includes(assigneeType))throw new PcuValidationError("Invalid assignee type","INVALID_ASSIGNEE");
 const version=Number(i.version||1);if(!Number.isInteger(version)||version<1)throw new PcuValidationError("Invalid assignment version","INVALID_VERSION");
 return Object.freeze({id:validId(i.id,"assignment id"),tenantId,assigneeType,assigneeId:validId(i.assigneeId,"assigneeId"),parentMandateId:i.parentMandateId||null,dutyId:validId(i.dutyId,"dutyId"),version,effectiveFrom:clean(i.effectiveFrom)||null,dueAt:clean(i.dueAt)||null,status:"ASSIGNED",acknowledgement:null,completionEvidence:[],supersedesId:i.supersedesId||null,revokedAt:null,permissionsActivated:false,grantedClaims:[],createdBy:validId(i.createdBy,"createdBy")});
}
export function acknowledgeDuty(a,actorUid,note=""){if(!a||a.status!=="ASSIGNED")throw new PcuValidationError("Duty cannot be acknowledged","INVALID_TRANSITION");if(a.assigneeType!=="IDENTITY"||clean(actorUid)!==a.assigneeId)throw new PcuValidationError("Only assigned identity may acknowledge","ACKNOWLEDGEMENT_FORBIDDEN");return Object.freeze({...a,status:"ACKNOWLEDGED",acknowledgement:Object.freeze({actorUid,note:clean(note),at:new Date().toISOString()}),permissionsActivated:false,grantedClaims:[]});}
export function assertWorkflowActors(a={}){const out={};for(const k of ["initiator","reviewer","recommender","approver","implementer","auditor"])out[k]=clean(a[k])||null;if(out.approver&&out.approver===out.initiator)throw new PcuValidationError("Initiator and approver must differ","SEPARATION_OF_DUTIES");if(out.auditor&&[out.initiator,out.approver,out.implementer].includes(out.auditor))throw new PcuValidationError("Auditor must be independent","SEPARATION_OF_DUTIES");return Object.freeze(out);}

export function createDutyDefinition(input){
 const tenantId=validId(input?.tenantId,"tenantId"),title=clean(input.title),description=clean(input.description);
 if(!title||title.length>180)throw new PcuValidationError("Duty title is required and must be at most 180 characters","INVALID_DUTY_TITLE");
 if(description.length>4000)throw new PcuValidationError("Duty description is too long","INVALID_DUTY_DESCRIPTION");
 const cadence=input.cadence||"AD_HOC";
 if(!["AD_HOC","DAILY","WEEKLY","MONTHLY","QUARTERLY","ANNUALLY"].includes(cadence))throw new PcuValidationError("Unsupported duty cadence","INVALID_CADENCE");
 return Object.freeze({id:validId(input.id,"duty id"),tenantId,title,description,parentMandateId:input.parentMandateId||null,cadence,serviceStandard:clean(input.serviceStandard),performanceIndicators:Array.isArray(input.performanceIndicators)?[...input.performanceIndicators]:[],version:1,status:"ACTIVE",createdBy:validId(input.createdBy,"createdBy")});
}
export function reviseDutyAssignment(previous,input){
 if(!previous||previous.status==="REVOKED")throw new PcuValidationError("Cannot supersede a missing or revoked assignment","INVALID_SUPERSESSION");
 const next=createDutyAssignment({...input,version:previous.version+1,supersedesId:previous.id});
 if(next.tenantId!==previous.tenantId||next.dutyId!==previous.dutyId)throw new PcuValidationError("A revision must remain in the same tenant and duty","INVALID_SUPERSESSION");
 return next;
}
export function revokeDutyAssignment(assignment,actorUid,reason){
 if(!assignment||assignment.status==="REVOKED")throw new PcuValidationError("Assignment is already revoked or missing","INVALID_REVOCATION");
 if(!clean(reason))throw new PcuValidationError("Revocation reason is required","REVOCATION_REASON_REQUIRED");
 return Object.freeze({...assignment,status:"REVOKED",revokedAt:new Date().toISOString(),revokedBy:validId(actorUid,"actorUid"),revocationReason:clean(reason),permissionsActivated:false,grantedClaims:[]});
}
export function createAuditEvent(input){
 return Object.freeze({id:validId(input.id,"audit event id"),tenantId:validId(input.tenantId,"tenantId"),actorUid:validId(input.actorUid,"actorUid"),action:validId(input.action,"audit action"),entityType:validId(input.entityType,"entityType"),entityId:validId(input.entityId,"entityId"),occurredAt:input.occurredAt||new Date().toISOString(),details:Object.freeze({...input.details}),immutable:true});
}


export function createDelegation(input){
 const tenantId=validId(input?.tenantId,"tenantId"),delegatorId=validId(input?.delegatorId,"delegatorId"),delegateId=validId(input?.delegateId,"delegateId");
 if(delegatorId===delegateId)throw new PcuValidationError("A person cannot delegate to themselves","INVALID_DELEGATION");
 const startsAt=new Date(input.startsAt),endsAt=new Date(input.endsAt);
 if(!Number.isFinite(startsAt.getTime())||!Number.isFinite(endsAt.getTime())||endsAt<=startsAt)throw new PcuValidationError("Delegation requires a valid start and later end date","INVALID_DELEGATION_DATES");
 const scopes=[...new Set((input.scopes||[]).map(x=>clean(x)).filter(Boolean))];
 if(!scopes.length)throw new PcuValidationError("Delegation scope must be explicit","EMPTY_DELEGATION_SCOPE");
 return Object.freeze({id:validId(input.id,"delegation id"),tenantId,delegatorId,delegateId,scopes,startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),limits:clean(input.limits),evidenceReference:clean(input.evidenceReference),status:"PENDING_APPROVAL",permissionsActivated:false,grantedClaims:[],createdBy:validId(input.createdBy,"createdBy")});
}
export function validateEscalationPolicy(input){
 const tenantId=validId(input?.tenantId,"tenantId"),levels=input.levels||[];
 if(!levels.length)throw new PcuValidationError("At least one escalation level is required","EMPTY_ESCALATION_POLICY");
 const seen=new Set();
 const normalized=levels.map((x,i)=>{const afterHours=Number(x.afterHours);if(!Number.isFinite(afterHours)||afterHours<0||(i&&afterHours<=Number(levels[i-1].afterHours)))throw new PcuValidationError("Escalation thresholds must increase","INVALID_ESCALATION_ORDER");const actor=validId(x.actor,"escalation actor");if(seen.has(actor))throw new PcuValidationError("Escalation actors must be distinct","DUPLICATE_ESCALATION_ACTOR");seen.add(actor);return Object.freeze({level:i+1,afterHours,actor,action:clean(x.action)||"NOTIFY_AND_REVIEW"});});
 return Object.freeze({id:validId(input.id,"policy id"),tenantId,name:clean(input.name)||"Escalation policy",levels:normalized,enabled:input.enabled!==false,createdBy:validId(input.createdBy,"createdBy"),version:Number(input.version||1)});
}
export function getEscalationTarget(policy,elapsedHours){
 if(!policy?.enabled)return null;
 const eligible=(policy.levels||[]).filter(x=>Number(elapsedHours)>=x.afterHours);
 return eligible.length?eligible[eligible.length-1]:null;
}
export function validateApprovalWorkflow(input){
 const tenantId=validId(input?.tenantId,"tenantId"),name=clean(input.name),steps=input.steps||[];
 if(!name||!steps.length)throw new PcuValidationError("Workflow name and at least one step are required","INVALID_WORKFLOW");
 const ids=new Set();
 const normalized=steps.map((s,i)=>{const id=validId(s.id||"step-"+(i+1),"step id");if(ids.has(id))throw new PcuValidationError("Duplicate workflow step","DUPLICATE_WORKFLOW_STEP");ids.add(id);const actorType=s.actorType||"IDENTITY";if(!["IDENTITY","ORG_NODE","ROLE"].includes(actorType))throw new PcuValidationError("Invalid workflow actor type","INVALID_WORKFLOW_ACTOR");return Object.freeze({id,order:i+1,label:clean(s.label)||"Step "+(i+1),actorType,actorId:validId(s.actorId,"workflow actor"),action:s.action||"APPROVE",required:s.required!==false});});
 const actorIds=normalized.map(x=>x.actorId);
 if(new Set(actorIds).size!==actorIds.length)throw new PcuValidationError("Approval actors must be distinct","SEPARATION_OF_DUTIES");
 return Object.freeze({id:validId(input.id,"workflow id"),tenantId,name,description:clean(input.description),steps:normalized,status:"ACTIVE",version:Number(input.version||1),createdBy:validId(input.createdBy,"createdBy")});
}
export function advanceApprovalWorkflow(instance,actorId,decision,note=""){
 if(!instance||instance.status!=="PENDING")throw new PcuValidationError("Workflow instance is not pending","INVALID_WORKFLOW_STATE");
 const step=instance.steps?.[instance.currentStep||0];
 if(!step||step.actorId!==clean(actorId))throw new PcuValidationError("Actor is not assigned to the current approval step","WORKFLOW_ACTOR_FORBIDDEN");
 if(!["APPROVE","REJECT","RETURN"].includes(decision))throw new PcuValidationError("Invalid workflow decision","INVALID_WORKFLOW_DECISION");
 const history=[...(instance.history||[]),Object.freeze({stepId:step.id,actorId:clean(actorId),decision,note:clean(note),at:new Date().toISOString()})];
 if(decision!=="APPROVE")return Object.freeze({...instance,status:decision==="REJECT"?"REJECTED":"RETURNED",history});
 const next=(instance.currentStep||0)+1;
 return Object.freeze({...instance,currentStep:next,status:next>=instance.steps.length?"APPROVED":"PENDING",history});
}
export function summarizePcuPerformance({assignments=[],workflows=[],now=Date.now()}={}){
 const active=assignments.filter(x=>x.status!=="REVOKED"),completed=active.filter(x=>x.status==="COMPLETED"),due=active.filter(x=>x.dueAt&&new Date(x.dueAt).getTime()<now&&x.status!=="COMPLETED");
 const decided=workflows.filter(x=>["APPROVED","REJECTED"].includes(x.status));
 const avgCycle=decided.length?decided.reduce((sum,x)=>sum+Math.max(0,new Date(x.completedAt||x.updatedAt||now).getTime()-new Date(x.createdAt||now).getTime()),0)/decided.length:0;
 return Object.freeze({totalAssignments:active.length,completed:completed.length,completionRate:active.length?completed.length/active.length:0,overdue:due.length,acknowledged:active.filter(x=>x.status==="ACKNOWLEDGED").length,pending:active.filter(x=>["ASSIGNED","ACKNOWLEDGED"].includes(x.status)).length,workflowTotal:workflows.length,workflowPending:workflows.filter(x=>x.status==="PENDING").length,workflowApproved:workflows.filter(x=>x.status==="APPROVED").length,workflowRejected:workflows.filter(x=>x.status==="REJECTED").length,averageDecisionCycleMs:avgCycle});
}
export function summarizePcuAudit(events=[]){
 const byAction={};for(const e of events){const key=clean(e.action)||"UNKNOWN";byAction[key]=(byAction[key]||0)+1;}
 return Object.freeze({total:events.length,byAction:Object.freeze(byAction),actors:new Set(events.map(x=>x.actorUid).filter(Boolean)).size,latest:[...events].sort((a,b)=>new Date(b.occurredAt||0)-new Date(a.occurredAt||0)).slice(0,25)});
}


export function createReportingRelationship(input){
 const tenantId=validId(input?.tenantId,"tenantId"),supervisorNodeId=validId(input?.supervisorNodeId,"supervisorNodeId"),subordinateNodeId=validId(input?.subordinateNodeId,"subordinateNodeId"),supervisorUid=validId(input?.supervisorUid,"supervisorUid"),subordinateUid=validId(input?.subordinateUid,"subordinateUid");
 if(supervisorNodeId===subordinateNodeId||supervisorUid===subordinateUid)throw new PcuValidationError("A reporting relationship must connect distinct positions and identities","INVALID_REPORTING_RELATIONSHIP");
 const effectiveFrom=new Date(input.effectiveFrom),effectiveTo=input.effectiveTo?new Date(input.effectiveTo):null;
 if(!Number.isFinite(effectiveFrom.getTime())||(effectiveTo&&(!Number.isFinite(effectiveTo.getTime())||effectiveTo<=effectiveFrom)))throw new PcuValidationError("Reporting relationship dates are invalid","INVALID_REPORTING_DATES");
 const evidenceReference=clean(input.evidenceReference);if(!evidenceReference)throw new PcuValidationError("Approved appointment or delegation evidence is required","REPORTING_EVIDENCE_REQUIRED");
 return Object.freeze({id:validId(input.id,"relationship id"),tenantId,supervisorNodeId,subordinateNodeId,supervisorUid,subordinateUid,effectiveFrom:effectiveFrom.toISOString(),effectiveTo:effectiveTo?.toISOString()||null,evidenceReference,status:"PENDING_VERIFICATION",createdBy:validId(input.createdBy,"createdBy"),permissionsActivated:false,grantedClaims:[]});
}
export function createResponsibilityReport(input){
 const tenantId=validId(input?.tenantId,"tenantId"),assignmentId=validId(input.assignmentId,"assignmentId"),assigneeUid=validId(input.assigneeUid,"assigneeUid"),supervisorUid=validId(input.supervisorUid,"supervisorUid"),summary=clean(input.summary);
 if(assigneeUid===supervisorUid)throw new PcuValidationError("A report author cannot review their own report","REPORT_SELF_REVIEW");
 if(!summary||summary.length>10000)throw new PcuValidationError("A report summary is required and must be at most 10000 characters","INVALID_REPORT_SUMMARY");
 const periodStart=new Date(input.periodStart),periodEnd=new Date(input.periodEnd);
 if(!Number.isFinite(periodStart.getTime())||!Number.isFinite(periodEnd.getTime())||periodEnd<periodStart)throw new PcuValidationError("Report period is invalid","INVALID_REPORT_PERIOD");
 const evidenceReferences=[...new Set((input.evidenceReferences||[]).map(clean).filter(Boolean))];
 return Object.freeze({id:validId(input.id,"report id"),tenantId,assignmentId,assigneeUid,supervisorUid,periodStart:periodStart.toISOString(),periodEnd:periodEnd.toISOString(),summary,outputs:clean(input.outputs),blockers:clean(input.blockers),evidenceReferences,status:"SUBMITTED",submittedAt:clean(input.submittedAt)||new Date().toISOString(),review:null,permissionsActivated:false,grantedClaims:[]});
}
export function reviewResponsibilityReport(report,actorUid,decision,note=""){
 if(!report||report.status!=="SUBMITTED")throw new PcuValidationError("Only submitted reports can be reviewed","INVALID_REPORT_STATE");
 if(clean(actorUid)!==report.supervisorUid)throw new PcuValidationError("Only the assigned supervisor may review this report","REPORT_REVIEW_FORBIDDEN");
 if(!["ACCEPTED","RETURNED","REJECTED"].includes(decision))throw new PcuValidationError("Invalid report review decision","INVALID_REPORT_DECISION");
 if(!clean(note)&&decision!=="ACCEPTED")throw new PcuValidationError("A reason is required when returning or rejecting a report","REPORT_REVIEW_NOTE_REQUIRED");
 return Object.freeze({...report,status:decision,review:Object.freeze({actorUid:clean(actorUid),decision,note:clean(note),reviewedAt:new Date().toISOString()}),permissionsActivated:false,grantedClaims:[]});
}
