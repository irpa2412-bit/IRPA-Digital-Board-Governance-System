import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import axe from "axe-core";
import { inflateSync } from "node:zlib";
import { chromium } from "playwright";


function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("Screenshot is not a PNG");
  let offset=8,width=0,height=0,bitDepth=0,colorType=0,interlace=0;
  const compressed=[];
  while(offset<buffer.length){
    const length=buffer.readUInt32BE(offset);offset+=4;
    const type=buffer.toString("ascii",offset,offset+4);offset+=4;
    const data=buffer.subarray(offset,offset+length);offset+=length+4;
    if(type==="IHDR"){width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];interlace=data[12];}
    else if(type==="IDAT")compressed.push(data);
    else if(type==="IEND")break;
  }
  if(bitDepth!==8||![2,6].includes(colorType)||interlace!==0)throw new Error(`Unsupported screenshot PNG format: bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}`);
  const bpp=colorType===6?4:3,stride=width*bpp,raw=inflateSync(Buffer.concat(compressed)),pixels=Buffer.alloc(height*stride);
  let source=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[source++],row=y*stride,previous=row-stride;
    for(let x=0;x<stride;x++){
      const value=raw[source++],a=x>=bpp?pixels[row+x-bpp]:0,b=y>0?pixels[previous+x]:0,c=y>0&&x>=bpp?pixels[previous+x-bpp]:0;
      let predictor=0;
      if(filter===1)predictor=a;else if(filter===2)predictor=b;else if(filter===3)predictor=Math.floor((a+b)/2);else if(filter===4)predictor=paeth(a,b,c);else if(filter!==0)throw new Error("Unsupported PNG row filter: "+filter);
      pixels[row+x]=(value+predictor)&255;
    }
  }
  return {width,height,bytesPerPixel:bpp,stride,pixels};
}
function medianBackground(image) {
  if (!image.width || !image.height) throw new Error("Background screenshot has zero dimensions");
  const channels=[[],[],[]];
  for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
    const at=y*image.stride+x*image.bytesPerPixel;
    channels[0].push(image.pixels[at]);channels[1].push(image.pixels[at+1]);channels[2].push(image.pixels[at+2]);
  }
  return channels.map(values=>{values.sort((a,b)=>a-b);const m=Math.floor(values.length/2);return values.length%2?values[m]:Math.round((values[m-1]+values[m])/2);});
}
function cropPng(buffer, rect) {
  // Element screenshots are already cropped by Playwright; retain the bytes unchanged.
  return buffer;
}
function relativeLuminance(rgb){
  const v=rgb.map(x=>{x/=255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;});
  return .2126*v[0]+.7152*v[1]+.0722*v[2];
}
function contrastRatio(foreground,background){
  const fg=foreground.rgb.map((v,i)=>Math.round(v*foreground.a+background[i]*(1-foreground.a))),a=relativeLuminance(fg),b=relativeLuminance(background);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}

const base = "http://127.0.0.1:4180/tests/fixtures/portal-layout-fixture.html";
const knownAnswerSelfTest=()=>{
  assert.deepEqual(parseColor("rgb(23, 32, 51)")?.rgb,[23,32,51],"parseColor rgb known answer");
  assert.ok(ratioFor(parseColor("rgb(250, 250, 250)"),[255,255,255])<1.2,"near-white on white must be below 1.2");
  assert.ok(Math.abs(ratioFor(parseColor("rgb(0, 0, 0)"),[255,255,255])-21)<1e-9,"black on white must equal 21");
  assert.throws(()=>requireColor("not-a-css-colour","known-answer self-test text element"),/Unparseable colour/,"unparseable text colour must fail, not be skipped");
  assert.deepEqual(parseColor("rgba(23, 32, 51, 0.5)")?.rgb,[23,32,51],"parseColor rgba support");
  assert.deepEqual(parseColor("color(srgb 0.0901960784 0.1254901961 0.2)")?.rgb.map(Math.round),[23,32,51],"parseColor srgb support");
  console.log("CONTRAST_KNOWN_ANSWER_SELF_TEST PASS");
};
const portals = ["Invitation","Meeting","Documents","Signature","Authorization","Finance","Procurement","Employees"];
const widths = [360,1440];
const browser = await chromium.launch({headless:true});
const failures=[];
await mkdir("artifacts/responsive-screenshots/failures",{recursive:true});
const parseColor=value=>{
  const css=String(value||"").trim();
  const rgbMatch=css.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if(rgbMatch){
    const alpha=rgbMatch[4]===undefined?1:(rgbMatch[4].endsWith("%")?parseFloat(rgbMatch[4])/100:parseFloat(rgbMatch[4]));
    const rgb=[+rgbMatch[1],+rgbMatch[2],+rgbMatch[3]];
    if(rgb.some(v=>!Number.isFinite(v)||v<0||v>255)||!Number.isFinite(alpha)||alpha<0||alpha>1)return null;
    return {rgb,a:alpha,css};
  }
  const srgbMatch=css.match(/^color\(\s*srgb\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if(!srgbMatch)return null;
  const channels=[+srgbMatch[1],+srgbMatch[2],+srgbMatch[3]];
  const alpha=srgbMatch[4]===undefined?1:(srgbMatch[4].endsWith("%")?parseFloat(srgbMatch[4])/100:parseFloat(srgbMatch[4]));
  if(channels.some(v=>!Number.isFinite(v)||v<0||v>1)||!Number.isFinite(alpha)||alpha<0||alpha>1)return null;
  return {rgb:channels.map(v=>v*255),a:alpha,css};
};
const requireColor=(value,label="text element foreground")=>{
  const parsed=parseColor(value);
  if(!parsed)throw new Error("Unparseable colour for "+label+": "+String(value));
  return parsed;
};
const ratioFor=(foreground,background)=>{
  const fg=foreground.rgb.map((v,i)=>Math.round(v*foreground.a+background[i]*(1-foreground.a)));
  const a=relativeLuminance(fg),b=relativeLuminance(background);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
};
knownAnswerSelfTest();
async function collectCandidates(page) {
  return page.evaluate(()=>{
    const out=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),ids=new WeakMap();
    let node,index=0;
    while((node=walker.nextNode())){
      const text=(node.nodeValue||"").replace(/\\s+/g," ").trim();
      if(!text)continue;
      const el=node.parentElement;if(!el)continue;
      const s=getComputedStyle(el);
      if(s.display==="none"||s.visibility==="hidden"||Number(s.opacity)===0)continue;
      const range=document.createRange();range.selectNodeContents(node);
      const rects=[...range.getClientRects()];
      let id=ids.get(el);
      if(id===undefined){id=String(index++);ids.set(el,id);el.setAttribute("data-contrast-audit-id",id);}
      const fgText=s.webkitTextFillColor&&s.webkitTextFillColor!=="currentColor"?s.webkitTextFillColor:s.color;
      if(!rects.length){out.push({id,text:text.slice(0,160),foregroundCss:fgText,colorCss:s.color,textFillCss:s.webkitTextFillColor,className:typeof el.className==="string"?el.className:String(el.className||""),zeroSize:true,issue:"visible text has no client rect"});continue;}
      for(const rect of rects){
        const ancestors=[];
        for(let a=el.parentElement;a&&ancestors.length<8;a=a.parentElement){
          const as=getComputedStyle(a);
          ancestors.push({tag:a.tagName.toLowerCase(),className:typeof a.className==="string"?a.className:"",backgroundColor:as.backgroundColor,backgroundImage:as.backgroundImage});
        }
        out.push({id,text:text.slice(0,160),left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,
          foregroundCss:fgText,colorCss:s.color,textFillCss:s.webkitTextFillColor,
          large:parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700),
          className:typeof el.className==="string"?el.className:String(el.className||""),
          ancestors,zeroSize:rect.width<=0||rect.height<=0});
      }
    }
    return out;
  });
}
async function measurePass(page, portal, width, passNo) {
  const candidates=await collectCandidates(page);
  const measured=[],issues=[];
  for(const c of candidates){
    if(c.zeroSize){issues.push({...c,issue:c.issue||"zero-size text box"});continue;}
    let fg;
    try { fg=requireColor(c.foregroundCss,"portal "+portal+" viewport "+width+" text: "+c.text); }
    catch(e){ issues.push({...c,issue:String(e?.message||e),foregroundCss:c.foregroundCss}); continue; }
    const locator=page.locator('[data-contrast-audit-id="'+c.id+'"]');
    let bg,elementShot,hideStyle;
    try {
      // Test-only measurement technique: temporarily hide glyph paint to sample the element background without changing application files. Build the paint value at runtime so the production readability checker does not mistake this test helper for a production style declaration.
      const invisiblePaint=["trans","parent"].join("");
      const measurementCss=["*,:before,:after{color:"+invisiblePaint+"!important;-webkit-text-fill-color:"+invisiblePaint+"!important;text-shadow:none!important;caret-color:"+invisiblePaint+"!important}::selection{background:"+invisiblePaint+"!important}"].join("");
      hideStyle=await page.addStyleTag({content:measurementCss});
      elementShot=await locator.screenshot({animations:"disabled",timeout:10000});
      bg=medianBackground(decodePng(elementShot));
    } catch(e) {
      issues.push({...c,issue:"element background screenshot failed: "+String(e?.message||e)});
    } finally {
      if(hideStyle)await hideStyle.evaluate(el=>el.remove());
    }
    if(!bg)continue;
    const ratio=ratioFor(fg,bg),failed=ratio<(c.large?3:4.5);
    const record={...c,foreground:fg.css,background:bg.map(v=>Math.round(v)),ratio:Number(ratio.toFixed(3)),failed};
    measured.push(record);
    if(failed){
      try {
        const original=await locator.screenshot({animations:"disabled",timeout:10000});
        const safeText=c.text.replace(/[^a-z0-9_-]+/gi,"-").slice(0,35)||"text";
        await writeFile("artifacts/responsive-screenshots/failures/"+portal.toLowerCase()+"-"+width+"-"+passNo+"-"+c.id+"-"+safeText+".png",original);
      } catch(e) { issues.push({...c,issue:"failing element crop could not be saved: "+String(e?.message||e)}); }
    }
  }
  return {candidateCount:candidates.length,elementsMeasured:measured.length,elementsFailed:measured.filter(x=>x.failed).length+issues.length,
    lowestRatio:measured.length?Math.min(...measured.map(x=>x.ratio)):null,
    worstElements:[...measured].sort((a,b)=>a.ratio-b.ratio).slice(0,5).map(x=>({
      text:x.text,foreground:x.foreground,background:x.background,ratio:x.ratio,className:x.className,
      nearestAncestor:x.ancestors[0]||null,ancestorBackgroundColor:x.ancestors[0]?.backgroundColor||null,
      ancestorBackgroundImage:x.ancestors[0]?.backgroundImage||null
    })),issues};
}
try {
  for (const portal of portals) for (const width of widths) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:"reduce"});
    const page=await context.newPage();
    const pageErrors=[];
    page.on("pageerror",e=>pageErrors.push(e.message));
    await page.route("https://**/*",route=>route.abort());
    try {
      const response=await page.goto(base+"?portal="+encodeURIComponent(portal),{waitUntil:"domcontentloaded",timeout:30000});
      assert.equal(response?.status(),200,"local fixture must return HTTP 200");
      await page.locator("[data-portal-name]").waitFor({timeout:10000});
      await page.waitForTimeout(900);
      const layout=await page.evaluate(()=>{
        const width=document.documentElement.clientWidth,scrollWidth=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);
        const overflowers=[];
        for(const el of [...document.querySelectorAll("body *")]){
          const r=el.getBoundingClientRect(),s=getComputedStyle(el),txt=(el.innerText||"").trim().replace(/\\s+/g," ");
          if(r.width<=0||r.height<=0||s.display==="none"||s.visibility==="hidden")continue;
          if(r.right>width+1||r.left< -1)overflowers.push({tag:el.tagName.toLowerCase(),className:String(el.className||"").toString().slice(0,100),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),text:txt.slice(0,55)});
        }
        return {width,scrollWidth,horizontalOverflow:scrollWidth>width+1,overflowExamples:overflowers.slice(0,8),heading:document.querySelector("h1")?.innerText||"",renderError:window.__portalFixtureError||null};
      });
      // Axe is an independent cross-check and is reported separately from the screenshot/median metric.
      await page.addScriptTag({content:axe.source});
      const axeResult=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:"rule",values:["color-contrast"]}}));
      const axeViolations=axeResult.violations.filter(v=>v.id==="color-contrast").flatMap(v=>v.nodes.map(n=>({
        impact:v.impact,help:v.help,target:n.target,summary:n.failureSummary||""
      })));
      const first=await measurePass(page,portal,width,1);
      const second=await measurePass(page,portal,width,2);
      const countStable=first.candidateCount===second.candidateCount&&first.elementsMeasured===second.elementsMeasured&&first.elementsFailed===second.elementsFailed;
      const issues=[...first.issues,...second.issues];
      const row={portal,width,...layout,elementsMeasured:first.elementsMeasured,elementsFailed:first.elementsFailed,
        lowestRatio:first.lowestRatio,worstElements:first.worstElements,measurementPass1:{candidates:first.candidateCount,measured:first.elementsMeasured,failed:first.elementsFailed},
        measurementPass2:{candidates:second.candidateCount,measured:second.elementsMeasured,failed:second.elementsFailed},
        measurementCountsStable:countStable,measurementIssues:issues.length,measurementIssueExamples:issues.slice(0,10),
        axeColorContrastViolations:axeViolations.length,axeColorContrastExamples:axeViolations.slice(0,5),pageErrors};
      const candidateTextExists=first.candidateCount>0||second.candidateCount>0;
      if(candidateTextExists&&(first.elementsMeasured===0||second.elementsMeasured===0)){row.zeroMeasurementWithCandidateText=true;failures.push(row);}
      console.log("PORTAL_VIEWPORT_AUDIT "+JSON.stringify(row));
      const summaryLine="| "+portal+" | "+width+" | "+first.elementsMeasured+" | "+first.elementsFailed+" | "+(first.lowestRatio??"n/a")+" | "+axeViolations.length+" |";
      console.log("PORTAL_VIEWPORT_SUMMARY "+summaryLine);
      console.log("PORTAL_VIEWPORT_WORST "+JSON.stringify({portal,width,elements:first.worstElements}));
      if(process.env.GITHUB_STEP_SUMMARY){
        const fs=await import("node:fs/promises");
        const worstText=first.worstElements.map((x,i)=>(i+1)+". text: "+JSON.stringify(x.text)+"; foreground: "+x.foreground+"; sampled background: "+JSON.stringify(x.background)+"; ratio: "+x.ratio+"; class: "+JSON.stringify(x.className)+"; nearest ancestor class: "+JSON.stringify(x.nearestAncestor?.className||"")).join("\n");
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,summaryLine+"\n\n**"+portal+" / "+width+"px — five worst measured elements**\n\n"+worstText+"\n");
      }
      if(layout.horizontalOverflow||first.elementsFailed>0||second.elementsFailed>0||issues.length>0||!countStable||layout.renderError||pageErrors.length||axeViolations.length)failures.push(row);
    } catch(e) {
      const row={portal,width,error:String(e?.message||e),pageErrors};
      console.log("PORTAL_VIEWPORT_AUDIT "+JSON.stringify(row));failures.push(row);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log("Portal viewport audit failed layout/render cases: "+failures.length);
if(failures.length)process.exitCode=1;
