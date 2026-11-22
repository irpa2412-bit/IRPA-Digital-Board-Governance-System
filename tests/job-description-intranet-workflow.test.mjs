import test from"node:test";
import assert from"node:assert/strict";
import fs from"node:fs";
const page=fs.readFileSync("src/pages/JobDescriptionWorkflowPortal.jsx","utf8");
const app=fs.readFileSync("src/App.jsx","utf8");
const rules=fs.readFileSync("firestore.rules","utf8");
const stagingRules=fs.readFileSync("firestore.staging.rules","utf8");
test("Executive Director has a dedicated intranet job-description administration route",()=>{
 assert.match(app,/Job Description Administration/);
 assert.match(app,/selectedAuthority==="Executive Director"/);
 assert.match(page,/ED_APPROVED_PENDING_ADMIN_DISTRIBUTION/);
});
test("Executive Director alone determines the designated position-holder and approves assignment evidence",()=>{
 assert.match(page,/Executive Director-designated position-holder/);
 assert.match(page,/designatedRecipientUid:target\.uid/);
 assert.match(rules,/jobDescriptionExecutiveDirector\(\).*designatedRecipientUid/s);
 assert.match(rules,/jobDescriptionIdentityActive\(request\.resource\.data\.get\("designatedRecipientUid"/);
});
test("Executive Director selects from active system member and employee registers; Administrator does not load those registers",()=>{
 assert.match(page,/if\(isExecutiveDirector\)\{\s*const \[members,employees\]=await Promise\.all\(\[getDocs\(collection\(db,"members"\)\),getDocs\(collection\(db,"employees"\)\)\]\)/);
 assert.match(page,/activeRecord\(row\)/);
 assert.match(page,/source:"Member"/);
 assert.match(page,/source:"Employee"/);
});
test("Administrator can only distribute the Executive Director-approved record without changing its terms",()=>{
 assert.match(page,/Administrator — Distribution queue/);
 assert.match(page,/distributeRole/);
 assert.doesNotMatch(page,/assignRole|setAssignments|Verified active Member \/ Employee/);
 assert.match(rules,/ED_APPROVED_PENDING_ADMIN_DISTRIBUTION.*RELEASED_TO_DELEGATE/s);
 assert.ok(rules.includes('request.resource.data.get("designatedRecipientUid","")==resource.data.get("designatedRecipientUid","")'));
 assert.ok(rules.includes('request.resource.data.get("roleSnapshot",null)==resource.data.get("roleSnapshot",null)'));
 assert.match(rules,/hasOnly\(\["status","distributedByUid"/);
});
test("Delegate acknowledgement is scoped to the ED-designated authenticated identity",()=>{
 assert.match(page,/workflow\.designatedRecipientUid!==uid/);
 assert.match(rules,/resource\.data\.get\("designatedRecipientUid",""\)==request\.auth\.uid/);
});
test("Executive Director verifies acknowledgement and evidence; permission activation remains denied",()=>{
 assert.match(page,/VERIFIED_PENDING_SERVER_AUTHORIZATION/);
 assert.match(rules,/jobDescriptionExecutiveDirector\(\).*VERIFIED_PENDING_SERVER_AUTHORIZATION/s);
 assert.match(page,/permissionsActivated:false/);
 assert.doesNotMatch(page,/permissionsActivated:true/);
});
test("Production and staging rules enforce the same intranet workflow controls",()=>{
 for(const source of [rules,stagingRules]){
  assert.match(source,/match \/jobDescriptionWorkflows\/{roleId}/);
  assert.match(source,/ED_APPROVED_PENDING_ADMIN_DISTRIBUTION/);
  assert.match(source,/RELEASED_TO_DELEGATE/);
  assert.match(source,/allow delete:if false/);
 }
});
test("workflow is intranet-only and does not depend on external email delivery",()=>{
 assert.match(page,/from"firebase\/firestore"/);
 assert.doesNotMatch(page,/sendEmployeeRegistrationEmail|mailto:/);
});
test("job descriptions are snapshotted and protected from client deletion",()=>{
 assert.match(page,/roleSnapshot:role/);
 assert.match(rules,/allow delete:if false/);
});
