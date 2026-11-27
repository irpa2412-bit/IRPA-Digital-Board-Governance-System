import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {readFileSync} from "node:fs";

const app=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");
const portal=await readFile(new URL("../src/pages/PoliciesStrategicPlanPortal.jsx",import.meta.url),"utf8");
const documents=await readFile(new URL("../src/pages/DocumentLifecycleModule.jsx",import.meta.url),"utf8");
const controlledUpload=await readFile(new URL("../src/components/ControlledDocumentUpload.jsx",import.meta.url),"utf8");
const researchPortal=await readFile(new URL("../src/pages/ResearchStatisticsKnowledgePortal.jsx",import.meta.url),"utf8");
const accessPoint=await readFile(new URL("../src/components/PortalDocumentAccessPoint.jsx",import.meta.url),"utf8");

test("Policies and Strategic Plan Portal is registered in the static Portals menu",()=>{
 assert.ok(app.includes('"Documents","Policies and Strategic Plans","Signature Platform"'));
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
 assert.match(portal,/setKind\(event\.target\.value\);setTitle\(""\);setCustomTitle\(""\)/);
});

test("portal uses the controlled lifecycle archive and limits uploads to internal governance records",()=>{
 assert.match(portal,/listLifecycleDocuments\(\)/);
 assert.match(portal,/uploadLifecycleDocument\(/);
 assert.match(portal,/downloadLifecycleDocument\(/);
 assert.match(portal,/documentType:"Policy and Strategic Plan",archiveCategory:"Policies and Strategic Plans",classification:"Confidential"/);
 assert.match(portal,/10\*1024\*1024/);
 assert.match(portal,/Upload does not itself constitute approval or publication/);
 assert.doesNotMatch(portal,/setDoc\(|addDoc\(|collection\(db/);
});

test("Research authority can reach Documents and the Policies and Strategic Plans sub-portal",()=>{
 assert.match(app,/RESEARCH_AUTHORITY_ROLES\.includes\(selected\)\?\["Dashboard","Documents","Policies and Strategic Plans","Research, Statistics and Knowledge"/);
 assert.ok(app.includes('"Documents","Policies and Strategic Plans","Signature Platform"'));
});

test("Documents upload offers a distinct Research Archive type and Research Documents category",()=>{
 assert.match(documents,/"Research Archive"/);
 assert.match(documents,/"Research Documents"/);
 assert.match(documents,/"Research Archive":\["\.pdf"/);
 assert.match(documents,/disabled=\{x==="Research Archive"&&!researchArchiveAccess\}/);
});

test("shared Research Portal upload control exposes Research Archive only to Research-authorised profiles",()=>{
 assert.match(controlledUpload,/"Research Archive": "Research Documents"/);
 assert.match(controlledUpload,/disabled=\{type === "Research Archive" && !allowResearchArchiveUpload\}/);
 assert.match(controlledUpload,/setAllowResearchArchiveUpload\(allowResearchArchiveUploadProp \|\| researchAuthority\)/);
 assert.match(controlledUpload,/setClassification\("Confidential"\)/);
 assert.match(controlledUpload,/documentType === "Research Archive" && value === "Public"/);
 assert.match(documents,/setClassification\("Confidential"\)/);
 assert.match(documents,/x==="Public"&&documentType==="Research Archive"/);
 assert.match(documents,/else if\(\["Research Documents","Policies and Strategic Plans"\]\.includes\(archiveCategory\)\)\{setArchiveCategory\("Administrative Documents"\);\}/);
 assert.match(documents,/setArchiveCategory\("Administrative Documents"\);return r/);
 assert.match(app,/ResearchStatisticsKnowledgePortal profile=\{profile\} employee=\{employee\} admin=\{sessionAdministrator\}/);
 assert.match(researchPortal,/allowResearchArchiveUpload=\{admin\}/);
 assert.match(accessPoint,/allowResearchArchiveUpload=\{allowResearchArchiveUpload\}/);
});


test("Policies and Strategic Plans remains authority-scoped while all active IRPA identities see Meeting Portal",()=>{
 const fieldGate=readFileSync(new URL("../src/FieldEntryDataGate.jsx",import.meta.url),"utf8");
 assert.ok(app.includes('"Documents","Policies and Strategic Plans","Signature Platform"'));
 assert.ok(app.includes('const MEETING_PORTAL_MODULES=["Meetings","Meeting Room","Participants","Resolutions","Voting","Actions","Decisions"]'));
 assert.ok(app.includes('if(!selected)return ["Dashboard","Role Descriptions"]'));
 assert.ok(app.includes('meetingProfileAccess?["Dashboard","Role Descriptions",...MEETING_PORTAL_MODULES]:["Dashboard"]'));
 assert.ok(app.includes('registeredPortalModules=meetingProfileAccess&&!sessionAdministrator&&Boolean(selectedAuthority)'));
 assert.ok(!app.includes("modules=sessionAdministrator?[...ALL_MODULES"));
 assert.ok(fieldGate.includes('if(MEETING_PORTALS.has(name.toLowerCase()))return false;'));
 assert.ok(app.includes('RESEARCH_AUTHORITY_ROLES.includes(selected)?["Dashboard","Documents","Policies and Strategic Plans"'));
 assert.ok(app.includes('Object.entries(NAV).map'));
});

test("Documents offers a dedicated Policy and Strategic Plan archive and defaults it to Confidential",()=>{
 assert.ok(documents.includes('"Policy and Strategic Plan"'));
 assert.ok(documents.includes('"Policies and Strategic Plans"'));
 assert.ok(documents.includes('setArchiveCategory("Policies and Strategic Plans");setClassification("Confidential")'));
});

test("Gateway lifecycle and upload routes accept the dedicated policy archive category",async()=>{
 const lifecycle=await readFile(new URL("../drive-gateway/src/documentLifecycle.mjs",import.meta.url),"utf8");
 const gateway=await readFile(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");
 assert.ok(lifecycle.includes('"Policies and Strategic Plans"'));
 assert.ok((gateway.match(/"Policies and Strategic Plans"/g)||[]).length>=3);
});
