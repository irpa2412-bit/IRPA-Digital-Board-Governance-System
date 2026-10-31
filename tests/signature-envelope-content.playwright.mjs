import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
mkdirSync("test-results",{recursive:true});
const server=spawn("npx",["vite","--host","127.0.0.1","--port","4175","--strictPort"],{stdio:"ignore"});
let browser,page;
async function waitForServer(){for(let i=0;i<60;i++){try{const r=await fetch("http://127.0.0.1:4175/tests/fixtures/signature-envelope-content-harness.html");if(r.ok)return}catch{}await delay(500)}throw new Error("Signature envelope content fixture server did not become ready");}
try{
 await waitForServer();browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1200,height:1100}});
 page.on("pageerror",e=>console.error("PAGE_ERROR:",e.message));
 await page.goto("http://127.0.0.1:4175/tests/fixtures/signature-envelope-content-harness.html");
 await page.getByTestId("stage").waitFor();
 await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="text-before"]').textContent||"[]").length===3);
 const before=JSON.parse(await page.getByTestId("text-before").textContent());
 assert.equal(before.length,3,"source PDF must contain three pages");
 for(let i=0;i<3;i++)assert.match(before[i],new RegExp("PAGE "+(i+1)+" BODY CONTENT LINE"),"body text must exist on every source page");
 await page.screenshot({path:"test-results/signature-envelope-content-before.png",fullPage:true});
 await page.getByRole("button",{name:"Create envelope"}).click();
 await page.getByTestId("signature-field-overlay").waitFor({state:"visible"});
 await page.waitForFunction(()=>document.querySelector("[data-testid=pdf-page] canvas")?.dataset.rendered==="true");
 await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="text-after"]').textContent||"[]").length===3);
 const after=JSON.parse(await page.getByTestId("text-after").textContent());
 const beforeHash=await page.getByTestId("hash-before").textContent();
 const afterHash=await page.getByTestId("hash-after").textContent();
 assert.match(beforeHash,/^[a-f0-9]{64}$/);
 assert.equal(afterHash,beforeHash,"source PDF bytes must remain byte-for-byte identical across envelope creation");
 assert.equal(after.length,3);
 for(let i=0;i<3;i++)assert.ok(after[i].length>=before[i].length,"page "+(i+1)+" lost extracted PDF text during envelope transition");
 assert.ok(after[2].includes("PAGE 3 BODY CONTENT LINE 1"),"page 3 body text must survive the assigned signature field");
 const pixels=await page.getByTestId("pdf-page").locator("canvas").evaluate(canvas=>{const ctx=canvas.getContext("2d"),data=ctx.getImageData(45,195,500,300).data;let dark=0;for(let i=0;i<data.length;i+=4)if(data[i+3]>0&&data[i]<90&&data[i+1]<90&&data[i+2]<90)dark++;return dark;});
 assert.ok(pixels>100,"page 3 body text pixels must remain visible beneath the transparent signature-field overlay");
 const overlay=await page.getByTestId("signature-field-overlay").evaluate(el=>getComputedStyle(el).backgroundColor);
 assert.ok(overlay==="rgba(0, 0, 0, 0)"||overlay==="transparent","signature placeholder must be a transparent overlay");
 await page.screenshot({path:"test-results/signature-envelope-content-after.png",fullPage:true});
 writeFileSync("test-results/signature-envelope-content-extracted.txt","BEFORE\n"+before.map((x,i)=>"PAGE "+(i+1)+": "+x).join("\n")+"\n\nAFTER\n"+after.map((x,i)=>"PAGE "+(i+1)+": "+x).join("\n")+"\n");
 console.log("PASS: 3-page PDF text extraction and page 3 pixels survive the DRAFT to ENVELOPE transition");
}catch(error){console.error("FAIL signature envelope content regression:",error);if(page)try{await page.screenshot({path:"test-results/signature-envelope-content-failure.png",fullPage:true});writeFileSync("test-results/signature-envelope-content-failure.html",await page.content())}catch{}process.exitCode=1;}
finally{await browser?.close();server.kill("SIGTERM");}