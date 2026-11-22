import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const app=fs.readFileSync(path.join(root,"src","App.jsx"),"utf8");
const rules=fs.readFileSync(path.join(root,"firestore.rules"),"utf8");

test("administrator portal access is not blocked where Firestore admin authority permits access",()=>{
  assert.match(app,/const sessionAdministrator=Boolean\(admin\|\|profile\?\.authorizationType==="administrator"\)/);
  assert.match(app,/const itPortalAccess=sessionAdministrator\|\|IT_ROLES\.includes\(selectedAuthority\);/);
  assert.match(app,/active==="IT Operations"&&itPortalAccess&&<ITOperationsPortal/);
  assert.match(app,/active==="Finance Portfolio"&&\(financePortalAccess\?<FinancePortfolio/);
  assert.match(app,/active==="Procurement"&&\(procurementPortalAccess\?<ProcurementPortal/);
});

test("prescribed Firestore administrator boundary remains the server-side authority",()=>{
  assert.match(rules,/function admin\(\)\{return primaryAdmin\(\)\|\|/);
  assert.match(rules,/function researchAuthority\(\)\{return admin\(\)\|\|/);
  assert.match(rules,/function researchToolAllowed\(tool,studyId,uid\)\{return admin\(\)\|\|/);
  assert.match(rules,/function researchPortalReviewer\(portal\)\{\s*return admin\(\)\|\|/);
});
