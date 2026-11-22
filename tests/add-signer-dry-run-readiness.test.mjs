import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
const worker=fs.readFileSync(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");
const readiness=fs.readFileSync(new URL("../drive-gateway/src/releaseReadinessRoutes.mjs",import.meta.url),"utf8");
const ui=fs.readFileSync(new URL("../src/components/ReleaseReadiness.jsx",import.meta.url),"utf8");
test("add-signer dry-run is authenticated and never writes",()=>{
 assert.match(worker,/\/api\/signature-workflow\/add-signer-dry-run/);
 const route=worker.slice(worker.indexOf("async function addSignerDryRunRoute"),worker.indexOf("async function saveSignatureWorkflowDraftRoute"));
 assert.match(route,/writesPerformed:false/);
 assert.match(route,/driveMutationsPerformed:false/);
 assert.doesNotMatch(route,/documents:commit|method:"PATCH"|signatureDraftFirestoreValue/);
});
test("Release Readiness classifies missing configuration separately and reports counts",()=>{
 assert.match(readiness,/"NEEDS CONFIGURATION"/);
 assert.match(readiness,/needsConfiguration/);
 assert.match(ui,/Missing required Worker secrets:/);
 assert.match(ui,/NEEDS CONFIGURATION, .* FAIL/);
 assert.match(ui,/add-signer-dry-run/);
});
