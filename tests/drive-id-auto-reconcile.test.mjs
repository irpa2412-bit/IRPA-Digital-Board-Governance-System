import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
const worker=fs.readFileSync(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");
const ui=fs.readFileSync(new URL("../src/components/SignaturePathwaySelfTest.jsx",import.meta.url),"utf8");
test("reconciliation discovers Firestore controlled documents and compares Drive description.documentId",()=>{
 assert.match(worker,/getFirestoreCollectionDocuments\(env, "documents", firestoreToken\)/);
 assert.match(worker,/description\.documentId/);
 assert.match(worker,/const requiredId = "wiAfPSIxHLTd6MdeM04q"/);
 assert.match(worker,/status = "match"/);
 assert.match(worker,/status = "mismatch"/);
 assert.match(worker,/status = "unreadable"/);
});
test("repair requires explicit confirmation and dry-run is non-mutating",()=>{
 assert.match(worker,/body\?\.repairMismatches !== true/);
 assert.match(worker,/if \(!dryRun && body\?\.repairMismatches !== true/);
 assert.match(ui,/Dry-run Drive ID Reconciliation/);
 assert.match(ui,/Repair mismatches/);
 assert.match(ui,/autoDiscover: true/);
});
