import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Procurement workflow mutations use Cloudflare without client-side Firestore write fallbacks", async () => {
  const source=await readFile(new URL("../src/firebase/procurement.js",import.meta.url),"utf8");
  for(const name of ["createProcurementVendor","createProcurementRequest","registerProcurementPR","reviewProcurementRequest","authorizeProcurementRequest","generateProcurementPO","submitVendorPerformanceScore","uploadProcurementQuotation","uploadProcurementEvidence","verifyProcurementEvidence","sendProcurementToFinance","refreshVendorRestriction"]){
    const start=source.indexOf("export async function "+name+"(");
    const end=source.indexOf("\nexport async function ",start+1);
    assert.notEqual(start,-1,"Missing "+name);
    const fn=source.slice(start,end<0?source.length:end);
    assert.match(fn,/procurementApi\(/,"Missing Cloudflare API call in "+name);
    assert.doesNotMatch(fn,/\b(runTransaction|setDoc|updateDoc|addDoc)\s*\(/,"Client Firestore write fallback remains in "+name);
  }
});

test("Cloudflare Procurement API requires active institutional identities and role-gates controlled transitions", async () => {
  const worker=await readFile(new URL("../drive-gateway/src/procurementServices.mjs",import.meta.url),"utf8");
  assert.match(worker,/createProcurementServicesRouter/);
  assert.match(worker,/active IRPA member or employee department profile is required/);
  assert.match(worker,/Procurement Team authorization is required/);
  assert.match(worker,/Only the selected authorised officer may approve this procurement/);
  assert.match(worker,/currentDocument:\{updateTime:r\.updateTime\}/);
  for(const action of ["createVendor","createRequest","registerPR","reviewRequest","authorizeRequest","generatePO","scoreVendor","reserveQuotationHash","registerQuotation","registerEvidence","verifyEvidence","completeFinanceHandoff","refreshVendorRestriction"])assert.ok(worker.includes('operation==="'+action+'"'),"Missing "+action);
  assert.match(worker,/PROCUREMENT_SENT_TO_FINANCE/);
  assert.match(worker,/financePaymentTrace/);
});
