import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const model=JSON.parse(fs.readFileSync("config/pcu/irpa-operating-model.seed.json","utf8"));
const authority=JSON.parse(fs.readFileSync("config/org-structure-authority.json","utf8"));
const manager=fs.readFileSync("src/pages/PcuMandateJobDescriptionManager.jsx","utf8");
const pcu=fs.readFileSync("src/pages/PortalsControlUnit.jsx","utf8");
const productionRules=fs.readFileSync("firestore.rules","utf8");
const stagingRules=fs.readFileSync("firestore.staging.rules","utf8");

test("PCU baseline covers the complete canonical hierarchy and central office",()=>{
 const expectedDepartments=authority.directorates.reduce((n,d)=>n+d.departments.length,0)+authority.centralOffice.departments.length;
 const expectedUnits=authority.directorates.reduce((n,d)=>n+d.departments.reduce((m,x)=>m+x.units.length,0),0)+authority.centralOffice.departments.reduce((n,d)=>n+d.units.length,0);
 assert.equal(model.mandates.filter(x=>x.level==="DIRECTORATE").length,authority.directorates.length);
 assert.equal(model.mandates.filter(x=>x.level==="DEPARTMENT").length,expectedDepartments);
 assert.equal(model.mandates.filter(x=>x.level==="UNIT").length,expectedUnits);
 assert.equal(model.mandates.filter(x=>x.level==="CENTRAL_OFFICE").length,1);
 assert.equal(model.jobDescriptions.length,authority.roles.length);
});

test("every mandate has a parent-aware mandate, responsibilities and five operating cycles",()=>{
 for(const item of model.mandates){
  assert.ok(item.id&&item.name&&item.mandate,item.id);
  assert.ok(Array.isArray(item.responsibilities)&&item.responsibilities.length,item.id);
  for(const cycle of ["DAILY","WEEKLY","MONTHLY","QUARTERLY","ANNUALLY"])
   assert.ok(Array.isArray(item.operatingRhythm[cycle])&&item.operatingRhythm[cycle].length,item.id+" "+cycle);
 }
});

test("every job description retains canonical role details and adds a complete operating rhythm",()=>{
 for(const role of authority.roles){
  const jd=model.jobDescriptions.find(x=>x.positionId===role.id);
  assert.ok(jd,"missing "+role.id);
  assert.equal(jd.title,role.title);
  assert.equal(jd.reportingLine,role.reportingLine);
  assert.equal(jd.purpose,role.purpose);
  for(const key of ["dailyActions","weeklyActions","monthlyActions","quarterlyActions","annualActions"])
   assert.ok(Array.isArray(jd[key])&&jd[key].length,role.id+" "+key);
  assert.match(jd.authorityBoundary,/not an appointment/i);
  assert.equal(jd.status,"DRAFT_FOR_EXECUTIVE_DIRECTOR_REVIEW");
 });

test("PCU exposes additive import and custom entry creation without overwriting existing records",()=>{
 assert.match(pcu,/PcuMandateJobDescriptionManager/);
 assert.match(manager,/if\(snap\.exists\(\)\)\{existingMandates\+\+;continue;\}/);
 assert.match(manager,/if\(snap\.exists\(\)\)\{existingDescriptions\+\+;continue;\}/);
 assert.match(manager,/Add an additional entry/);
 assert.match(manager,/never replaced|never overwritten/i);
});

test("PCU Firestore rules constrain new records to tenant admins and keep privileges disabled",()=>{
 for(const rules of [productionRules,stagingRules]){
  assert.match(rules,/collectionName=="mandates"/);
  assert.match(rules,/collectionName=="jobDescriptions"/);
  assert.match(rules,/permissionsActivated",true\)==false/);
  assert.match(rules,/actualCreateAllowed\(\)/);
  assert.match(rules,/allow delete:if false/);
 }
});

test("model keeps additional entries enabled without changing access-control policy",()=>{
 assert.equal(model.extensionPolicy.allowAdditionalDirectorates,true);
 assert.equal(model.extensionPolicy.allowAdditionalDepartments,true);
 assert.equal(model.extensionPolicy.allowAdditionalUnits,true);
 assert.equal(model.extensionPolicy.allowAdditionalPositions,true);
 assert.equal(model.extensionPolicy.neverOverwriteExistingRecords,true);
 assert.equal(model.extensionPolicy.permissionActivation,false);
 assert.equal(model.reportingCalendar.timezone,"Africa/Dar_es_Salaam");
});
