import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

mkdirSync("test-results",{recursive:true});
const component=readFileSync("src/pages/SignaturePlatform.jsx","utf8");
const platform=readFileSync("src/firebase/signaturePlatform.js","utf8");
const addSigner=component.slice(component.indexOf("async function addSigner"),component.indexOf("function removeSigner"));
const saveDraft=platform.slice(platform.indexOf("export async function saveSignatureWorkflowDraft"),platform.indexOf("export async function finalizeSignatureWorkflowDraft"));
assert.match(addSigner,/saveSignatureWorkflowDraft/,"the real Add Signer action must persist through the workflow draft service");
assert.match(saveDraft,/resolveSourceDocumentIntegrity/,"the real Add Signer draft path must resolve source integrity");
assert.match(saveDraft,/sha256:sourceSha256,byteLength:sourceByteLength/,"the real Add Signer draft must persist the resolved source hash and byte length");

const server=spawn("npx",["vite","--host","127.0.0.1","--port","4175","--strictPort"],{stdio:"ignore"});
let browser,page;
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
async function waitForServer(){for(let i=0;i<60;i++){try{const r=await fetch("http://127.0.0.1:4175/tests/fixtures/signature-envelope-content-harness.html");if(r.ok)return;}catch{}await delay(500);}throw new Error("Signature Add Signer fixture server did not become ready");}
async function makeThreePagePdf(){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 for(let i=1;i<=3;i++){const p=doc.addPage([595.28,841.89]);p.drawText("IRPA CONTROLLED DOCUMENT",{x:54,y:790,size:17,font:bold,color:rgb(.12,.18,.28)});p.drawText("PAGE "+i+" BODY CONTENT LINE 1",{x:60,y:625,size:12,font,color:rgb(.05,.05,.05)});for(let n=2;n<=8;n++)p.drawText("PAGE "+i+" BODY CONTENT LINE "+n,{x:60,y:625-(n-1)*34,size:10,font,color:rgb(.05,.05,.05)});}
 return Buffer.from(await doc.save());
}
async function assertOverlayResponsive(target,minimumWidth){
 const overlay=target.getByTestId("signature-field-overlay");
 await overlay.waitFor({state:"visible"});
 const box=await overlay.boundingBox();
 assert.ok(box&&box.width>minimumWidth&&box.height>60,"assigned page-3 overlay must have a responsive, non-zero hit area");
 const style=await overlay.evaluate(el=>{const s=getComputedStyle(el);return{pointerEvents:s.pointerEvents,background:s.backgroundColor,border:s.border};});
 assert.equal(style.pointerEvents,"auto","signer overlay must be interactive");
 assert.ok(style.background==="rgba(0, 0, 0, 0)"||style.background==="transparent","signer overlay must remain transparent over source text");
 assert.match(style.border,/dashed/,"signer overlay must have a visible boundary");
}
try{
 await waitForServer();
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1200,height:1100}});
 page=await context.newPage();
 const pageErrors=[];page.on("pageerror",e=>pageErrors.push(e.message));
 const gatewayCalls=[];
 await page.route("**/__mock_gateway__/api/signature-workflow/draft",async route=>{
  const request=route.request();
  assert.equal(request.method(),"POST","draft persistence must use POST");
  assert.equal(request.headers().authorization,"Bearer fixture-authenticated-token","mock Gateway must receive the authenticated fixture token");
  const payload=request.postDataJSON();gatewayCalls.push(payload);
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,draft:{id:"IRPA-ENV-FIXTURE-001"}})});
 });
 await page.goto("http://127.0.0.1:4175/tests/fixtures/signature-envelope-content-harness.html");
 await page.getByTestId("authenticated-user").waitFor();
 assert.match(await page.getByTestId("authenticated-user").textContent(),/fixture-authenticated-signer/);
 const pdfBytes=await makeThreePagePdf(),sourceHash=hash(pdfBytes);
 await page.getByTestId("controlled-pdf-upload").setInputFiles({name:"IRPA-controlled-three-page.pdf",mimeType:"application/pdf",buffer:pdfBytes});
 await page.getByTestId("stage").getByText("CONTROLLED PDF UPLOADED").waitFor();
 assert.equal(await page.getByTestId("source-hash").textContent(),sourceHash,"uploaded source hash must match original PDF bytes");
 assert.equal(Number(await page.getByTestId("source-byte-length").textContent()),pdfBytes.length,"uploaded source byte length must match original PDF bytes");
 assert.match(await page.getByTestId("page3-text").textContent(),/PAGE 3 BODY CONTENT LINE 1/,"uploaded source page 3 text must be extracted");
 await page.getByRole("button",{name:"Add Signer"}).click();
 await page.getByTestId("signer-added").waitFor();
 assert.equal(gatewayCalls.length,1,"Add Signer must save the owner section and signer draft through the mocked Gateway");
 assert.equal(gatewayCalls[0].draft.sha256,sourceHash,"Add Signer draft must carry the original SHA-256");
 assert.equal(gatewayCalls[0].draft.byteLength,pdfBytes.length,"Add Signer draft must carry the original byte length");
 await page.getByTestId("field-page").selectOption("3");
 await page.getByRole("button",{name:"Assign Signature Field to Page 3"}).click();
 assert.match(await page.getByTestId("field-assignment").textContent(),/page 3.*fixture-authenticated-signer/);
 await page.getByRole("button",{name:"Create envelope"}).click();
 await page.getByTestId("stage").getByText("ENVELOPE CREATED").waitFor();
 assert.equal(gatewayCalls.length,2,"Create envelope must finalize through the mocked Gateway");
 assert.equal(gatewayCalls[1].draft.sha256,sourceHash,"final envelope must retain the source SHA-256");
 assert.equal(gatewayCalls[1].draft.fields[0].page,3,"final envelope must retain page-3 field placement");
 assert.equal(gatewayCalls[1].draft.fields[0].signerUid,"fixture-authenticated-signer","final envelope must retain authenticated signer assignment");
 const originalHashAfter=hash(Buffer.from(await page.getByTestId("original-pdf-base64").textContent(),"base64"));
 assert.equal(originalHashAfter,sourceHash,"original PDF bytes must remain unchanged through signer assignment and envelope creation");
 await page.getByRole("button",{name:"Open signing view as assigned signer"}).click();
 await page.getByTestId("stage").getByText("SIGNING VIEW").waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-testid="pdf-page-3-canvas"]')?.dataset.rendered==="true");
 await assertOverlayResponsive(page,500);
 assert.match(await page.getByTestId("page3-text").textContent(),/PAGE 3 BODY CONTENT LINE 1/,"page-3 body text must remain available in desktop signer view");
 await page.screenshot({path:"test-results/signature-add-signer-desktop.png",fullPage:true});

 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.querySelector('[data-testid="pdf-page-3-canvas"]')?.dataset.rendered==="true");
 await assertOverlayResponsive(page,250);
 assert.match(await page.getByTestId("page3-text").textContent(),/PAGE 3 BODY CONTENT LINE 1/,"page-3 body text must remain available in mobile signer view");
 await page.screenshot({path:"test-results/signature-add-signer-mobile.png",fullPage:true});
 assert.deepEqual(pageErrors,[],"the authenticated Add Signer flow must not raise browser runtime errors");
 writeFileSync("test-results/signature-add-signer-acceptance.txt",[
  "PASS: authenticated Add Signer draft and envelope finalization use the mocked Gateway",
  "PASS: SHA-256 and byte length match the original uploaded three-page PDF",
  "PASS: signer assignment and page-3 field placement persist in the final envelope",
  "PASS: page-3 text and transparent interactive field overlay render on desktop and mobile",
  "SOURCE_SHA256: "+sourceHash,
  "SOURCE_BYTE_LENGTH: "+pdfBytes.length
 ].join("\n")+"\n");
 console.log("PASS: authenticated Add Signer → page-3 field → envelope → signer view (desktop + mobile)");
 console.log("SOURCE_SHA256: "+sourceHash);
}catch(error){console.error("FAIL signature Add Signer acceptance:",error);if(page)try{await page.screenshot({path:"test-results/signature-add-signer-failure.png",fullPage:true});writeFileSync("test-results/signature-add-signer-failure.html",await page.content());}catch{}process.exitCode=1;}
finally{await browser?.close();server.kill("SIGTERM");}
