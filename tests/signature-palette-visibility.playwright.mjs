import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

mkdirSync("test-results",{recursive:true});
const server=spawn("npx",["vite","--host","127.0.0.1","--port","4173","--strictPort"],{stdio:"ignore"});
let browser,activePage=null,activeViewport="unknown";\nlet activePage;\nlet activeViewport="unknown";
async function waitForServer(){
 for(let i=0;i<60;i++){try{const r=await fetch("http://127.0.0.1:4173/tests/fixtures/signature-palette-harness.html");if(r.ok)return}catch{}await delay(500)}
 throw new Error("Vite test server did not become ready");
}
async function assertPlacedSignatureVisibleAndUncovered(page,testId){
 const placed=page.getByTestId(testId);
 await placed.waitFor({state:"visible"});
 assert.equal(await placed.evaluate(el=>el instanceof HTMLImageElement&&el.complete&&el.naturalWidth>0),true,"confirmed signature image must load and be visible");
 const imageBox=await placed.boundingBox(),pdfBox=await page.getByTestId("pdf-page").boundingBox();
 assert.ok(imageBox&&pdfBox,"confirmed signature and PDF page must both have visible bounds");
 assert.ok(imageBox.x>=pdfBox.x&&imageBox.y>=pdfBox.y&&imageBox.x+imageBox.width<=pdfBox.x+pdfBox.width&&imageBox.y+imageBox.height<=pdfBox.y+pdfBox.height,"confirmed signature must remain inside the visible PDF page");
 const exposed=await placed.evaluate(el=>{const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!top&&(top===el||el.contains(top)||el.parentElement?.contains(top))});
 assert.equal(exposed,true,"confirmed signature must not be covered by another layer");
}
async function assertDockDoesNotCoverPdf(page){
 const dock=page.getByRole("dialog",{name:/Confirm/});
 const pdf=page.getByTestId("pdf-page");
 const d=await dock.boundingBox(),p=await pdf.boundingBox();
 assert.ok(d&&p,"signature dock and PDF must both be visible");
 const intersects=d.x<p.x+p.width&&d.x+d.width>p.x&&d.y<p.y+p.height&&d.y+d.height>p.y;
 assert.equal(intersects,false,"signature dock must not overlap or cover the PDF page");
 assert.equal(await dock.evaluate(el=>getComputedStyle(el).position),"relative","signature dock must remain in document flow");
 assert.equal(await dock.getAttribute("aria-modal"),"false","signature palette must not install a modal backdrop");
}
async function runViewport(name,viewport){
 const context=await browser.newContext({viewport});
 const page=await context.newPage();activePage=page;activeViewport=name;\n activePage=page;activeViewport=name;\n page.on("pageerror",error=>console.error("PAGE_ERROR:",error.message));\n page.on("console",message=>{if(message.type()==="error")console.error("BROWSER_CONSOLE_ERROR:",message.text())});
 await page.goto("http://127.0.0.1:4173/tests/fixtures/signature-palette-harness.html");
 await page.getByRole("heading",{name:/Signing ceremony/}).waitFor();
 assert.equal(await page.getByTestId("page-number").innerText(),"1");
 // Cancel must close the dock without placing a signature.
 await page.getByTestId("field-sig-page-1").click();
 await assertDockDoesNotCoverPdf(page);
 await page.getByRole("button",{name:"Cancel",exact:true}).click();
 assert.equal(await page.getByRole("dialog").count(),0,"Cancel closes the palette");
 assert.equal(await page.getByTestId("placed-sig-page-1").count(),0,"Cancel does not apply a signature");
 // Draw a signature on page 1.
 await page.getByTestId("field-sig-page-1").click();
 await assertDockDoesNotCoverPdf(page);
 const canvas=page.getByLabel("Draw signature");
 const rect=await canvas.boundingBox();
 await page.mouse.move(rect.x+40,rect.y+50);await page.mouse.down();
 await page.mouse.move(rect.x+160,rect.y+95,{steps:8});await page.mouse.up();
 await page.getByRole("button",{name:"Confirm Signature"}).click();
 await assertPlacedSignatureVisibleAndUncovered(page,"placed-sig-page-1");
 assert.match(await page.getByTestId("placed-sig-page-1").getAttribute("src"),/^data:image\/png;base64,/);
 assert.equal(await page.getByRole("dialog").count(),0,"Confirm closes the palette");
 // Type a second field on the same page.
 await page.getByTestId("field-initial-page-1").click();
 await page.getByRole("button",{name:"Type",exact:true}).click();
 await page.getByLabel("Type your signature").fill("IRPA Signer");
 await page.getByRole("button",{name:"Confirm Initials"}).click();
 await assertPlacedSignatureVisibleAndUncovered(page,"placed-initial-page-1");
 // Navigate to page 2 and use the saved specimen.
 await page.getByRole("button",{name:"Next page"}).click();
 assert.equal(await page.getByTestId("page-number").innerText(),"2");
 await page.getByTestId("field-sig-page-2").click();
 await page.getByRole("button",{name:"Use my saved signature"}).click();
 await page.getByRole("button",{name:"Confirm Signature"}).click();
 await assertPlacedSignatureVisibleAndUncovered(page,"placed-sig-page-2");
 // Page 1's two fields remain confirmed after page changes.
 await page.getByRole("button",{name:"Previous page"}).click();
 await page.getByTestId("placed-sig-page-1").waitFor({state:"visible"});
 await page.getByTestId("placed-initial-page-1").waitFor({state:"visible"});
 // Zoom in/out and ensure the placed image remains in its own field.
 await page.getByRole("button",{name:"Zoom in"}).click();
 assert.equal(await page.getByTestId("zoom-level").innerText(),"110%");
 await page.getByTestId("placed-sig-page-1").waitFor({state:"visible"});
 await page.getByRole("button",{name:"Zoom out"}).click();
 // Reload mid-envelope: confirmed field images and page state survive.
 await page.reload();
 await page.getByTestId("placed-sig-page-1").waitFor({state:"visible"});
 await page.getByTestId("placed-initial-page-1").waitFor({state:"visible"});
 await page.getByRole("button",{name:"Next page"}).click();
 await page.getByTestId("placed-sig-page-2").waitFor({state:"visible"});
 await page.screenshot({path:"test-results/signature-palette-"+name+".png",fullPage:true});
 await context.close();
}
try{
 await waitForServer();
 browser=await chromium.launch({headless:true});
 await runViewport("desktop",{width:1440,height:1000});
 await runViewport("mobile",{width:390,height:844});
 console.log("PASS desktop: Draw, Type, saved signature, explicit Confirm, multi-page, multi-field, zoom, reload, no palette overlap");
 console.log("PASS mobile: Draw, Type, saved signature, explicit Confirm, multi-page, multi-field, zoom, reload, no palette overlap");
}catch(error){\n console.error("FAIL signature palette Playwright:",error);\n if(activePage){\n  try{await activePage.screenshot({path:"test-results/signature-palette-"+activeViewport+"-failure.png",fullPage:true});}catch{}\n  try{writeFileSync("test-results/signature-palette-"+activeViewport+"-failure.html",await activePage.content());}catch{}\n  try{console.error("VISIBLE_FAILURE_ALERTS:",await activePage.locator('[role="alert"]').allTextContents());}catch{}\n  try{console.error("ENVELOPE_STATE:",await activePage.getByTestId("envelope-state").innerText());}catch{}\n }\n process.exitCode=1\n}
finally{await browser?.close();server.kill("SIGTERM")}
