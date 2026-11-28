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

const portalRegister=JSON.parse(read("../docs/portal-protection/portal-register.json"));
const portalScopes=[
 ["board-members-portal","Board Members Portal"],
 ["communication-and-media-portal","Communication and Media Portal"],
 ["grants-intelligence-and-funding-opportunities-portal","Grants Intelligence and Funding Opportunities Portal"],
 ["invitation-portal","Invitation Portal"],
 ["meeting-portal","Meeting Portal"],
 ["members-and-employees-portal","Members and Employees Portal"],
 ["signature-portal","Signature Portal"]
];
const sharedDependencies=[
 "src/App.jsx",
 "src/components/OrganisationalRelationshipSupport.jsx",
 "firestore.rules",
 "scripts/meeting-portal-fixture-isolation-guard.sh",
 "src/pages/OrganisationalWorkingRelationships.jsx",
 "src/governance/organisationalRelationships.js",
 "src/pages/AuthorizationWorkflow.jsx",
 "src/firebase/authorizationWorkflow.js",
 "src/firebase/workflowLinks.js"
];
test("all seven protected portals register and authorize every shared relationship dependency",()=>{
 const expectedOwners=portalScopes.map(([,name])=>name).sort();
 for(const path of sharedDependencies){
  const entry=portalRegister.shared.find(item=>item.path===path);
  assert.ok(entry,`shared dependency not registered: ${path}`);
  assert.deepEqual([...entry.portals].sort(),expectedOwners,`wrong portal owners for ${path}`);
  for(const [slug] of portalScopes){
   const window=JSON.parse(read(`../docs/portal-protection/windows/${slug}.json`));
   const record=JSON.parse(read(`../docs/portal-protection/records/${slug}.json`));
   assert.ok(window.scope.includes(path),`${slug} repair window omits ${path}`);
   assert.ok(record.activeAmendment?.files?.includes(path),`${slug} Change Record omits ${path}`);
  }
 }
});
