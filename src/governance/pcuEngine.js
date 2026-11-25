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
 for(const e of edges){if(e.tenantId!==tenant)throw new PcuValidationError("Cross-tenant reporting edge rejected","TENANT_MISMATCH");if(!map.has(e.fromNodeId)||!map.has(e.toNodeId))throw new PcuValidationError("Unknown reporting node","UNKNOWN_REPORTING_NODE");}
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
