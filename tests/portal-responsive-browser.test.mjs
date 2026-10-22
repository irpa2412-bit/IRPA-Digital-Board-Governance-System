import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

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
        const composite=(front,back)=>front.rgb.map((v,i)=>Math.round(v*front.a+back[i]*(1-front.a)));
        const luminance=color=>{const v=color.map(x=>{x/=255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;});return .2126*v[0]+.7152*v[1]+.0722*v[2];};
        const contrastFailures=[];
        const overflowers=[];
        for(const el of [...document.querySelectorAll("body *")]){
          const r=el.getBoundingClientRect(),s=getComputedStyle(el),txt=(el.innerText||"").trim().replace(/\s+/g," ");
          if(r.width<=0||r.height<=0||s.display==="none"||s.visibility==="hidden"||el.closest("[data-fixture-chrome]"))continue;
          if(r.right>width+1||r.left< -1)overflowers.push({tag:el.tagName.toLowerCase(),className:String(el.className||"").toString().slice(0,100),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),text:txt.slice(0,55)});
          if(!txt||txt.length>180)continue;
          const chain=[];let node=el;while(node){chain.push(node);node=node.parentElement;}chain.reverse();
          const ancestorStyles=chain.map(ancestor=>{
            const ancestorStyle=getComputedStyle(ancestor);
            return {
              element:ancestor.tagName.toLowerCase(),
              id:ancestor.id||null,
              className:typeof ancestor.className==="string"?ancestor.className:null,
              backgroundColor:ancestorStyle.backgroundColor,
              backgroundImage:ancestorStyle.backgroundImage
            };
          });
          let bg=[255,255,255];
          for(const ancestor of chain){const c=parseColor(getComputedStyle(ancestor).backgroundColor);if(c)bg=composite(c,bg);}
          const fgParsed=parseColor(s.color);if(!fgParsed)continue;
          const fg=composite(fgParsed,bg),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
          const large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700);
          if(ratio<(large?3:4.5))contrastFailures.push({
            text:txt.slice(0,70),
            ratio:Number(ratio.toFixed(2)),
            computedColor:s.color,
            boundingBox:{x:Number(r.x.toFixed(2)),y:Number(r.y.toFixed(2)),width:Number(r.width.toFixed(2)),height:Number(r.height.toFixed(2)),top:Number(r.top.toFixed(2)),right:Number(r.right.toFixed(2)),bottom:Number(r.bottom.toFixed(2)),left:Number(r.left.toFixed(2))},
            ancestors:ancestorStyles
          });
        }
        return {width,scrollWidth,horizontalOverflow:scrollWidth>width+1,overflowExamples:overflowers.slice(0,8),contrastFailureCount:contrastFailures.length,contrastExamples:contrastFailures.slice(0,5),heading:document.querySelector("h1")?.innerText||"",renderError:window.__portalFixtureError||null};
      });
      await page.screenshot({path:"artifacts/responsive-screenshots/"+portal.toLowerCase()+"-"+width+".png",fullPage:true});
      const row={portal,width,...metrics,pageErrors};
      console.log("PORTAL_VIEWPORT_AUDIT "+JSON.stringify(row));
      if(metrics.horizontalOverflow||metrics.contrastFailureCount>0||metrics.renderError||pageErrors.length)failures.push(row);
    } catch(e) { const row={portal,width,error:String(e?.message||e),pageErrors};console.log("PORTAL_VIEWPORT_AUDIT "+JSON.stringify(row));failures.push(row); }
    finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log("Portal viewport audit failed layout/render cases: "+failures.length);
if(failures.length)process.exitCode=1;
