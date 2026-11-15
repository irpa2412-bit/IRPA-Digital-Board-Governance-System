import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const app=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");
const portal=await readFile(new URL("../src/pages/PoliciesStrategicPlanPortal.jsx",import.meta.url),"utf8");

test("Policies and Strategic Plan Portal is registered as a Documents sub-portal",()=>{
 assert.match(app,/\["Documents",\[[^\]]*"Policies and Strategic Plans"\]\]/);
 assert.match(app,/const BASE_MEMBER_MODULES=\[[^\]]*"Policies and Strategic Plans"[^\]]*\]/);
 assert.match(app,/active==="Policies and Strategic Plans"&&<React\.Suspense/);
 assert.match(app,/Policies and Strategic Plans":"Policies and Strategic Plan Portal"/);
});

test("portal contains the complete mandatory policy register",()=>{
 const required=[
  "IRPA Constitution","Procurement Policy","Staff Rules and Regulations","Code of Conduct",
  "Safeguarding Policy","Anti-Corruption and Anti-Fraud Policy","Ethics Policy",
  "Financial Management and Accounting Policy","Human Resources and Personnel Management Policy",
  "Conflict of Interest Policy","Whistleblowing and Complaints Handling Policy",
  "Information Security, Data Protection and Privacy Policy","Records Management and Document Retention Policy",
  "Monitoring, Evaluation, Accountability and Learning (MEAL) Policy",
  "Risk Management and Internal Controls Policy","Gender Equality, Inclusion and Non-Discrimination Policy"
 ];
 for(const name of required)assert.ok(portal.includes(JSON.stringify(name)),`Missing mandatory policy: ${name}`);
});

test("upload form offers named dropdown selections for policies and strategic plans",()=>{
 assert.match(portal,/<select id="irpa-policy-title"/);
 assert.match(portal,/(kind==="Policy"\?MANDATORY_POLICIES:STRATEGIC_PLAN_OPTIONS)/);
 assert.match(portal,/const STRATEGIC_PLAN_OPTIONS=/);
 assert.match(portal,/Other — enter a different title/);
 assert.match(portal,/Enter document name/);
 assert.match(portal,/setKind\(event\.target\.value\);setTitle\(" "\)/);
});

test("portal uses the controlled lifecycle archive and limits uploads to internal governance records",()=>{
 assert.match(portal,/listLifecycleDocuments\(\)/);
 assert.match(portal,/uploadLifecycleDocument\(/);
 assert.match(portal,/downloadLifecycleDocument\(/);
 assert.match(portal,/archiveCategory:"Governance Documents",classification:"Internal"/);
 assert.match(portal,/10\*1024\*1024/);
 assert.match(portal,/Upload does not itself constitute approval or publication/);
 assert.doesNotMatch(portal,/setDoc\(|addDoc\(|collection\(db/);
});
