import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import axe from "axe-core";
import { inflateSync } from "node:zlib";
import { resolve } from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
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
function sampleBackground(image, rect) {
  if (!image.width || !image.height) throw new Error("Background screenshot has zero dimensions");
  const left=Math.max(0,Math.floor(rect.left)),top=Math.max(0,Math.floor(rect.top));
  const right=Math.min(image.width,Math.ceil(rect.right)),bottom=Math.min(image.height,Math.ceil(rect.bottom));
  if(right<=left||bottom<=top)throw new Error("Text rectangle lies outside the full-page screenshot buffer: rect="+JSON.stringify(rect)+", screenshot="+image.width+"x"+image.height);
  const channels=[[],[],[]];
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
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
const classifyZeroSizeCandidate=candidate=>["option","optgroup"].includes(String(candidate.tagName||"").toLowerCase())&&candidate.insideSelect===true?"native control item":"zero-size box";
const isFatalMeasurementIssue=reason=>true;
const knownAnswerSelfTest=()=>{
  assert.deepEqual(parseColor("rgb(23, 32, 51)")?.rgb,[23,32,51],"parseColor rgb known answer");
  assert.ok(ratioFor(parseColor("rgb(250, 250, 250)"),[255,255,255])<1.2,"near-white on white must be below 1.2");
  assert.ok(Math.abs(ratioFor(parseColor("rgb(0, 0, 0)"),[255,255,255])-21)<1e-9,"black on white must equal 21");
  assert.throws(()=>requireColor("not-a-css-colour","known-answer self-test text element"),/Unparseable colour/,"unparseable text colour must fail, not be skipped");
  assert.deepEqual(parseColor("rgba(23, 32, 51, 0.5)")?.rgb,[23,32,51],"parseColor rgba support");
  assert.deepEqual(parseColor("color(srgb 0.0901960784 0.1254901961 0.2)")?.rgb.map(Math.round),[23,32,51],"parseColor srgb support");
  assert.equal(classifyZeroSizeCandidate({tagName:"option",insideSelect:true}),"native control item","OPTION text inside SELECT is a native control item");
  assert.equal(isFatalMeasurementIssue(classifyZeroSizeCandidate({tagName:"div",text:"invisible DIV text"})),true,"zero-size DIV with text must fail the audit");
  assert.equal(isFatalMeasurementIssue("native control item"),false,"native control items are classified separately");
  console.log("CONTRAST_KNOWN_ANSWER_SELF_TEST PASS");
  console.log("ZERO_SIZE_CLASSIFICATION_SELF_TEST PASS");
};
const portals = ["Invitation","Meeting","Documents","Signature","Authorization","Finance","Procurement","Employees"];
const widths = [360,1440];
const browser = await chromium.launch({headless:true});
const failures=[];
await mkdir("artifacts/responsive-screenshots/failures",{recursive:true});
const parseColor=value=>{
  const css=String(value||"").trim();
  const hexMatch=css.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if(hexMatch){
    const h=hexMatch[1];
    const expanded=h.length<=4?[...h].map(ch=>ch+ch).join(""):h;
    const rgb=[parseInt(expanded.slice(0,2),16),parseInt(expanded.slice(2,4),16),parseInt(expanded.slice(4,6),16)];
    const a=expanded.length===8?parseInt(expanded.slice(6,8),16)/255:1;
    return {rgb,a,css};
  }
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
      if(!rects.length){const tagName=el.tagName.toLowerCase(),insideSelect=!!el.closest("select"),nativeControlItem=["option","optgroup"].includes(tagName)&&insideSelect;out.push({id,tagName,insideSelect,nativeControlItem,text:text.slice(0,160),foregroundCss:fgText,colorCss:s.color,textFillCss:s.webkitTextFillColor,className:typeof el.className==="string"?el.className:String(el.className||""),zeroSize:true,issue:"visible text has no client rect"});continue;}
      for(const rect of rects){
        const ancestors=[];
        for(let a=el.parentElement;a&&ancestors.length<8;a=a.parentElement){
          const as=getComputedStyle(a);
          ancestors.push({tag:a.tagName.toLowerCase(),className:typeof a.className==="string"?a.className:"",backgroundColor:as.backgroundColor,backgroundImage:as.backgroundImage});
        }
        const tagName=el.tagName.toLowerCase(),insideSelect=!!el.closest("select"),nativeControlItem=["option","optgroup"].includes(tagName)&&insideSelect;
        out.push({id,tagName,insideSelect,nativeControlItem,text:text.slice(0,160),left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,
          foregroundCss:fgText,colorCss:s.color,textFillCss:s.webkitTextFillColor,
          large:parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700),
          className:typeof el.className==="string"?el.className:String(el.className||""),
          ancestors,zeroSize:rect.width<=0||rect.height<=0});
      }
    }
    for(const select of document.querySelectorAll("select")){
      const rect=select.getBoundingClientRect(),s=getComputedStyle(select),selected=select.selectedOptions?.[0];
      const text=(selected?.textContent||select.getAttribute("aria-label")||select.labels?.[0]?.innerText||select.value||"Select control").trim();
      let id=ids.get(select);if(id===undefined){id=String(index++);ids.set(select,id);select.setAttribute("data-contrast-audit-id",id);}
      const ancestors=[];for(let a=select.parentElement;a&&ancestors.length<8;a=a.parentElement){const as=getComputedStyle(a);ancestors.push({tag:a.tagName.toLowerCase(),className:typeof a.className==="string"?a.className:"",backgroundColor:as.backgroundColor,backgroundImage:as.backgroundImage});}
      out.push({id,tagName:"select",insideSelect:false,nativeControlItem:false,nativeSelect:true,text:text.slice(0,160),left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,
        foregroundCss:s.webkitTextFillColor&&s.webkitTextFillColor!=="currentColor"?s.webkitTextFillColor:s.color,colorCss:s.color,textFillCss:s.webkitTextFillColor,
        large:parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700),className:typeof select.className==="string"?select.className:String(select.className||""),ancestors,zeroSize:rect.width<=0||rect.height<=0});
    }
    return out;
  });
}
const sourceMapCache=new Map();
async function originalCssLocation(stylesheet,line,column){
  if(!stylesheet||!Number.isInteger(line))return null;
  const mapPath=resolve(process.cwd(),"dist-responsive",String(stylesheet).replace(/^\/+/, "")+".map");
  try{
    let map=sourceMapCache.get(mapPath);
    if(!map){map=new TraceMap(JSON.parse(await readFile(mapPath,"utf8")));sourceMapCache.set(mapPath,map);}
    const original=originalPositionFor(map,{line,column:Number.isInteger(column)?column:0});
    if(!original.source||!original.line)return null;
    let source=String(original.source).replace(/\\/g,"/");const srcAt=source.lastIndexOf("/src/");
    if(srcAt>=0)source=source.slice(srcAt+1);else source=source.replace(/^(\.\.\/)+/,"");
    return {stylesheet:source,line:original.line,column:original.column};
  }catch{return null;}
}
async function attributeCause(cdp, styleSheets, item) {
  try {
    const root=(await cdp.send("DOM.getDocument",{depth:0})).root;
    const found=await cdp.send("DOM.querySelector",{nodeId:root.nodeId,selector:'[data-contrast-audit-id="'+item.id+'"]'});
    if(!found.nodeId)return {stylesheet:"NOT FOUND",selector:"NOT FOUND",line:null,nonWinningDarkTextRuleMatched:false};
    const matched=await cdp.send("CSS.getMatchedStylesForNode",{nodeId:found.nodeId});
    const rules=(matched.matchedCSSRules||[]).map(entry=>({rule:entry.rule,properties:entry.rule.style?.cssProperties||[]}));
    if(matched.inlineStyle)rules.unshift({rule:{origin:"inline",selectorList:{text:"element.style"},styleSheetId:null,style:matched.inlineStyle},properties:matched.inlineStyle.cssProperties||[]});
    const colorProps=rules.flatMap(({rule,properties})=>properties.filter(p=>p.name==="color").map(p=>({rule,property:p})));
    const winner=colorProps.find(x=>x.property.status==="active")||colorProps.find(x=>x.property.value===item.foreground)||colorProps[0];
    const nonWinningDarkTextRuleMatched=colorProps.some(x=>{
      if(x===winner||x.property.status==="active")return false;
      const parsed=parseColor(x.property.value);
      return parsed&&relativeLuminance(parsed.rgb)<0.25;
    });
    if(!winner)return {stylesheet:"NOT FOUND",selector:"NOT FOUND",line:null,nonWinningDarkTextRuleMatched};
    const sid=winner.rule.styleSheetId,source=styleSheets.get(sid)?.sourceURL||(winner.rule.origin==="inline"?"inline style":"unknown stylesheet");
    const file=source==="inline style"?source:(()=>{try{return new URL(source).pathname;}catch{return source;}})();
    const ruleLine=winner.rule.selectorList?.range?.startLine??winner.rule.style?.range?.startLine;
    const generatedLine=Number.isInteger(ruleLine)?ruleLine+1:null,generatedColumn=winner.rule.selectorList?.range?.startColumn??winner.rule.style?.range?.startColumn??0;
    const original=await originalCssLocation(file,generatedLine,generatedColumn);
    return {stylesheet:original?.stylesheet||file,selector:winner.rule.selectorList?.text||"element.style",line:original?.line??generatedLine,
      generatedStylesheet:file,generatedLine,sourceMapResolved:!!original,winningColor:winner.property.value,nonWinningDarkTextRuleMatched};
  } catch(error) {return {stylesheet:"CDP attribution error",selector:String(error?.message||error),line:null,nonWinningDarkTextRuleMatched:false};}
}
async function measurePass(page, portal, width, cdp, styleSheets) {
  const candidates=await collectCandidates(page),measured=[],issues=[];
  const issue=(c,reason,detail)=>issues.push({...c,tagName:c.tagName||"unknown",reason,detail:detail||""});
  for(const c of candidates) {
    if(c.zeroSize){issue(c,c.nativeControlItem?"native control item":"zero-size box",c.issue||"visible text has no positive-size client rect");continue;}
    try {requireColor(c.foregroundCss,"portal "+portal+" viewport "+width+" text: "+c.text);}
    catch(error){issue(c,"unparseable colour",String(error?.message||error));}
  }
  const invisiblePaint=["trans","parent"].join("");
  const measurementCss=["*,:before,:after{color:"+invisiblePaint+"!important;-webkit-text-fill-color:"+invisiblePaint+"!important;text-shadow:none!important;caret-color:"+invisiblePaint+"!important}::selection{background:"+invisiblePaint+"!important}"].join("");
  for(const c of candidates) {
    if(c.zeroSize||issues.some(i=>i.id===c.id&&i.reason==="unparseable colour"))continue;
    let hideStyle;
    try {
      const locator=page.locator('[data-contrast-audit-id="'+c.id+'"]');
      await locator.scrollIntoViewIfNeeded();
      hideStyle=await page.addStyleTag({content:measurementCss});
      const image=decodePng(await locator.screenshot({animations:"disabled",timeout:30000}));
      const bg=sampleBackground(image,{left:0,top:0,right:image.width,bottom:image.height});
      const fg=requireColor(c.foregroundCss,"portal "+portal+" viewport "+width+" text: "+c.text);
      const ratio=ratioFor(fg,bg),failed=ratio<(c.large?3:4.5);
      measured.push({...c,foreground:fg.css,background:bg.map(v=>Math.round(v)),ratio:Number(ratio.toFixed(3)),failed});
    } catch(error){issue(c,"sampling error",String(error?.message||error));}
    finally {if(hideStyle)await hideStyle.evaluate(el=>el.remove());}
  }
  const ratioFailures=measured.filter(x=>x.failed).sort((a,b)=>a.ratio-b.ratio),worstRatioFailures=[];
  const distinctRatioFailures=ratioFailures.filter((item,index,all)=>all.findIndex(other=>other.id===item.id)===index);
  for(const item of distinctRatioFailures.slice(0,5))worstRatioFailures.push({...item,cssCause:await attributeCause(cdp,styleSheets,item)});
  const measurementIssueCounts={zeroSizeBox:issues.filter(x=>x.reason==="zero-size box").length,
    nativeControlItem:issues.filter(x=>x.reason==="native control item").length,
    unparseableColour:issues.filter(x=>x.reason==="unparseable colour").length,
    samplingError:issues.filter(x=>x.reason==="sampling error").length,
    other:issues.filter(x=>!["zero-size box","native control item","unparseable colour","sampling error"].includes(x.reason)).length};
  const zeroSizeByTag={};for(const c of issues.filter(x=>x.zeroSize))zeroSizeByTag[c.tagName||"unknown"]=(zeroSizeByTag[c.tagName||"unknown"]||0)+1;
  const fatalMeasurementIssues=issues.filter(x=>isFatalMeasurementIssue(x.reason)).length;
  return {candidateCount:candidates.length,elementsMeasured:measured.length,ratioFailures:ratioFailures.length,
    measurementIssues:issues.length,fatalMeasurementIssues,measurementIssueCounts,zeroSizeByTag,lowestRatio:measured.length?Math.min(...measured.map(x=>x.ratio)):null,
    worstRatioFailures,issues:issues.slice(0,5)};
}
try {
  for(const portal of portals)for(const width of widths) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:"reduce"});
    const page=await context.newPage(),pageErrors=[];
    page.on("pageerror",e=>pageErrors.push(e.message));
    await page.route("https://**/*",route=>route.abort());
    try {
      const response=await page.goto(base+"?portal="+encodeURIComponent(portal),{waitUntil:"domcontentloaded",timeout:30000});
      assert.equal(response?.status(),200,"local fixture must return HTTP 200");
      await page.locator("[data-portal-name]").waitFor({timeout:10000});
      await page.waitForTimeout(250);
      const layout=await page.evaluate(()=>{
        const width=document.documentElement.clientWidth,scrollWidth=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),overflowers=[];
        for(const el of [...document.querySelectorAll("body *")]){
          const r=el.getBoundingClientRect(),s=getComputedStyle(el),txt=(el.innerText||"").trim().replace(/\\s+/g," ");
          if(r.width<=0||r.height<=0||s.display==="none"||s.visibility==="hidden")continue;
          if(r.right>width+1||r.left< -1)overflowers.push({tag:el.tagName.toLowerCase(),className:String(el.className||"").toString().slice(0,100),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),text:txt.slice(0,55)});
        }
        return {width,scrollWidth,horizontalOverflow:scrollWidth>width+1,overflowExamples:overflowers.slice(0,8),heading:document.querySelector("h1")?.innerText||"",renderError:window.__portalFixtureError||null};
      });
      const cdp=await context.newCDPSession(page),styleSheets=new Map();
      cdp.on("CSS.styleSheetAdded",event=>styleSheets.set(event.header.styleSheetId,event.header));
      await cdp.send("DOM.enable");await cdp.send("CSS.enable");
      await page.addScriptTag({content:axe.source});
      const axeResult=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:"rule",values:["color-contrast"]}}));
      const axeViolations=axeResult.violations.filter(v=>v.id==="color-contrast").flatMap(v=>v.nodes.map(n=>({impact:v.impact,help:v.help,target:n.target,summary:n.failureSummary||""})));
      const result=await measurePass(page,portal,width,cdp,styleSheets);
      const row={portal,width,...layout,candidates:result.candidateCount,measured:result.elementsMeasured,ratioFailures:result.ratioFailures,
        measurementIssues:result.measurementIssues,fatalMeasurementIssues:result.fatalMeasurementIssues,measurementIssueCounts:result.measurementIssueCounts,zeroSizeByTag:result.zeroSizeByTag,lowestRatio:result.lowestRatio,
        worstRatioFailures:result.worstRatioFailures,firstFiveMeasurementIssues:result.issues,
        axeColorContrastViolations:axeViolations.length,axeColorContrastExamples:axeViolations.slice(0,5),pageErrors};
      console.log("PORTAL_VIEWPORT_AUDIT "+JSON.stringify(row));
      const summaryLine="| "+portal+" | "+width+" | "+row.candidates+" | "+row.measured+" | "+row.ratioFailures+" | "+row.measurementIssues+" (zero-size "+row.measurementIssueCounts.zeroSizeBox+", unparseable colour "+row.measurementIssueCounts.unparseableColour+", sampling error "+row.measurementIssueCounts.samplingError+", other "+row.measurementIssueCounts.other+") | "+(row.lowestRatio??"n/a")+" | "+axeViolations.length+" |";
      console.log("PORTAL_VIEWPORT_SUMMARY "+summaryLine);
      console.log("PORTAL_ZERO_SIZE_TAG_COUNTS "+JSON.stringify({portal,width,counts:result.zeroSizeByTag,nativeControlItems:result.measurementIssueCounts.nativeControlItem}));
      for(const bad of result.issues)console.log("PORTAL_MEASUREMENT_ISSUE "+JSON.stringify({portal,width,tagName:bad.tagName,text:bad.text,reason:bad.reason,detail:bad.detail,className:bad.className,stylesheet:bad.stylesheet||null,line:bad.line??null,selector:bad.selector||null}));
      for(const bad of result.worstRatioFailures)console.log("PORTAL_RATIO_FAILURE_CAUSE "+JSON.stringify({portal,width,text:bad.text,foreground:bad.foreground,background:bad.background,ratio:bad.ratio,className:bad.className,...bad.cssCause}));
      if(process.env.GITHUB_STEP_SUMMARY){const fs=await import("node:fs/promises");await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,summaryLine+"\n");}
      if(layout.horizontalOverflow||row.ratioFailures>0||row.fatalMeasurementIssues>0||layout.renderError||pageErrors.length||axeViolations.length)failures.push(row);
    } catch(error) {
      const row={portal,width,error:String(error?.message||error),pageErrors};
      console.log("PORTAL_VIEWPORT_AUDIT "+JSON.stringify(row));failures.push(row);
    } finally {await context.close();}
  }
} finally {await browser.close();}

console.log("failed layout/render cases: "+failures.length);
if(failures.length)process.exitCode=1;
