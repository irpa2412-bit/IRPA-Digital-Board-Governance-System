const clean=v=>String(v??"").trim();
const id=v=>{const s=clean(v);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(s))throw Object.assign(new Error("Invalid identifier"),{code:"INVALID_ID"});return s;};
export function createWorkingRelationship(x){
 const supervisorUid=id(x.supervisorUid),subordinateUid=id(x.subordinateUid);
 if(supervisorUid===subordinateUid)throw Object.assign(new Error("Supervisor and subordinate must be different people"),{code:"SELF_REPORTING"});
 const label=clean(x.relationshipLabel),scope=clean(x.scope),starts=new Date(x.effectiveFrom),ends=x.effectiveTo?new Date(x.effectiveTo):null;
 if(!label||label.length>160||!scope||scope.length>3000)throw Object.assign(new Error("A relationship title and scope are required"),{code:"INVALID_RELATIONSHIP"});
 if(!Number.isFinite(starts.getTime())||(ends&&(!Number.isFinite(ends.getTime())||ends<=starts)))throw Object.assign(new Error("Invalid effective dates"),{code:"INVALID_DATES"});
 return Object.freeze({id:id(x.id),supervisorUid,supervisorProfileId:id(x.supervisorProfileId||supervisorUid),supervisorCollection:["members","employees"].includes(x.supervisorCollection)?x.supervisorCollection:"employees",supervisorName:clean(x.supervisorName),subordinateUid,subordinateProfileId:id(x.subordinateProfileId||subordinateUid),subordinateCollection:["members","employees"].includes(x.subordinateCollection)?x.subordinateCollection:"employees",subordinateName:clean(x.subordinateName),relationshipLabel:label,scope,effectiveFrom:starts.toISOString().slice(0,10),effectiveTo:ends?ends.toISOString().slice(0,10):null,status:"ACTIVE",createdByUid:id(x.createdByUid),permissionsActivated:false,grantedClaims:[]});
}
export function createResponsibility(x){
 const relationshipId=id(x.relationshipId),supervisorUid=id(x.supervisorUid),assigneeUid=id(x.assigneeUid),title=clean(x.title),description=clean(x.description),dueDate=clean(x.dueDate);
 if(supervisorUid===assigneeUid)throw Object.assign(new Error("A person cannot assign work to themselves as their own supervisor"),{code:"SELF_ASSIGNMENT"});
 if(!title||title.length>180||!description||description.length>5000)throw Object.assign(new Error("Title and description are required"),{code:"INVALID_RESPONSIBILITY"});
 if(dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))throw Object.assign(new Error("Invalid due date"),{code:"INVALID_DUE_DATE"});
 return Object.freeze({id:id(x.id),relationshipId,supervisorUid,supervisorProfileId:id(x.supervisorProfileId||supervisorUid),supervisorCollection:["members","employees"].includes(x.supervisorCollection)?x.supervisorCollection:"employees",assigneeUid,assigneeProfileId:id(x.assigneeProfileId||assigneeUid),assigneeCollection:["members","employees"].includes(x.assigneeCollection)?x.assigneeCollection:"employees",title,description,dueDate:dueDate||null,cadence:clean(x.cadence)||"AD_HOC",status:"ASSIGNED",createdByUid:supervisorUid,permissionsActivated:false,grantedClaims:[]});
}
export function createResponsibilityReport(x){
 const summary=clean(x.summary);if(!summary||summary.length>10000)throw Object.assign(new Error("Report summary is required"),{code:"INVALID_REPORT"});
 const start=new Date(x.periodStart),end=new Date(x.periodEnd);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<start)throw Object.assign(new Error("Invalid report period"),{code:"INVALID_PERIOD"});
 return Object.freeze({id:id(x.id),responsibilityId:id(x.responsibilityId),relationshipId:id(x.relationshipId),supervisorUid:id(x.supervisorUid),supervisorProfileId:id(x.supervisorProfileId||x.supervisorUid),supervisorCollection:["members","employees"].includes(x.supervisorCollection)?x.supervisorCollection:"employees",assigneeUid:id(x.assigneeUid),assigneeProfileId:id(x.assigneeProfileId||x.assigneeUid),assigneeCollection:["members","employees"].includes(x.assigneeCollection)?x.assigneeCollection:"employees",periodStart:start.toISOString().slice(0,10),periodEnd:end.toISOString().slice(0,10),summary,outputs:clean(x.outputs),blockers:clean(x.blockers),status:"SUBMITTED",submittedByUid:id(x.assigneeUid),permissionsActivated:false,grantedClaims:[]});
}
export function reviewResponsibilityReport(report,actorUid,decision,note=""){
 if(report?.status!=="SUBMITTED")throw Object.assign(new Error("Only submitted reports can be reviewed"),{code:"INVALID_STATE"});
 if(clean(actorUid)!==report.supervisorUid)throw Object.assign(new Error("Only the named supervisor may review this report"),{code:"REVIEW_FORBIDDEN"});
 if(!["ACCEPTED","RETURNED","REJECTED"].includes(decision))throw Object.assign(new Error("Invalid review decision"),{code:"INVALID_DECISION"});
 if(decision!=="ACCEPTED"&&!clean(note))throw Object.assign(new Error("A reason is required"),{code:"REVIEW_NOTE_REQUIRED"});
 return Object.freeze({...report,status:decision,review:{actorUid:clean(actorUid),decision,note:clean(note)},permissionsActivated:false,grantedClaims:[]});
}
