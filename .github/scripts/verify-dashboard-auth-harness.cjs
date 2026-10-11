const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const prodUrl = process.env.TARGET_URL || "https://irpa-digital-board-governance.web.app";
const localUrl = process.env.LOCAL_TEST_URL || "http://127.0.0.1:4173/hero-test.html";
const out = path.resolve("hero-layout-evidence"); fs.mkdirSync(out,{recursive:true});
const report = { testedAt:new Date().toISOString(), production:{url:prodUrl,cache:{},consoleErrors:[],pageErrors:[]}, isolatedHarness:{url:localUrl,viewports:[],interactions:{},consoleErrors:[],pageErrors:[],blockedMutations:[]}, screenshots:[] };
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try {
  const prod=await browser.newPage({viewport:{width:1366,height:768}});
  prod.on("console",m=>{if(m.type()==="error")report.production.consoleErrors.push(m.text())});
  prod.on("pageerror",e=>report.production.pageErrors.push(String(e)));
  const pr=await prod.goto(prodUrl,{waitUntil:"domcontentloaded",timeout:60000}); report.production.httpStatus=pr?.status();
  await prod.waitForTimeout(1800);
  const html=await prod.content();
  report.production.cache.htmlHasRequestedToken=html.includes("20261011-hero-weather-landscape-16")||/20261011-hero-weather-landscape-(1[6-9]|[2-9]\d)/.test(html);
  report.production.cache.htmlScriptAssets=await prod.locator("script[src]").evaluateAll(es=>es.map(e=>e.getAttribute("src")));
  report.production.cache.htmlStylesheetAssets=await prod.locator('link[rel="stylesheet"]').evaluateAll(es=>es.map(e=>e.getAttribute("href")));
  try {const sw=await prod.request.get(new URL("/sw.js",prodUrl).toString(),{timeout:20000});const txt=await sw.text();report.production.cache.swHttpStatus=sw.status();report.production.cache.serviceWorkerVersion=txt.match(/CACHE_NAME\s*=\s*["']([^"']+)/)?.[1]||null;}catch(e){report.production.cache.swError=String(e)}
  report.production.cache.assets=[];
  for(const u of [...report.production.cache.htmlScriptAssets,...report.production.cache.htmlStylesheetAssets].filter(Boolean)){
   try{const r=await prod.request.get(new URL(u,prodUrl).toString(),{timeout:20000});const t=await r.text();report.production.cache.assets.push({url:u,status:r.status(),bytes:t.length,containsRequestedToken:t.includes("20261011-hero-weather-landscape-16"),containsWeatherBlue:t.includes("#2563eb")||t.includes("37, 99, 235")||t.includes("37,99,235")});}catch(e){report.production.cache.assets.push({url:u,error:String(e)})}
  }
  report.production.dashboardAuthenticated=await prod.locator(".google-weather-panel").count()>0&&await prod.locator(".topbar-access-category").count()>0;
  if(!report.production.dashboardAuthenticated){
   report.production.blocker="Production remains authentication-gated. Visual testing continues in a local isolated render of the actual Shell component using a synthetic test-only identity.";
   for(const vp of [{width:1366,height:768},{width:1920,height:1080}]){await prod.setViewportSize(vp);const shot=path.join(out,"production-auth-"+vp.width+"x"+vp.height+".png");await prod.screenshot({path:shot,fullPage:true});report.screenshots.push(shot)}
  }
  const page=await browser.newPage({viewport:{width:1366,height:768},deviceScaleFactor:1});
  page.on("console",m=>{if(m.type()==="error")report.isolatedHarness.consoleErrors.push(m.text())});
  page.on("pageerror",e=>report.isolatedHarness.pageErrors.push(String(e)));
  await page.route("**/*",async route=>{
   const req=route.request(),u=new URL(req.url()),method=req.method().toUpperCase();
   const cloudMutationHost=/firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|cloudfunctions\.net|firebaseio\.com/.test(u.hostname);
   const readOnlyRpc=/:(runQuery|batchGet|listCollectionIds)$/.test(u.pathname)||/\/Listen\/channel$/.test(u.pathname);
   const mutation=cloudMutationHost&&["POST","PUT","PATCH","DELETE"].includes(method)&&!readOnlyRpc;
   if(mutation){report.isolatedHarness.blockedMutations.push({method,url:req.url()});await route.abort("blockedbyclient");return}
   await route.continue();
  });
  const lr=await page.goto(localUrl,{waitUntil:"domcontentloaded",timeout:60000});report.isolatedHarness.httpStatus=lr?.status();
  await page.waitForSelector(".google-weather-panel",{timeout:30000});
  await page.waitForTimeout(4500);
  report.isolatedHarness.syntheticIdentity="Board Member test-only identity; no real account, token, or server authorization is used.";
  const measure=async()=>page.evaluate(()=>{
   const b=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
   const st=e=>{const s=getComputedStyle(e);return{color:s.color,backgroundColor:s.backgroundColor,borderColor:s.borderColor,boxShadow:s.boxShadow,display:s.display,gridTemplateColumns:s.gridTemplateColumns}};
   const w=document.querySelector(".google-weather-panel"),a=document.querySelector(".topbar-access-category"),h=document.querySelector("header.dashboard-topbar"),t=document.querySelector(".topbar-title-block"),m=[...document.querySelectorAll(".live-weather-metrics>span")],strip=document.querySelector(".live-weather-days");
   return{viewport:{width:innerWidth,height:innerHeight},weather:b(w),weatherStyle:st(w),access:b(a),accessStyle:st(a),accessHeadingColor:a.querySelector(".login-category-heading")?getComputedStyle(a.querySelector(".login-category-heading")).color:null,accessPillColor:a.querySelector(".login-category-pill")?getComputedStyle(a.querySelector(".login-category-pill")).color:null,title:b(t),bannerHeight:b(h).height,gapWeatherToAccess:b(a).x-b(w).right,weatherWidthToHeightRatio:b(w).height?b(w).width/b(w).height:null,metrics:m.map(e=>({text:e.innerText,top:e.getBoundingClientRect().top,box:b(e),color:getComputedStyle(e).color})),accessText:[...a.querySelectorAll("span,strong,small,p")].map(e=>({text:(e.innerText||"").trim(),color:getComputedStyle(e).color})).filter(e=>e.text),weatherTextColors:[...w.querySelectorAll("span,strong,small,b,button")].map(e=>({text:(e.innerText||"").trim(),color:getComputedStyle(e).color})).filter(e=>e.text).slice(0,35),city:document.querySelector(".live-weather-location-name strong")?.innerText||null,cityColor:document.querySelector(".live-weather-location-name strong")?getComputedStyle(document.querySelector(".live-weather-location-name strong")).color:null,forecast:[...document.querySelectorAll(".live-weather-day")].map((e,i)=>({index:i,text:e.innerText,box:b(e),fullyVisible:!!strip&&e.getBoundingClientRect().left>=strip.getBoundingClientRect().left-1&&e.getBoundingClientRect().right<=strip.getBoundingClientRect().right+1,clipped:!!strip&&e.getBoundingClientRect().right>strip.getBoundingClientRect().right+1})),forecastStrip:strip?{box:b(strip),scrollWidth:strip.scrollWidth,clientWidth:strip.clientWidth,overflowX:getComputedStyle(strip).overflowX}:null};
  });
  for(const vp of [{width:1366,height:768},{width:1920,height:1080}]){
   await page.setViewportSize(vp);await page.waitForTimeout(500);
   const forecastButton=page.getByRole("button",{name:/^(Forecast|Less)$/}).first();
   if(await forecastButton.count()&&(await forecastButton.innerText()).trim()!=="Less")await forecastButton.click();
   await page.waitForTimeout(400);
   const metrics=await measure();
   const shot=path.join(out,"dashboard-"+vp.width+"x"+vp.height+".png");await page.screenshot({path:shot,fullPage:true});report.screenshots.push(shot);
   report.isolatedHarness.viewports.push({...metrics,screenshot:shot});
  }
  const fb=page.getByRole("button",{name:/^(Forecast|Less)$/}).first();
  if(await fb.count()){const before=(await fb.innerText()).trim();await fb.click();const after=(await fb.innerText()).trim();report.isolatedHarness.interactions.forecastToggle={before,after,passed:before!==after};}else report.isolatedHarness.interactions.forecastToggle={passed:false,reason:"Forecast control not found"};
  const city=page.locator(".live-weather-location-name strong").first();
  if(await city.count()){
   const before=await city.innerText();const next=page.getByRole("button",{name:"Next weather location"});if(await next.count()){await next.click();await page.waitForTimeout(200);const after=await city.innerText();report.isolatedHarness.interactions.weatherNext={before,after,passed:before!==after};}
   const prev=page.getByRole("button",{name:"Previous weather location"});if(await prev.count()){const beforePrev=await city.innerText();await prev.click();await page.waitForTimeout(200);const afterPrev=await city.innerText();report.isolatedHarness.interactions.weatherPrevious={before:beforePrev,after:afterPrev,passed:beforePrev!==afterPrev};}
   const rotateBefore=await city.innerText();await page.waitForTimeout(8300);const rotateAfter=await city.innerText();report.isolatedHarness.interactions.weatherLiveRotation={before:rotateBefore,after:rotateAfter,passed:rotateBefore!==rotateAfter};
  }
  const recoveryCount=await page.getByText("SESSION RECOVERY AVAILABLE",{exact:true}).count();
  report.isolatedHarness.interactions.sessionRecovery={visible:recoveryCount>0,passed:recoveryCount>0};
  const navBefore=await page.locator(".page-back-next-status strong").innerText().catch(()=>null);
  const nextNav=page.getByRole("button",{name:/^Next to /}).first();
  if(await nextNav.count()){await nextNav.click();await page.waitForTimeout(250);const navAfter=await page.locator(".page-back-next-status strong").innerText().catch(()=>null);report.isolatedHarness.interactions.navigationNext={before:navBefore,after:navAfter,passed:!!navAfter&&navAfter!==navBefore};const back=page.getByRole("button",{name:/^Back to /}).first();if(await back.count()){await back.click();await page.waitForTimeout(250);const backAfter=await page.locator(".page-back-next-status strong").innerText().catch(()=>null);report.isolatedHarness.interactions.navigationBack={expected:navBefore,actual:backAfter,passed:backAfter===navBefore};}}
  const meetings=page.locator(".sidebar .nav-item").filter({hasText:"Meeting Portal"}).first();
  if(await meetings.count()){await meetings.click();await page.waitForTimeout(250);const sel=page.getByLabel("Navigate to a sub-portal within the current portal");const opts=await sel.locator("option").evaluateAll(os=>os.map(o=>({value:o.value,text:o.textContent})));report.isolatedHarness.interactions.pageSelector={found:true,options:opts.map(o=>o.value)};const option=opts.find(o=>o.value==="Meeting Room");if(option){await sel.selectOption(option.value);await page.waitForTimeout(300);report.isolatedHarness.interactions.pageSelector.selected=await sel.inputValue();report.isolatedHarness.interactions.pageSelector.passed=report.isolatedHarness.interactions.pageSelector.selected==="Meeting Room";}}else report.isolatedHarness.interactions.pageSelector={found:false,passed:false};
  report.isolatedHarness.failures=[];
  for(const v of report.isolatedHarness.viewports){
   const a=v;
   if(a.weather.width<2.5*a.weather.height)report.isolatedHarness.failures.push(v.viewport.width+"x"+v.viewport.height+": weather width/height ratio "+(a.weather.width/a.weather.height));
   if(Math.abs(a.gapWeatherToAccess)>1)report.isolatedHarness.failures.push(v.viewport.width+"x"+v.viewport.height+": weather/access gap "+a.gapWeatherToAccess+"px");
   if(a.bannerHeight>300)report.isolatedHarness.failures.push(v.viewport.width+"x"+v.viewport.height+": banner height "+a.bannerHeight+"px");
   const tops=a.metrics.map(m=>m.top);if(tops.length>=3&&Math.max(...tops)-Math.min(...tops)>1)report.isolatedHarness.failures.push(v.viewport.width+"x"+v.viewport.height+": humidity/wind/rain top spread "+(Math.max(...tops)-Math.min(...tops))+"px");
   if(a.accessHeadingColor!=="rgb(231, 244, 238)")report.isolatedHarness.failures.push(v.viewport.width+"x"+v.viewport.height+": access heading colour "+a.accessHeadingColor);
   if(a.accessPillColor!=="rgb(247, 207, 97)")report.isolatedHarness.failures.push(v.viewport.width+"x"+v.viewport.height+": access category colour "+a.accessPillColor);
   if(a.cityColor!=="rgb(37, 99, 235)")report.isolatedHarness.failures.push(v.viewport.width+"x"+v.viewport.height+": weather city text color "+a.cityColor);
   if(!a.forecast.length)report.isolatedHarness.failures.push(v.viewport.width+"x"+v.viewport.height+": no forecast items rendered");
   if(a.forecast.some(f=>!f.fullyVisible))report.isolatedHarness.failures.push(v.viewport.width+"x"+v.viewport.height+": forecast item(s) clipped: "+a.forecast.filter(f=>!f.fullyVisible).map(f=>f.index).join(","));
  }
  for(const [name,val] of Object.entries(report.isolatedHarness.interactions)){if(val&&val.passed===false)report.isolatedHarness.failures.push("Interaction failed: "+name)}
  fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
  console.log("IRPA_AUTH_HARNESS_REPORT_BEGIN");console.log(JSON.stringify(report,null,2));console.log("IRPA_AUTH_HARNESS_REPORT_END");
  if(report.isolatedHarness.failures.length)process.exitCode=1;
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
