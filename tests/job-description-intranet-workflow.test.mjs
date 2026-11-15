import test from"node:test";
import assert from"node:assert/strict";
import fs from"node:fs";
const page=fs.readFileSync("src/pages/JobDescriptionWorkflowPortal.jsx","utf8");
const app=fs.readFileSync("src/App.jsx","utf8");
const rules=fs.readFileSync("firestore.rules","utf8");
test("Executive Director has a dedicated intranet job-description administration route",()=>{
 assert.match(app,/Job Description Administration/);
 assert.match(app,/selectedAuthority==="Executive Director"/);
 assert.match(page,/RELEASED_TO_ADMINISTRATOR/);
});
test("workflow enforces ED release, Administrator assignment, delegate acknowledgement and ED evidence verification",()=>{
 for(const stage of ["RELEASED_TO_ADMINISTRATOR","ASSIGNED_PENDING_DELEGATE_ACKNOWLEDGEMENT","ACKNOWLEDGED_PENDING_ED_VERIFICATION","VERIFIED_PENDING_SERVER_AUTHORIZATION"])assert.ok(page.includes(stage),stage);
 assert.match(rules,/function jobDescriptionExecutiveDirector\(\)/);
 assert.match(rules,/admin\(\).*RELEASED_TO_ADMINISTRATOR/s);
 assert.match(rules,/assignedUid.*ACKNOWLEDGED_PENDING_ED_VERIFICATION/s);
 assert.match(rules,/jobDescriptionExecutiveDirector\(\).*VERIFIED_PENDING_SERVER_AUTHORIZATION/s);
});
test("Administrator cannot assign reserved governance offices or activate permissions",()=>{
 assert.match(page,/RESERVED_ROLE_IDS/);
 assert.match(rules,/function jobDescriptionReservedRole/);
 assert.match(rules,/permissionsActivated",true\)==false/);
 assert.match(page,/permissionsActivated:false/);
 assert.doesNotMatch(page,/permissionsActivated:true/);
});
test("delegate acknowledgement is scoped to the assigned authenticated identity",()=>{
 assert.match(page,/workflow\.assignedUid!==uid/);
 assert.match(rules,/resource\.data\.get\("assignedUid",""\)==request\.auth\.uid/);
});
test("workflow is intranet-only and does not depend on email delivery or third-party workflow services",()=>{
 assert.match(page,/from"firebase\/firestore"/);
 assert.doesNotMatch(page,/sendEmployeeRegistrationEmail|mailto:|https?:\/\//);
});
test("job descriptions are snapshotted and workflow records are not deletable",()=>{
 assert.match(page,/roleSnapshot:role/);
 assert.match(rules,/allow delete:if false/);
});
