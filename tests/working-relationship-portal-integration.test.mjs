import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const app=read("../src/App.jsx");
const support=read("../src/components/OrganisationalRelationshipSupport.jsx");
const auth=read("../src/pages/AuthorizationWorkflow.jsx");
const links=read("../src/firebase/workflowLinks.js");
const rules=read("../firestore.rules");
test("relationship support is mounted in the shared authenticated shell for all portals",()=>{
 assert.match(app,/OrganisationalRelationshipSupport/);
 assert.match(app,/<OrganisationalRelationshipSupport user=\{user\} profile=\{profile\} employee=\{employee\} isAdmin=\{sessionAdministrator\}/);
 assert.match(support,/OrganisationalWorkingRelationships/);
});
test("authorisation requests can reference only a relationship visible to the authenticated requester",()=>{
 assert.match(auth,/where\("supervisorUid","==",auth\.currentUser\.uid\)/);
 assert.match(auth,/where\("subordinateUid","==",auth\.currentUser\.uid\)/);
 assert.match(auth,/Working Relationship/);
 assert.match(links,/workingRelationshipId/);
 assert.match(rules,/function validAuthorizationRelationshipLink\(\)/);
 assert.match(rules,/validAuthorizationRelationshipLink\(\)/);
});
test("relationship context never provisions portal roles or Firebase claims",()=>{
 assert.match(rules,/permissionsActivated",true\)==false/);
 assert.match(rules,/grantedClaims",\[\]\)==\[\]/);
 assert.match(support,/Authenticated supervisory context/);
 assert.doesNotMatch(support,/setCustomUserClaims|adminClaims|grantRole/);
});
