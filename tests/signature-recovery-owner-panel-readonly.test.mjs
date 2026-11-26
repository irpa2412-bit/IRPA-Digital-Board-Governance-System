import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../src/pages/SignatureRecoveryOwnerPanel.jsx",import.meta.url),"utf8");
const queue=fs.readFileSync(new URL("../src/pages/SignatureRecoveryOwnerEnvelopes.jsx",import.meta.url),"utf8");
test("each selected owner envelope exposes authenticated evidence, dry-run diagnosis and safe preview",()=>{
 assert.match(source,/\/api\/recovery\/envelopes\//);
 assert.match(source,/\/evidence/);
 assert.match(source,/diagnose-finalisation/);
 assert.match(source,/\/preview\.pdf/);
 assert.match(source,/normalizeFinalisationDiagnostic\(raw\)/);
 assert.match(source,/normalized\.readOnly!==true/);
});
test("only the finalisation dry-run uses POST; evidence and preview remain GET",()=>{
 assert.match(source,/recoveryRequest\([^;]*diagnose-finalisation[^;]*method:"POST"/s);
 assert.match(source,/recoveryRequest\([^;]*evidence/);
 assert.match(source,/recoveryRequest\([^;]*preview\.pdf/);
 assert.doesNotMatch(source,/method\s*:\s*["'](?:PUT|PATCH|DELETE)["']/i);
});
test("preview is gated by failed status, verified audit chain and verified source hash",()=>{
 assert.match(source,/canPreview=.*CompletionFailed/);
 assert.match(source,/auditChain\?\.status==="VERIFIED"/);
 assert.match(source,/sourceHashStatus==="VERIFIED"/);
 assert.match(source,/RECOVERY PREVIEW — NOT COMPLETED/);
});
test("owner queue is paginated and lists all non-completed owner envelopes",()=>{
 assert.match(queue,/api\/recovery\/envelopes\?limit=50&offset=/);
 assert.match(queue,/Load more/);
 assert.match(queue,/item\.envelopeId/);
 assert.match(queue,/Every non-completed envelope you own/);
});
test("recovery UI does not expose automatic retry, reassignment, repair or completion mutations",()=>{
 for(const forbidden of ["updateDoc(","deleteDoc(","addDoc(","writeBatch(","runTransaction(","signDocument(","reassignSigner(","retryFinalisation(","finalizeEnvelope(","completeEnvelope("])assert.equal(source.includes(forbidden),false,forbidden);
 assert.doesNotMatch(source,/\/stamps\/reassign|\/retry(?:\/|["'])|\/complete(?:\/|["'])|\/repair(?:\/|["'])|\/send-link/i);
});
test("diagnostic UI explicitly confirms dry-run does not write or modify original evidence",()=>{
 assert.match(source,/No envelope, signer, field, signature, hash, certificate, archive, Drive or email writes were performed/);
 assert.match(source,/No retry, reassignment, repair, finalisation/);
});

import {formatRecoveryRouteError} from "../src/utils/recoveryRouteError.mjs";
test("recovery errors identify the exact button and route with stable short codes",()=>{
 const route="/api/recovery/envelopes/ENV-0000000000000000/evidence";
 assert.equal(formatRecoveryRouteError({status:404,body:{ok:false,error:"Not found."},button:"Check this document",route}),
  "Recovery service route missing: "+route+" (ROUTE_MISSING) — Button: Check this document — Route: "+route);
 assert.match(formatRecoveryRouteError({status:401,body:{error:"Authentication required."},button:"Diagnose finalisation",route}),/^Not signed in \(NOT_SIGNED_IN\) — Button: Diagnose finalisation — Route:/);
 assert.match(formatRecoveryRouteError({status:403,body:{error:"Forbidden."},button:"Download completed copy",route}),/^Not your envelope \(NOT_YOUR_ENVELOPE\) — Button: Download completed copy — Route:/);
 assert.match(formatRecoveryRouteError({status:503,body:{error:"Unavailable."},button:"Generate watermarked preview",route}),/^Service unavailable \(SERVICE_UNAVAILABLE\) — Button: Generate watermarked preview — Route:/);
});
test("each recovery action passes its own button label into the route error formatter",()=>{
 assert.match(source,/button:"Check this document"/);
 assert.match(source,/button:"Diagnose finalisation \(read-only\)"/);
 assert.match(source,/button:"Download completed copy"/);
 assert.match(source,/button:"Generate watermarked preview"/);
 assert.match(queue,/formatRecoveryRouteError/);
});

test("refresh always forces a fresh Firebase ID token, bypasses HTTP caches and clears stale results before requesting",()=>{
 assert.match(queue,/getIdToken\\(user,true\\)/);
 assert.match(queue,/cache:"no-store"/);
 assert.match(queue,/"Cache-Control":"no-cache"/);
 assert.match(queue,/if\\(reset\\)\\{setRows\\(\\[\\]\\);setTotal\\(0\\);setOffset\\(0\\);setSelected\\(null\\);\\}/);
 assert.match(queue,/Last refreshed at:/);
 assert.match(queue,/Worker version:/);
 assert.match(queue,/VITE_BUILD_COMMIT/);
});
test("PWA worker activates immediately, claims clients, versions its cache and bypasses API routes",()=>{
 const sw=fs.readFileSync(new URL("../public/sw.js",import.meta.url),"utf8");
 const main=fs.readFileSync(new URL("../src/main.jsx",import.meta.url),"utf8");
 const install=fs.readFileSync(new URL("../public/install.js",import.meta.url),"utf8");
 assert.match(sw,/self\\.skipWaiting\\(\\)/);
 assert.match(sw,/self\\.clients\\.claim\\(\\)/);
 assert.match(sw,/p\\.startsWith\\("\/api\/"\\)/);
 assert.match(sw,/CACHE_PREFIX\\+BUILD_KEY/);
 assert.match(main,/\/sw\\.js\\?v=/);
 assert.doesNotMatch(install,/serviceWorker\\.register/);
});
test("authentication diagnostics preserve the four required stable error codes and request IDs",()=>{
 const route="/api/recovery/envelopes/ENV-0000000000000000/evidence";
 for(const code of ["TOKEN_INVALID","PROFILE_LOOKUP_FAILED","NOT_ACTIVATED","NOT_OWNER"]){
  assert.match(formatRecoveryRouteError({status:403,body:{code,error:"Access denied",requestId:"req-fixture"},button:"Refresh recovery queue",route}),new RegExp(code));
  assert.match(formatRecoveryRouteError({status:403,body:{code,error:"Access denied",requestId:"req-fixture"},button:"Refresh recovery queue",route}),/Request ID: req-fixture/);
 }
});
