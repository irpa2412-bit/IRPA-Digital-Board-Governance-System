import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
const worker=fs.readFileSync(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");
const ui=fs.readFileSync(new URL("../src/components/SignaturePathwaySelfTest.jsx",import.meta.url),"utf8");
test("read-only reconciliation discovers documents and probes Drive metadata and bytes",()=>{
 assert.match(worker,/getFirestoreCollectionDocuments\(env, "documents", firestoreToken\)/);
 assert.match(worker,/diagnoseControlledDocument/);
 assert.match(worker,/fields=id,name,mimeType,size,description,trashed,parents,createdTime/);
 assert.match(worker,/alt=media/);
 assert.match(worker,/writesPerformed:false,driveMutationsPerformed:false/);
 assert.match(worker,/status="unreadable"/);
});
test("diagnostic endpoint explicitly refuses repairs and the UI exposes report copying",()=>{
 assert.match(worker,/body\?\.repairMismatches === true/);
 assert.match(worker,/This diagnostic endpoint is read-only/);
 assert.match(ui,/Copy report/);
 assert.match(ui,/Classification:/);
 assert.match(ui,/Stored SHA-256:/);
 assert.match(ui,/Uploaded by:/);
 assert.match(ui,/pageCountComparison/);
 assert.doesNotMatch(ui,/Repair mismatches/);
});
