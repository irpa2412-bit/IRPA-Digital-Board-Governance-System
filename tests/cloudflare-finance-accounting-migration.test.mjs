import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Finance client sends callable operations to authenticated Cloudflare Worker without Firebase Functions fallback", async () => {
 const client=await readFile(new URL("../src/firebase/data.js",import.meta.url),"utf8");
 const start=client.indexOf("export async function callFinanceAccounting(functionName,data={})");
 const end=client.indexOf("\n",start);
 assert.notEqual(start,-1);assert.ok(end>start);
 const fn=client.slice(start,end);
 assert.match(fn,/\/api\/finance\/accounting/);
 assert.match(fn,/getIdToken\(\)/);
 assert.match(fn,/No Firebase Cloud Function fallback was used/);
 assert.doesNotMatch(fn,/httpsCallable|getFunctions/);
});

test("Cloudflare Finance API whitelists every existing accounting operation and enforces Finance roles", async () => {
 const worker=await readFile(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");
 assert.match(worker,/pathname === "\/api\/finance\/accounting"/);
 assert.match(worker,/authenticateFirebaseRequest\(request, env\)/);
 assert.match(worker,/Finance authorization is required/);
 for(const action of ["initializeFinanceStructure","submitFinanceJournalForApproval","postFinanceJournal","reverseFinanceJournal","closeFinancePeriod","reconcileFinanceBank","calculateFinanceBudgetVariance","getFinanceTrialBalance","getFinanceStatements","createFinanceThreeWayMatch","validateFinanceDonorRestriction","registerFinanceAsset","calculateFinancePayroll","exportFinanceCsv","importFinanceCsvRows"]) {
  assert.ok(worker.includes('"'+action+'"'),"Missing finance operation "+action);
 }
 assert.match(worker,/currentDocument:\{updateTime:doc\.updateTime\}/);
 assert.match(worker,/FINANCE_JOURNAL_POSTED/);
});
