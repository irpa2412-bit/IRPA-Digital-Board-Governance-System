/* global sessionStorage, Image, devicePixelRatio */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

mkdirSync("test-results",{recursive:true});
const server=spawn("npx",["vite","--host","127.0.0.1","--port","4173","--strictPort"],{stdio:"ignore"});
let browser,activePage=null,activeViewport="unknown",activeCanvasBox=null;
const browserMessages=[];
async function waitForServer(){
 for(let i=0;i<60;i++){try{const r=await fetch("http://127.0.0.1:4173/tests/fixtures/signature-palette-harness.html");if(r.ok)return}catch{}await delay(500)}
 throw new Error("Vite test server did not become ready");
}
async function printPlacementDiagnostics(page,testId){
 const details=await page.evaluate(async()=>{
  const placed=[...document.querySelectorAll("[data-testid^='placed-']")].map(el=>{
   const r=el.getBoundingClientRect(),s=getComputedStyle(el),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
   return {testId:el.getAttribute("data-testid"),box:{x:r.x,y:r.y,width:r.width,height:r.height},display:s.display,visibility:s.visibility,opacity:s.opacity,covered:!!top&&!(top===el||el.contains(top)||el.parentElement?.contains(top)),coveringElement:top?.outerHTML?.slice(0,240)||null};
  });
  const pad=[...document.querySelectorAll("canvas")].find(el=>el.getAttribute("aria-label")==="Draw signature");
  const r=pad?.getBoundingClientRect(),s=pad?getComputedStyle(pad):null;
  const stored=(()=>{try{return JSON.parse(window.sessionStorage.getItem("signature-envelope-fixture")||"{}")}catch{return {}}})();
  const specimen=stored?.values?.["initial-page-1"]||null;
  let decoded=null;
  if(typeof specimen==="string"&&specimen.startsWith("data:")) decoded=await new Promise(resolve=>{const img=new window.Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight,dataUrlLength:specimen.length});img.onerror=()=>resolve({width:null,height:null,dataUrlLength:specimen.length,decodeError:true});img.src=specimen});
  return {placed,pad:pad?{widthAttribute:pad.width,heightAttribute:pad.height,cssRect:{x:r.x,y:r.y,width:r.width,height:r.height},devicePixelRatio:window.devicePixelRatio,transform:s.transform}:null,specimen:{pixelWidth:decoded?.width??null,pixelHeight:decoded?.height??null,dataUrlLength:decoded?.dataUrlLength??(typeof specimen==="string"?specimen.length:0)}};
 });
 console.error("PLACED_TIMEOUT_DIAGNOSTICS:",JSON.stringify({testId,...details,consoleAndPageErrors:browserMessages}));
 await page.screenshot({path:"test-results/signature-palette-"+activeViewport+"-failure.png",fullPage:true});
}
async function assertPlacedSignatureVisibleAndUncovered(page,testId){
 const placed=page.getByTestId(testId);
 try{await placed.waitFor({state:"visible",timeout:30000})}catch(error){if(testId==="placed-initial-page-1")await printPlacementDiagnostics(page,testId);throw error;}
 assert.equal(await placed.evaluate(el=>el instanceof HTMLImageElement&&el.complete&&el.naturalWidth>0),true,"confirmed signature image must load and be visible");
 const imageBox=await placed.boundingBox(),pdfBox=await page.getByTestId("pdf-page").boundingBox();
 assert.ok(imageBox&&pdfBox,"confirmed signature and PDF page must both have visible bounds");
 assert.ok(imageBox.x>=pdfBox.x&&imageBox.y>=pdfBox.y&&imageBox.x+imageBox.width<=pdfBox.x+pdfBox.width&&imageBox.y+imageBox.height<=pdfBox.y+pdfBox.height,"confirmed signature must remain inside the visible PDF page");
 const exposed=await placed.evaluate(el=>{const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!top&&(top===el||el.contains(top)||el.parentElement?.contains(top))});
 assert.equal(exposed,true,"confirmed signature must not be covered by another layer");
}
async function assertDockDoesNotCoverPdf(page,fieldTestId){
 const dock=page.getByRole("dialog",{name:/Confirm/});
 const pdf=page.getByTestId("pdf-page");
 const field=page.getByTestId(fieldTestId);
 const d=await dock.boundingBox(),p=await pdf.boundingBox(),f=await field.boundingBox();
 assert.ok(d&&p&&f,"signature dock, PDF and selected signing field must all be visible");
 assert.ok(f.x>=p.x&&f.y>=p.y&&f.x+f.width<=p.x+p.width&&f.y+f.height<=p.y+p.height,
   "selected signing field must remain inside the PDF page");
 const fieldCovered=d.x<f.x+f.width&&d.x+d.width>f.x&&d.y<f.y+f.height&&d.y+d.height>f.y;
 assert.equal(fieldCovered,false,"fixed signature dock must not cover the active signing field");
 const fieldExposed=await field.evaluate(el=>{const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!top&&(top===el||el.contains(top))});
 assert.equal(fieldExposed,true,"active signing field must remain reachable while the fixed dock is open");
 assert.equal(await dock.evaluate(el=>getComputedStyle(el).position),"fixed","signature dock must remain fixed to the viewport bottom");
 assert.equal(await dock.getAttribute("aria-modal"),"false","signature palette must not install a modal backdrop");
}
async function runViewport(name,viewport){
 const context=await browser.newContext({viewport});
 const page=await context.newPage();activePage=page;activeViewport=name;
 page.on("pageerror",error=>{browserMessages.push({kind:"pageerror",message:error.message});console.error("PAGE_ERROR:",error.message)});
 page.on("console",message=>{const item={kind:"console",type:message.type(),text:message.text()};browserMessages.push(item);console.log("BROWSER_CONSOLE:",JSON.stringify(item))});
 await page.goto("http://127.0.0.1:4173/tests/fixtures/signature-palette-harness.html");
 await page.getByRole("heading",{name:/Signing ceremony/}).waitFor();
 assert.equal(await page.getByTestId("page-number").innerText(),"1");
 // Cancel must close the dock without placing a signature.
 await page.getByTestId("field-sig-page-1").click();
 await assertDockDoesNotCoverPdf(page,"field-sig-page-1");
 await page.getByRole("button",{name:"Cancel",exact:true}).click();
 assert.equal(await page.getByRole("dialog").count(),0,"Cancel closes the palette");
 assert.equal(await page.getByTestId("placed-sig-page-1").count(),0,"Cancel does not apply a signature");
 // Type first: isolate confirmation from canvas input.
 await page.getByTestId("field-sig-page-1").click();
 await page.getByRole("button",{name:"Type",exact:true}).click();
 await page.getByLabel("Type your signature").fill("IRPA Typed Signer");
 await page.getByRole("button",{name:"Confirm Signature"}).click();
 await assertPlacedSignatureVisibleAndUncovered(page,"placed-sig-page-1");
 console.log("PASS "+name+": Type + explicit Confirm");
 // Draw on the initials field after explicitly selecting Draw. The fixture intentionally supplies saved signature and initials specimens, so the component correctly defaults to the saved-specimen review mode.
 await page.getByTestId("field-initial-page-1").click();
 await assertDockDoesNotCoverPdf(page,"field-initial-page-1");
 await page.getByRole("button",{name:"Draw",exact:true}).click();
 const canvas=page.getByLabel("Draw signature");
 await canvas.waitFor({state:"visible"});
 // A visible element can still be below the viewport. Bring the actual canvas
 // into the viewport before using page.mouse (whose coordinates are viewport-relative).
 await canvas.scrollIntoViewIfNeeded();
 const rect=await canvas.boundingBox();
 const viewportSize=page.viewportSize();
 assert.ok(rect&&rect.width>20&&rect.height>20,"drawing canvas must have a non-zero visible CSS box");
 assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewportSize.width&&rect.y+rect.height<=viewportSize.height,
   "drawing canvas must be inside the viewport before pointer input: "+JSON.stringify({rect,viewport:viewportSize}));
 activeCanvasBox=rect;
 console.log("CANVAS_BOUNDING_BOX "+name+": "+JSON.stringify(rect));
 await canvas.evaluate(el=>{
   el.__signaturePointerCounts={down:0,move:0,up:0};
   for(const [type,key] of [["pointerdown","down"],["pointermove","move"],["pointerup","up"]])
     el.addEventListener(type,()=>el.__signaturePointerCounts[key]++);
 });
 await page.mouse.move(rect.x+40,rect.y+50);
 await page.mouse.down();
 await page.mouse.move(rect.x+160,rect.y+95,{steps:12});
 await page.mouse.move(rect.x+260,rect.y+65,{steps:8});
 await page.mouse.up();
 const drawingEvidence=await canvas.evaluate(el=>{
   const ctx=el.getContext("2d"),{width,height}=el;
   const pixels=ctx.getImageData(0,0,width,height).data;
   let opaqueDark=0,opaque=0;
   for(let i=0;i<pixels.length;i+=4){
     const alpha=pixels[i+3];
     if(alpha>0)opaque++;
     if(alpha>0&&pixels[i]<100&&pixels[i+1]<100&&pixels[i+2]<100)opaqueDark++;
   }
   return {opaquePixels:opaque,opaqueDarkPixels:opaqueDark,pointerEvents:el.__signaturePointerCounts};
 });
 const inkPixels=drawingEvidence.opaqueDarkPixels;
 assert.equal(drawingEvidence.pointerEvents.down,1,"canvas must receive exactly one pointerdown");
 assert.ok(drawingEvidence.pointerEvents.move>0,"canvas must receive pointermove events");
 assert.equal(drawingEvidence.pointerEvents.up,1,"canvas must receive exactly one pointerup");
 console.log("DRAW_INK_PIXELS "+name+": "+JSON.stringify(drawingEvidence));
 console.log("DRAW_INK_PIXELS "+name+": "+inkPixels);
 assert.ok(inkPixels>10,"pointer stroke must leave visible ink before Confirm");
 // A viewport-width change resizes the responsive canvas. The in-progress
 // handwritten mark must survive both the resize and restoration before Confirm.
 await page.setViewportSize({width:viewport.width-40,height:viewport.height});
 await page.waitForTimeout(150);
 const countDarkInk=el=>{const p=el.getContext("2d").getImageData(0,0,el.width,el.height).data;let count=0;for(let i=0;i<p.length;i+=4)if(p[i+3]>0&&p[i]<100&&p[i+1]<100&&p[i+2]<100)count++;return count;};
 const resizedInk=await canvas.evaluate(countDarkInk);
 console.log("RESIZED_INK_PIXELS "+name+": "+resizedInk);
 assert.ok(resizedInk>10,"handwritten ink must survive responsive canvas resize before Confirm");
 await page.setViewportSize(viewport);
 await page.waitForTimeout(150);
 const restoredInk=await canvas.evaluate(countDarkInk);
 console.log("RESTORED_INK_PIXELS "+name+": "+restoredInk);
 assert.ok(restoredInk>10,"handwritten ink must survive restoring the original viewport before Confirm");
 await canvas.evaluate(el=>{const trace={windowResizeEvents:0,dimensionMutations:[]};window.addEventListener("resize",()=>{trace.windowResizeEvents+=1});const observer=new window.MutationObserver(records=>{for(const record of records)trace.dimensionMutations.push({attribute:record.attributeName,width:el.width,height:el.height})});observer.observe(el,{attributes:true,attributeFilter:["width","height"]});window.__paletteResizeTrace=trace;window.__paletteResizeObserver=observer});
 const beforeCapture=await canvas.evaluate(el=>{const p=el.getContext("2d").getImageData(0,0,el.width,el.height).data;let ink=0;for(let i=0;i<p.length;i+=4)if(p[i+3]>0&&p[i]<100&&p[i+1]<100&&p[i+2]<100)ink++;return {width:el.width,height:el.height,ink}});
 await page.screenshot({path:"test-results/signature-palette-"+name+"-draw-before-confirm.png",fullPage:true});
 const afterCapture=await canvas.evaluate(el=>{const p=el.getContext("2d").getImageData(0,0,el.width,el.height).data;let ink=0;for(let i=0;i<p.length;i+=4)if(p[i+3]>0&&p[i]<100&&p[i+1]<100&&p[i+2]<100)ink++;return {width:el.width,height:el.height,ink,trace:window.__paletteResizeTrace}});
 console.log("PRECONFIRM_SCREENSHOT_CANVAS "+name+": "+JSON.stringify({beforeCapture,afterCapture}));
 assert.ok(afterCapture.ink>10,"pre-confirm screenshot/layout capture must not clear handwritten ink");
 await page.evaluate(()=>window.__paletteResizeObserver?.disconnect());
 const confirmButton=page.getByRole("button",{name:"Confirm Initials"});
 await confirmButton.evaluate(button=>{window.__signatureConfirmButtonClick=false;button.addEventListener("click",()=>{window.__signatureConfirmButtonClick=true},{once:true})});
 await confirmButton.click();
 console.log("CONFIRM_BUTTON_CLICK_EVENT "+name+": "+await page.evaluate(()=>window.__signatureConfirmButtonClick));
 console.log("PAD_ON_CONFIRM_FIELD "+name+": "+await page.evaluate(()=>window.__signaturePadOnConfirmField||null));
 assert.equal(await page.evaluate(()=>window.__signaturePadOnConfirmField||null),"initial-page-1","Confirm must apply to the exact assigned initials field");
 assert.ok(await page.evaluate(()=>window.__signaturePadOnConfirmValueLength||0)>0,"Confirm must receive a non-empty prepared PNG specimen");
 assert.equal(await page.getByTestId("envelope-state").innerText(),"Confirmed fields: 2","the initials confirmation must persist as a second field value");
 await assertPlacedSignatureVisibleAndUncovered(page,"placed-initial-page-1");
 await page.screenshot({path:"test-results/signature-palette-"+name+"-draw-after-confirm.png",fullPage:true});
 console.log("PASS "+name+": Draw + explicit Confirm");
 // Navigate to page 2 and use the saved specimen.
 await page.getByRole("button",{name:"Next page"}).click();
 assert.equal(await page.getByTestId("page-number").innerText(),"2");
 await page.getByTestId("field-sig-page-2").click();
 await page.getByRole("button",{name:"Use my saved signature"}).click();
 await page.getByRole("button",{name:"Use this signature",exact:true}).click();
 await assertPlacedSignatureVisibleAndUncovered(page,"placed-sig-page-2");
 console.log("PASS "+name+": Saved specimen + explicit Confirm");
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
async function assertConfirmationFooterMatrix(){
 const cases=[
  {name:"android-360x640",width:360,height:640},
  {name:"android-390x480",width:390,height:480},
  {name:"android-412x480",width:412,height:480},
  {name:"tablet-768x640",width:768,height:640},
  {name:"laptop-1280x480",width:1280,height:480},
  {name:"desktop-1280x600",width:1280,height:600},
  {name:"desktop-1920x900",width:1920,height:900}
 ];
 for(const item of cases){
  for(const zoom of [1,1.25,1.5]){
   const zoomedViewport={width:Math.max(320,Math.floor(item.width/zoom)),height:Math.max(300,Math.floor(item.height/zoom))};
   const context=await browser.newContext({viewport:zoomedViewport});
   const page=await context.newPage();
   await page.goto("http://127.0.0.1:4173/tests/fixtures/signature-palette-harness.html");
   for(const mode of ["saved","draw","type"]){
    await page.getByTestId("field-sig-page-1").click();
    if(mode==="draw")await page.getByRole("button",{name:"Draw",exact:true}).click();
    if(mode==="type"){
     await page.getByRole("button",{name:"Type",exact:true}).click();
     await page.getByLabel("Type your signature").fill("A very long signer name used to check wrapping at narrow widths");
     await page.setViewportSize({width:zoomedViewport.width,height:Math.max(260,zoomedViewport.height-260)});
    }
    const measured=await page.evaluate(()=>{
     const dialog=document.querySelector('[role="dialog"]'),footer=dialog?.querySelector(".signature-confirmation-actions"),action=footer?.querySelector("button:last-child");
     const d=dialog?.getBoundingClientRect(),f=footer?.getBoundingClientRect(),a=action?.getBoundingClientRect();
     return {viewport:{width:window.innerWidth,height:window.innerHeight},dialog:d&&{top:d.top,bottom:d.bottom,height:d.height},footer:f&&{top:f.top,bottom:f.bottom,height:f.height},action:a&&{top:a.top,bottom:a.bottom,height:a.height},footerPosition:footer&&getComputedStyle(footer).position,contentOverflow:dialog&&getComputedStyle(dialog.querySelector(".signature-confirmation-content")).overflowY};
    });
    assert.ok(measured.action,"confirmation action must render for "+item.name+" "+zoom+" "+mode);
    assert.ok(measured.action.top>=0&&measured.action.bottom<=measured.viewport.height+1,"confirmation action must stay inside the visible viewport: "+JSON.stringify({item,zoom,mode,measured}));
    assert.ok(measured.action.height>=44,"confirmation action must retain a 44px touch target: "+JSON.stringify({item,zoom,mode,measured}));
    assert.equal(measured.footerPosition,"sticky","confirmation footer must remain sticky");
    assert.equal(measured.contentOverflow,"auto","signature choices must scroll independently above the footer");
    if(mode==="type")await page.setViewportSize(zoomedViewport);
    await page.getByRole("button",{name:"Cancel",exact:true}).click();
   }
   await context.close();
   console.log("PASS confirmation footer viewport matrix: "+item.name+" at "+Math.round(zoom*100)+"% zoom");
  }
 }
}
try{
 await waitForServer();
 browser=await chromium.launch({headless:true});
 await runViewport("desktop",{width:1440,height:1000});
 await runViewport("mobile",{width:390,height:844});
 await assertConfirmationFooterMatrix();
 console.log("PASS desktop: Draw, Type, saved signature, explicit Confirm, multi-page, multi-field, zoom, reload, no palette overlap");
 console.log("PASS mobile: Draw, Type, saved signature, explicit Confirm, multi-page, multi-field, zoom, reload, no palette overlap");
}catch(error){
 console.error("FAIL signature palette Playwright:",error);
 if(activePage){
  console.error("CANVAS_BOUNDING_BOX "+activeViewport+":",JSON.stringify(activeCanvasBox));
  try{await activePage.screenshot({path:"test-results/signature-palette-"+activeViewport+"-failure.png",fullPage:true});}catch{}
  try{writeFileSync("test-results/signature-palette-"+activeViewport+"-failure.html",await activePage.content());}catch{}
  try{console.error("VISIBLE_FAILURE_ALERTS:",await activePage.locator('[role="alert"]').allTextContents());}catch{}
  try{console.error("ENVELOPE_STATE:",await activePage.getByTestId("envelope-state").innerText());}catch{}
 }
 process.exitCode=1
}
finally{await browser?.close();server.kill("SIGTERM")}

// CI retest trigger: preserve strict signature palette assertions.
