import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import postcss from "postcss";
import { chromium } from "playwright";

const root = process.cwd();
const cssDir = path.join(root, "src", "styles");
const distDir = path.join(root, "dist", "assets");
const cssName = fs.readdirSync(distDir).find((name) => /^index-.*\.css$/.test(name));
assert.ok(cssName, "Built production stylesheet is missing");
const cssText = fs.readFileSync(path.join(distDir, cssName), "utf8");
const props = new Set(["display","align-self","align-items","height","min-height","max-height","margin","margin-top","margin-bottom","padding","padding-top","padding-bottom","width","min-width","max-width","position","inset","transform","flex","flex-basis","grid-template-columns","grid-template-rows","grid-template-areas","grid-column","grid-row","gap","row-gap","column-gap","overflow","order","justify-self","justify-content","align-content"]);
const match = /(?:\.topbar\b|\.dashboard-topbar\b|\.topbar-heading-row\b|\.topbar-title-block\b|\.topbar-access-category\b|\.google-weather-panel\b|\.live-weather-)/;
function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):e.isFile()&&e.name.endsWith(".css")?[path.join(dir,e.name)]:[]); }
console.log("=== ALL RELEVANT SOURCE CSS RULES ===");
for (const file of files(cssDir)) {
  const ast = postcss.parse(fs.readFileSync(file,"utf8"),{from:file});
  ast.walkRules(rule=>{
    if(!match.test(rule.selector)) return;
    const declarations=[];
    rule.walkDecls(d=>{if(props.has(d.prop.toLowerCase()))declarations.push(d.prop+":"+d.value+(d.important?" !important":""));});
    if(declarations.length)console.log(path.relative(root,file)+":"+rule.source.start.line+" "+rule.selector.replace(/\s+/g," ")+" { "+declarations.join("; ")+" }");
  });
}
const indexText=fs.readFileSync(path.join(root,"index.html"),"utf8");
assert.equal(fs.existsSync(path.join(root,"public","dashboard-hero-fix.js")),false,"Legacy hero-mutating JavaScript still exists");
assert.equal(indexText.includes("dashboard-hero-fix.js"),false,"index.html still loads the legacy hero mutator");
console.log("=== RUNTIME MUTATION CHECK ===\nLegacy public/dashboard-hero-fix.js: deleted\nindex.html reference: absent\nHero inline dimensions: none in the Dashboard heading/weather/access markup");

const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+cssText+'</style></head><body><div id="root"><div class="app-shell" style="position:relative;width:1440px;min-height:520px"><aside class="sidebar" style="position:absolute;left:0;top:0;width:320px;height:520px"></aside><section class="main-area" style="margin-left:320px;width:1120px;min-height:520px"><div class="desktop-webapp-navigation-roller"><div class="webapp-navigation-live-clock"><strong>Monday</strong><span>12 October 2026</span><b>09:36:00</b></div><span class="webapp-navigation-roller-kicker">IN-PORTAL NAVIGATION</span><strong>Dashboard</strong><select><option>Dashboard</option></select></div><nav class="page-back-next-navigation"><button>Back</button><div class="page-back-next-status"><span>PAGE NAVIGATION</span><strong>Dashboard</strong><small>1 of 20</small></div><button>Next</button></nav><header class="topbar dashboard-topbar"><div class="topbar-heading-row"><div class="topbar-title-block"><span class="topbar-kicker">IMPROVEMENT OF RANGELAND IN PASTORAL AREAS</span><div class="topbar-title-line"><h2>Dashboard</h2></div><p>Digital Board Governance Workspace</p></div><div class="topbar-access-category"><span class="login-category-heading">AUTHORIZED USER · ACCESS CATEGORIES</span><div class="login-category-list"><span class="login-category-pill">Board Governance</span><span class="login-category-pill">Executive Management</span></div><p class="login-category-note">Authorized access for this workspace.</p><p class="login-category-explanation">The Capacity panel.</p></div><section class="open-portal-panel google-weather-panel" aria-label="Live multi-location weather forecast"><span>LIVE WEATHER ☁️</span><div class="live-weather-content" aria-live="polite"><div class="live-weather-location-bar"><div class="live-weather-location-name"><strong>Longido</strong><span>🌤️ 24°C · Partly cloudy</span></div><div class="live-weather-location-controls"><button aria-label="Previous weather location">‹</button><button aria-label="Next weather location">›</button><button class="live-weather-expand">Forecast</button></div></div><div class="live-weather-current"><div class="live-weather-current-main"><span class="live-weather-icon">🌤️</span><div><strong>24°C</strong><small>Partly cloudy · feels like 25°C</small></div></div><div class="live-weather-metrics"><span>💧 Humidity <b>46%</b></span><span>💨 Wind <b>12 km/h</b></span><span>🌧️ Rain chance <b>10%</b></span></div></div><div class="live-weather-days"><div class="live-weather-day"><strong>Today</strong><span class="live-weather-day-icon">🌤️</span><b>26° / 17°</b><small>Partly cloudy</small><small>Rain 10%</small></div><div class="live-weather-day"><strong>Tue, 13 Oct</strong><span class="live-weather-day-icon">☀️</span><b>27° / 17°</b><small>Mostly sunny</small><small>Rain 5%</small></div><div class="live-weather-day"><strong>Wed, 14 Oct</strong><span class="live-weather-day-icon">🌦️</span><b>25° / 16°</b><small>Light showers</small><small>Rain 35%</small></div></div><div class="live-weather-attribution"><span>LIVE FORECAST</span><small>Updated 12 Oct 2026, 09:35 · refreshes every 15 minutes · location rolls every 8 seconds</small></div></div></section></div></header></section></div></div></body></html>';
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
await page.setContent(html,{waitUntil:"domcontentloaded"});
await page.waitForTimeout(100);
const legacyCSS=[
'html body #root .app-shell .main-area > header.topbar.dashboard-topbar:has(> .topbar-heading-row > .google-weather-panel) > .topbar-heading-row{display:grid!important;grid-template-columns:minmax(200px,260px) minmax(0,1fr) 250px!important;grid-template-areas:"title weather authority"!important;align-items:center!important;column-gap:0!important}',
'html body #root .app-shell .main-area > header.topbar.dashboard-topbar:has(> .topbar-heading-row > .google-weather-panel) > .topbar-heading-row > .topbar-title-block{grid-area:title!important;align-self:center!important;max-width:260px!important}',
'html body #root .app-shell .main-area > header.topbar.dashboard-topbar:has(> .topbar-heading-row > .google-weather-panel) > .topbar-heading-row > .google-weather-panel{display:grid!important;grid-template-columns:minmax(110px,.8fr) repeat(3,minmax(0,1fr))!important;grid-template-rows:22px 32px 56px 12px!important;max-height:145px!important;min-height:0!important;align-self:center!important}',
'html body #root .app-shell .main-area > header.topbar.dashboard-topbar:has(> .topbar-heading-row > .google-weather-panel) > .topbar-heading-row > .google-weather-panel .live-weather-content,html body #root .app-shell .main-area > header.topbar.dashboard-topbar:has(> .topbar-heading-row > .google-weather-panel) > .topbar-heading-row > .google-weather-panel .live-weather-current{display:contents!important}',
'html body #root .app-shell .main-area > header.topbar.dashboard-topbar:has(> .topbar-heading-row > .google-weather-panel) > .topbar-heading-row > .google-weather-panel .live-weather-location-bar{grid-column:2/-1!important;grid-row:1!important;height:22px!important}',
'html body #root .app-shell .main-area > header.topbar.dashboard-topbar:has(> .topbar-heading-row > .google-weather-panel) > .topbar-heading-row > .google-weather-panel .live-weather-current-main{grid-column:1/3!important;grid-row:2!important;height:32px!important;max-height:32px!important}',
'html body #root .app-shell .main-area > header.topbar.dashboard-topbar:has(> .topbar-heading-row > .google-weather-panel) > .topbar-heading-row > .google-weather-panel .live-weather-metrics{grid-column:3/-1!important;grid-row:2!important;height:32px!important;max-height:32px!important}',
'html body #root .app-shell .main-area > header.topbar.dashboard-topbar:has(> .topbar-heading-row > .google-weather-panel) > .topbar-heading-row > .google-weather-panel .live-weather-days{grid-column:1/-1!important;grid-row:3!important;grid-auto-flow:column!important;grid-auto-columns:minmax(110px,1fr)!important;grid-template-columns:none!important;height:56px!important;max-height:56px!important;overflow-x:auto!important}',
'[data-irpa-hero]{display:flex!important;flex-direction:row!important;align-items:stretch!important;gap:0!important;flex-wrap:nowrap!important}',
'[data-irpa-title]{flex:0 0 auto!important;max-width:28%!important;margin-right:16px!important;align-self:center!important}',
'[data-irpa-weather]{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;align-content:center!important;align-items:center!important;gap:10px 24px!important;padding:14px 18px!important;min-height:0!important;height:auto!important}',
'[data-irpa-weather] > *{flex:1 1 auto!important;min-width:0!important}',
'[data-irpa-access]{flex:0 0 300px!important;width:300px!important;max-width:300px!important;margin:0!important}'
].join("\n");
for(const [sel,attr] of [[".topbar-heading-row","data-irpa-hero"],[".topbar-title-block","data-irpa-title"],[".google-weather-panel","data-irpa-weather"],[".topbar-access-category","data-irpa-access"]])await page.locator(sel).evaluate((el,a)=>el.setAttribute(a,""),attr);
const legacyTag=await page.addStyleTag({content:legacyCSS});
async function measure(label){
 const result=await page.evaluate(label=>{
  const selectors={hero:".topbar.dashboard-topbar",heading:".topbar-title-block",weather:".google-weather-panel",innerWrapper:".live-weather-content",locationTitleControls:".live-weather-location-bar",currentTemperature:".live-weather-current-main",humidityWindRain:".live-weather-metrics",forecastRow:".live-weather-days",forecastDay1:".live-weather-day:nth-child(1)",forecastDay2:".live-weather-day:nth-child(2)",forecastDay3:".live-weather-day:nth-child(3)",access:".topbar-access-category"};
  const records={};for(const [key,selector] of Object.entries(selectors)){const el=document.querySelector(selector);if(!el){records[key]={selector,missing:true};continue;}const s=getComputedStyle(el),b=el.getBoundingClientRect();records[key]={selector,display:s.display,alignSelf:s.alignSelf,alignItems:s.alignItems,height:s.height,minHeight:s.minHeight,maxHeight:s.maxHeight,margin:s.margin,padding:s.padding,box:{top:+b.top.toFixed(2),left:+b.left.toFixed(2),width:+b.width.toFixed(2),height:+b.height.toFixed(2)}};}return{label,viewport:{width:innerWidth,height:innerHeight},records};
 },label);console.log("=== "+label.toUpperCase()+" MEASUREMENTS ===");console.log(JSON.stringify(result,null,2));return result;
}
await measure("before (legacy overrides reproduced)");
await legacyTag.evaluate(el=>el.remove());
for(const [sel,attr] of [[".topbar-heading-row","data-irpa-hero"],[".topbar-title-block","data-irpa-title"],[".google-weather-panel","data-irpa-weather"],[".topbar-access-category","data-irpa-access"]])await page.locator(sel).evaluate((el,a)=>el.removeAttribute(a),attr);
await page.waitForTimeout(50);
const after=await measure("after (current source CSS)");
const h=after.records.hero.box,t=after.records.heading.box,w=after.records.weather.box,f=after.records.forecastRow.box;
const days=[after.records.forecastDay1.box,after.records.forecastDay2.box,after.records.forecastDay3.box];
const gap=+(w.left-(t.left+t.width)).toFixed(2),widthSpread=+(Math.max(...days.map(d=>d.width))-Math.min(...days.map(d=>d.width))).toFixed(2),dayHeightError=+Math.max(...days.map(d=>Math.abs(d.height-f.height))).toFixed(2);
const checks={headingTopWithin12px:Math.abs(t.top-h.top)<=12,weatherTopMatchesHeading:Math.abs(w.top-t.top)<=1,weatherHeightAtLeast90PercentHero:w.height>=h.height*.9,weatherStarts12pxAfterHeading:Math.abs(gap-12)<=1.5,forecastWidthsEqual:widthSpread<=1,forecastPanesFillRow:dayHeightError<=1.5};
console.log("=== DESKTOP ACCEPTANCE CHECKS ===");console.log(JSON.stringify({heroHeight:h.height,headingTopOffset:+(t.top-h.top).toFixed(2),weatherTopDelta:+(w.top-t.top).toFixed(2),weatherHeightRatio:+(w.height/h.height).toFixed(3),headingWeatherGap:gap,forecastWidths:days.map(d=>d.width),forecastWidthSpread:widthSpread,forecastRowHeight:f.height,forecastPaneHeights:days.map(d=>d.height),dayHeightError,checks},null,2));
assert.ok(Object.values(checks).every(Boolean),"Dashboard hero desktop layout acceptance check failed");
await page.locator(".topbar.dashboard-topbar").screenshot({path:path.join(root,"dashboard-hero-check.png")});console.log("Screenshot saved: dashboard-hero-check.png");
// Acceptance criteria for this task are the requested 1440px desktop measurements.
await browser.close();
