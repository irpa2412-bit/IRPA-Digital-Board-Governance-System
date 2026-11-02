import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

mkdirSync("test-results",{recursive:true});
const readerSource=readFileSync("src/components/DocumentReader.jsx","utf8");
const signatureSource=readFileSync("src/pages/SignaturePlatform.jsx","utf8");
const gatewaySource=readFileSync("src/pages/GatewaySigningPortal.jsx","utf8");
for(const [name,source] of [["Controlled Documents reader",readerSource],["Signature Portal",signatureSource],["Gateway signing portal",gatewaySource]]){
 assert.match(source,/renderPdfPageToCanvas/,name+" must use the bounded PDF page renderer");
 assert.match(source,/could not be displayed/,name+" must show page-scoped rendering failures");
 assert.match(source,/Retry/,name+" must provide a retry action");
 assert.match(source,/Open original file/,name+" must provide an original-file link");
}
const server=spawn("npx",["vite","--host","127.0.0.1","--port","4176","--strictPort"],{stdio:"ignore"});
let browser;
const fixtures=[
 "test-results/irpa-three-page-controlled-minutes.pdf",
 "test-results/irpa-three-page-form-xobject-softmask.pdf"
];
async function waitForServer(){for(let i=0;i<60;i++){try{const r=await fetch("http://127.0.0.1:4176/tests/fixtures/signature-last-page-render-harness.html");if(r.ok)return;}catch{}await delay(500);}throw new Error("Last-page fixture server did not become ready");}
try{
 await waitForServer();
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:1100}});
 const page=await context.newPage();
 const errors=[];page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error")console.error("BROWSER:",message.text())});
 for(const fixture of fixtures){
  const bytes=readFileSync(fixture);
  if(fixture===fixtures[0]){
   const fonts=execFileSync("pdffonts",[fixture],{encoding:"utf8"});
   assert.ok(fonts.split("\n").some(line=>/TrueType/.test(line)&&/\byes\b/.test(line)),"Word-style PDF must embed at least one TrueType font");
   const images=execFileSync("pdfimages",["-list",fixture],{encoding:"utf8"});
   const imagePages=new Set(images.split("\n").map(line=>line.trim().split(/\s+/)[0]).filter(value=>/^[123]$/.test(value)));
   assert.deepEqual([...imagePages].sort(),["1","2","3"],"repeating letterhead image must be present on all three pages");
  }
  const extracted=execFileSync("pdftotext",["-f","3","-l","3","-layout",fixture,"-"],{encoding:"utf8"});
  assert.match(extracted,/PAGE 3 BODY CONTENT LINE 1/,"pdftotext must extract page-3 minutes");
  assert.match(extracted,/PAGE 3 SIGNATURE TABLE END/,"pdftotext must extract the page-3 signature table");
  await page.goto("http://127.0.0.1:4176/tests/fixtures/signature-last-page-render-harness.html");
  await page.getByTestId("pdf-upload").setInputFiles({name:fixture.split("/").pop(),mimeType:"application/pdf",buffer:bytes});
  await page.waitForFunction(()=>document.querySelector("[data-testid=stage]")?.textContent.includes("CONTROLLED PDF UPLOADED")||document.querySelector("[role=alert]"));
  const uploadStage=await page.getByTestId("stage").textContent();
  assert.match(uploadStage,/CONTROLLED PDF UPLOADED/,"realistic PDF upload must succeed; inline upload diagnostic: "+(await page.getByRole("alert").count()?await page.getByRole("alert").textContent():"none"));
  await page.getByRole("button",{name:"Add Signer"}).click();
  await page.getByTestId("signer-added").waitFor();
  await page.getByRole("button",{name:"Assign signature field to page 3"}).click();
  await page.getByTestId("page3-field").waitFor();
  await page.getByRole("button",{name:"Create envelope"}).click();
  await page.getByTestId("envelope-created").waitFor();
  for(const [view,label] of [["signature","Signature Portal viewer"],["controlled","Controlled Documents reader"],["gateway","Gateway signing portal"]]){
   await page.getByRole("button",{name:label}).click();
   await page.waitForFunction(expected=>{const node=document.querySelector("[data-testid=page-metrics]");if(!node)return false;try{return JSON.parse(node.textContent).view===expected}catch{return false}},view);
   const metrics=JSON.parse(await page.getByTestId("page-metrics").textContent());
   assert.equal(metrics.pageNumber,3);
   assert.ok(metrics.textCharacters>0,"page 3 text must be extractable in "+label);
   assert.ok(metrics.nonBlankPixelRatio>0,"page 3 must render non-white pixels in "+label);
   assert.ok(metrics.pixelWidth<=4096&&metrics.pixelHeight<=4096,"canvas dimensions must stay within mobile-safe allocation bounds");
   if(view==="signature")await page.getByTestId("page-3-signature-overlay").waitFor({state:"visible"});
   await page.getByTestId("simulate-render-error").click();
   const alert=page.getByRole("alert");
   await alert.waitFor({state:"visible"});
   assert.match(await alert.textContent(),/Page 3 could not be displayed: SimulatedRenderError: Injected PDF\.js worker failure/);
   await alert.getByRole("link",{name:"Open original file"}).waitFor({state:"visible"});
   await alert.getByRole("button",{name:"Retry"}).click();
   await page.waitForFunction(expected=>{const node=document.querySelector("[data-testid=page-metrics]");if(!node)return false;try{const metrics=JSON.parse(node.textContent);return metrics.view===expected&&metrics.retry>=1}catch{return false}},view);
   await page.screenshot({path:"test-results/"+fixture.split("/").pop()+"-"+view+"-desktop.png",fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  for(const [view,label] of [["signature","Signature Portal viewer"],["controlled","Controlled Documents reader"],["gateway","Gateway signing portal"]]){
   await page.getByRole("button",{name:label}).click();
   await page.waitForFunction(expected=>{const node=document.querySelector("[data-testid=page-metrics]");if(!node)return false;try{return JSON.parse(node.textContent).view===expected}catch{return false}},view);
   const metrics=JSON.parse(await page.getByTestId("page-metrics").textContent());
   assert.ok(metrics.textCharacters>0&&metrics.nonBlankPixelRatio>0,"page 3 must render on mobile in "+label);
   assert.ok(metrics.pixelWidth*metrics.pixelHeight<=4000000,"mobile canvas must respect the 4MP memory budget");
   await page.screenshot({path:"test-results/"+fixture.split("/").pop()+"-"+view+"-mobile.png",fullPage:true});
  }
 }
 assert.deepEqual(errors,[],"page-3 acceptance flow must not raise browser runtime errors");
 console.log("PASS: both Word-style and Form-XObject/soft-mask PDFs render page 3 in all three viewers on desktop and mobile");
}catch(error){console.error("FAIL last-page PDF acceptance:",error);process.exitCode=1;}
finally{await browser?.close();server.kill("SIGTERM");}
