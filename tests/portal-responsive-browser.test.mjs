import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
function sampleRenderedBackground(image,cssX,cssY,scaleX,scaleY){
  const cx=Math.max(0,Math.min(image.width-1,Math.round(cssX*scaleX))),cy=Math.max(0,Math.min(image.height-1,Math.round(cssY*scaleY))),buckets=new Map();
  for(let y=Math.max(0,cy-4);y<=Math.min(image.height-1,cy+4);y++)for(let x=Math.max(0,cx-4);x<=Math.min(image.width-1,cx+4);x++){
    const at=y*image.stride+x*image.bytesPerPixel,rgb=[image.pixels[at],image.pixels[at+1],image.pixels[at+2]],key=rgb.map(v=>v>>3).join(",");
    const bucket=buckets.get(key)||{count:0,sums:[0,0,0]};bucket.count++;for(let i=0;i<3;i++)bucket.sums[i]+=rgb[i];buckets.set(key,bucket);
  }
  const best=[...buckets.values()].sort((a,b)=>b.count-a.count)[0];
  return best.sums.map(v=>Math.round(v/best.count));
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
const portals = ["Invitation","Meeting","Documents","Signature","Authorization","Finance","Procurement","Employees"];
const widths = [360,1440];
const browser = await chromium.launch({headless:true});
const failures=[];
await mkdir("artifacts/responsive-screenshots",{recursive:true});
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
      const metrics=await page.evaluate(()=>{
        const width=document.documentElement.clientWidth,scrollWidth=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);
        const parseColor=value=>{const m=value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/i);return m?{rgb:[+m[1],+m[2],+m[3]],a:m[4]===undefined?1:+m[4]}:null;};
        const overflowers=[];
        for(const el of [...document.querySelectorAll("body *")]){
          const r=el.getBoundingClientRect(),s=getComputedStyle(el),txt=(el.innerText||"").trim().replace(/\s+/g," ");
          if(r.width<=0||r.height<=0||s.display==="none"||s.visibility==="hidden")continue;
          if(r.right>width+1||r.left< -1)overflowers.push({tag:el.tagName.toLowerCase(),className:String(el.className||"").toString().slice(0,100),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),text:txt.slice(0,55)});
        }
        const contrastCandidates=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
        let textNode;
        while((textNode=walker.nextNode())){
          const txt=(textNode.nodeValue||"").replace(/\s+/g," ").trim();
          if(!txt)continue;
          const el=textNode.parentElement;if(!el)continue;
          const s=getComputedStyle(el);
          if(s.display==="none"||s.visibility==="hidden"||Number(s.opacity)===0)continue;
          const foreground=parseColor(s.webkitTextFillColor)||parseColor(s.color);if(!foreground)continue;
          const range=document.createRange();range.selectNodeContents(textNode);
          for(const rect of [...range.getClientRects()]){
            if(rect.width<=0||rect.height<=0)continue;
            const large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700);
            contrastCandidates.push({text:txt.slice(0,70),left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,foreground,large});
          }
        }
        return {width,scrollWidth,horizontalOverflow:scrollWidth>width+1,overflowExamples:overflowers.slice(0,8),contrastCandidates,heading:document.querySelector("h1")?.innerText||"",renderError:window.__portalFixtureError||null};
      });
      const screenshot=await page.screenshot({path:"artifacts/responsive-screenshots/"+portal.toLowerCase()+"-"+width+".png",fullPage:true});
      const renderedImage=decodePng(screenshot),scaleX=renderedImage.width/metrics.width,scaleY=scaleX,contrastFailures=[];
      for(const candidate of metrics.contrastCandidates){
        const x=candidate.left+Math.min(2,Math.max(.5,(candidate.right-candidate.left)/4));
        const y=candidate.top+Math.min(2,Math.max(.5,(candidate.bottom-candidate.top)/4));
        const background=sampleRenderedBackground(renderedImage,x,y,scaleX,scaleY),ratio=contrastRatio(candidate.foreground,background);
        if(ratio<(candidate.large?3:4.5))contrastFailures.push({text:candidate.text,ratio:Number(ratio.toFixed(2))});
      }
      metrics.contrastFailureCount=contrastFailures.length;
      metrics.contrastExamples=contrastFailures.slice(0,5);
      delete metrics.contrastCandidates;
      const row={portal,width,...metrics,pageErrors};
      console.log("PORTAL_VIEWPORT_AUDIT "+JSON.stringify(row));
      if(metrics.horizontalOverflow||metrics.contrastFailureCount>0||metrics.renderError||pageErrors.length)failures.push(row);
    } catch(e) { const row={portal,width,error:String(e?.message||e),pageErrors};console.log("PORTAL_VIEWPORT_AUDIT "+JSON.stringify(row));failures.push(row); }
    finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log("Portal viewport audit failed layout/render cases: "+failures.length);
if(failures.length)process.exitCode=1;
