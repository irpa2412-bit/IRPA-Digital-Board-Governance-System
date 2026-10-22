import { test, expect } from "@playwright/test";

const fixtureEmail = "irpa-browser-fixture-admin@example.test";
const fixturePassword = "FixtureOnly-Password-2026!";

async function navigateModule(page, viewportName, module) {
  if (viewportName === "mobile") {
    if (["Meeting Room", "Voting", "Resolutions", "Decisions"].includes(module)) {
      // The mobile connected-workflow strip is intentionally hidden; verify each authorized destination directly.
      await page.goto("/?adminModule=" + encodeURIComponent(module));
      await expect(page.locator(".topbar h2")).toContainText(module, { timeout: 30000 });
    } else if (module === "Finance Portfolio" || module === "Documents") {
      const dialog = page.getByRole("dialog", { name: "Mobile navigation" });
      const sheetTitle = dialog.locator(".mobile-nav-sheet-header strong");
      const isPortalsSheet = await dialog.isVisible() && await sheetTitle.textContent() === "Portals";
      if (!isPortalsSheet) {
        await page.locator(".mobile-global-nav").getByRole("button", { name: "Portals" }).click();
      }
      await expect(sheetTitle).toHaveText("Portals");
      const label = module === "Finance Portfolio" ? /Finance Portal/ : /Documents Portal/;
      await dialog.getByRole("button", { name: label }).click();
    } else {
      await page.locator(".mobile-global-nav").getByRole("button", { name: "Menu" }).click();
      const dialog = page.getByRole("dialog", { name: "Mobile navigation" });
      await expect(dialog.locator(".mobile-nav-sheet-header strong")).toHaveText("Navigation");
      await dialog.getByRole("button", { name: /Grant Intelligence.*Funding Opportunities/ }).click();
    }
  } else {
    const sidebar = page.locator(".sidebar");
    if (["Meeting Room", "Voting", "Resolutions", "Decisions"].includes(module)) {
      // Child portal buttons are rendered after opening their parent in the sidebar.
      await sidebar.getByRole("button", { name: /Meeting Portal/ }).click();
      const childLabel = {
        "Meeting Room": /SUB-PORTAL.*Meeting Room Portal/,
        "Voting": /SUB-PORTAL.*Voting Portal/,
        "Resolutions": /SUB-PORTAL.*Resolutions Portal/,
        "Decisions": /SUB-PORTAL.*Decisions Portal/
      }[module];
      await sidebar.getByRole("button", { name: childLabel }).click();
    } else {
      const label = module === "Finance Portfolio" ? /Finance Portal|Finance Portfolio/ :
        module === "Documents" ? /Documents Portal|Documents/ :
        module === "Voting" ? /Voting Portal|Voting/ :
        /Grant Intelligence.*Funding Opportunities/;
      await sidebar.getByRole("button", { name: label }).first().click();
    }
  }
  if (module === "Documents") {
    const entryGate = page.locator("[data-irpa-field-gate]");
    // The field gate is a one-time session confirmation; do not require it to reappear on return navigation.
    if (await entryGate.count()) {
      await expect(entryGate).toBeVisible({ timeout: 15000 });
      await entryGate.getByRole("radio", { name: /Documents, correspondence and files/ }).check();
      await entryGate.getByRole("radio", { name: /Trial data/ }).check();
      await entryGate.getByRole("button", { name: "Confirm environment and continue" }).click();
      await expect(entryGate).toHaveCount(0);
    }
  }
}

async function evaluateVisibleWorkflowControls(page, expectedText) {
  const selector = ".module-interlink-bar button:visible";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.locator(selector).evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return {
          label: (node.innerText || node.getAttribute("aria-label") || "").trim(),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight
        };
      }));
    } catch (error) {
      const navigationRace = /Execution context was destroyed|Cannot find context with specified id/i.test(String(error));
      if (!navigationRace || attempt === 2) throw error;
      // A portal transition can replace the document between layout assertions and inspection.
      // Wait for that navigation to settle, then reassert the intended destination before retrying.
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      await expect(page.locator(".topbar h2")).toContainText(expectedText, { timeout: 30000 });
    }
  }
  throw new Error("Unable to inspect workflow controls after navigation retries.");
}

async function assertPortalAndNoOverflow(page, expectedText, width) {
  await expect(page.locator(".topbar h2")).toContainText(expectedText, { timeout: 30000 });
  const workspace = page.locator("[data-active-portal-content]:visible").first();
  await expect(workspace).toBeVisible();
  await expect(workspace, "navigation must focus the destination portal body, not the shared header").toBeFocused();
  await expect.poll(
    () => workspace.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const header = document.querySelector(".main-area > header.topbar");
      return rect.top - (header?.getBoundingClientRect().bottom || 0);
    }),
    { message: "destination portal body should be aligned directly below the shared header", timeout: 10000 }
  ).toBeGreaterThanOrEqual(-2);
  const destination = await workspace.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const header = document.querySelector(".main-area > header.topbar");
    return { top: rect.top, headerBottom: header?.getBoundingClientRect().bottom || 0, viewportHeight: window.innerHeight };
  });
  expect(destination.top, "destination content must be brought into the viewport rather than leaving the header as the focus target").toBeLessThan(destination.viewportHeight);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(dimensions.document, "unexpected horizontal page overflow").toBeLessThanOrEqual(dimensions.viewport + 1);
  const controls = await evaluateVisibleWorkflowControls(page, expectedText);
  for (const control of controls) {
    expect(control.width, `zero-width workflow control: ${control.label}`).toBeGreaterThan(0);
    expect(control.left, `workflow control left edge outside viewport: ${control.label}`).toBeGreaterThanOrEqual(-1);
    expect(control.right, `workflow control right edge outside viewport: ${control.label}`).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(control.scrollWidth, `clipped horizontal label: ${control.label}`).toBeLessThanOrEqual(control.clientWidth + 1);
    expect(control.scrollHeight, `clipped vertical label: ${control.label}`).toBeLessThanOrEqual(control.clientHeight + 1);
  }
}

async function assertStickyPortalNavigation(page) {
  const initial = await page.evaluate(() => {
    const roller = document.querySelector(".main-area > .desktop-webapp-navigation-roller");
    const nav = document.querySelector(".main-area > .page-back-next-navigation");
    if (!roller || !nav) return { missing: true };
    const rollerStyle = getComputedStyle(roller);
    const navStyle = getComputedStyle(nav);
    return {
      missing: false,
      rollerDisplay: rollerStyle.display,
      rollerPosition: rollerStyle.position,
      navPosition: navStyle.position,
      rollerTop: roller.getBoundingClientRect().top,
      rollerBottom: roller.getBoundingClientRect().bottom,
      rollerMarginBottom: parseFloat(rollerStyle.marginBottom || "0"),
      navTop: nav.getBoundingClientRect().top
    };
  });
  expect(initial.missing, "authenticated portal must render both label panel and Back/Next").toBe(false);
  expect(initial.rollerDisplay, "portal label panel must be visible on mobile and desktop").not.toBe("none");
  expect(initial.rollerPosition, "portal label panel must remain sticky").toBe("sticky");
  expect(initial.navPosition, "Back/Next must use sticky positioning, not a guessed fixed offset").toBe("sticky");
  expect(Math.abs(initial.navTop - (initial.rollerBottom + initial.rollerMarginBottom)),
    "Back/Next must sit immediately beneath the actual portal label panel").toBeLessThanOrEqual(3);

  await page.evaluate(() => {
    const main = document.querySelector(".app-shell .main-area");
    window.scrollTo(0, window.scrollY + (main?.getBoundingClientRect().top || 0));
  });
  await page.waitForTimeout(60);
  await page.evaluate(() => window.scrollBy(0, 260));
  await page.waitForTimeout(100);
  const scrolled = await page.evaluate(() => {
    const roller = document.querySelector(".main-area > .desktop-webapp-navigation-roller");
    const nav = document.querySelector(".main-area > .page-back-next-navigation");
    const rollerStyle = getComputedStyle(roller);
    return {
      rollerTop: roller.getBoundingClientRect().top,
      rollerBottom: roller.getBoundingClientRect().bottom,
      rollerMarginBottom: parseFloat(rollerStyle.marginBottom || "0"),
      navTop: nav.getBoundingClientRect().top,
      rollerPosition: rollerStyle.position,
      mainTop: roller.closest(".main-area").getBoundingClientRect().top,
      windowScrollY: window.scrollY,
      viewportWidth: window.innerWidth,
      sidebarDisplay: document.querySelector(".sidebar") ? getComputedStyle(document.querySelector(".sidebar")).display : "missing",
      sidebarTop: document.querySelector(".sidebar")?.getBoundingClientRect().top ?? null,
      sidebarHeight: document.querySelector(".sidebar")?.getBoundingClientRect().height ?? null,
      htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
      bodyOverflowX: getComputedStyle(document.body).overflowX,
      rootOverflowX: getComputedStyle(document.querySelector("#root")).overflowX
    };
  });
  console.log("STICKY_NAV_DIAGNOSTIC", JSON.stringify(scrolled));
  expect(Math.abs(scrolled.rollerTop), "portal label panel must stay at the viewport top while scrolling").toBeLessThanOrEqual(3);
  expect(Math.abs(scrolled.navTop - (scrolled.rollerBottom + scrolled.rollerMarginBottom)),
    "Back/Next must remain directly below the portal label panel while scrolling").toBeLessThanOrEqual(3);
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const viewport of [
  { name: "mobile", width: 360, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 }
]) {
  test(`authenticated fundraising and governance portal regression at ${viewport.name} size`, async ({ page }) => {
    page.setDefaultTimeout(10000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    const externalRequests = [];
    const successfulExternalRequests = [];
    const uncaughtErrors = [];
    page.on("pageerror", error => uncaughtErrors.push(error.message));
    page.on("requestfinished", request => {
      const url = new URL(request.url());
      if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") successfulExternalRequests.push(url.href);
    });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
      externalRequests.push(url.href);
      return route.abort();
    });

    await page.goto("/?adminModule=Grant%20Intelligence%20%26%20Funding%20Opportunities");
    await page.locator('.auth-card input[type="email"]').fill(fixtureEmail);
    await page.locator('.auth-card input[type="password"]').fill(fixturePassword);
    await page.getByRole("button", { name: "Sign In Securely" }).click();
    // A valid emulator administrator should enter the requested portal directly;
    // this workflow performs no data-entry writes except confirming Trial for Documents.
    await expect(page.locator(".topbar h2")).toContainText(/Grant Intelligence.*Funding Opportunities/, { timeout: 45000 });

    await assertPortalAndNoOverflow(page, /Grant Intelligence.*Funding Opportunities/, viewport.width);
    await assertStickyPortalNavigation(page);

    // Exercise the real international time pad in the authenticated application shell.
    // It must live in shared Back/Next navigation, never inside the weather forecast panel.
    const pageNavigation = page.locator(".main-area > .page-back-next-navigation");
    const worldTimeToggle = pageNavigation.getByRole("button", { name: "World time" });
    await expect(worldTimeToggle, "World time toggle belongs in the shared Back/Next navigator").toBeVisible();
    await expect(page.locator(".live-weather-content .page-back-next-time-pad"),
      "weather forecast must not own the international time popup").toHaveCount(0);
    await expect(page.locator("#irpa-international-time-pad")).toHaveCount(0);
    await worldTimeToggle.click();
    const timePad = page.getByRole("region", { name: "International time pad" });
    await expect(timePad).toBeVisible();
    await expect(pageNavigation.getByRole("button", { name: "Hide world time" })).toHaveAttribute("aria-expanded", "true");
    const expectedWorldCities = [
      "Dar es Salaam", "Nairobi", "Dubai", "London", "Geneva",
      "New York", "Singapore", "Tokyo", "Sydney"
    ];
    await expect(timePad.locator(".live-weather-time-city")).toHaveCount(expectedWorldCities.length);
    for (const city of expectedWorldCities) {
      await expect(timePad.locator(".live-weather-time-city").filter({ has: page.getByText(city, { exact: true }) }),
        `world clock for ${city} should render`).toHaveCount(1);
    }
    const initialDarTime = await timePad.locator(".live-weather-time-city").filter({
      has: page.getByText("Dar es Salaam", { exact: true })
    }).locator("span").textContent();
    await expect.poll(async () => timePad.locator(".live-weather-time-city").filter({
      has: page.getByText("Dar es Salaam", { exact: true })
    }).locator("span").textContent(), {
      timeout: 4000,
      message: "world clocks should refresh while the popup remains open"
    }).not.toBe(initialDarTime);
    const padBounds = await timePad.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
    });
    expect(padBounds.width, "world time pad must have visible width").toBeGreaterThan(0);
    expect(padBounds.left, "world time pad must not overflow the left viewport edge").toBeGreaterThanOrEqual(-1);
    expect(padBounds.right, "world time pad must not overflow the right viewport edge").toBeLessThanOrEqual(viewport.width + 1);
    await expect(page.locator(".live-weather-content .page-back-next-time-pad"),
      "opening world time must not insert popup content into weather forecast").toHaveCount(0);
    await timePad.getByRole("button", { name: "Close international time pad" }).click();
    await expect(timePad).toHaveCount(0);
    await expect(pageNavigation.getByRole("button", { name: "World time" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("heading", { name: "Corporate, climate and partnership sources" })).toBeVisible();
    const registryToggle = page.getByRole("button", { name: /Browse source registry/ });
    await expect(registryToggle).toHaveAttribute("aria-expanded", "false");
    await registryToggle.click();
    await expect(page.getByText(/23 of 23 source routes shown/)).toBeVisible();

    for (const [module, heading] of [
      ["Finance Portfolio", /Finance/],
      ["Meeting Room", /Meeting Room/],
      ["Documents", /Documents/],
      ["Resolutions", /Resolutions/],
      ["Voting", /Voting/],
      ["Decisions", /Decisions/],
      ["Grant Intelligence & Funding Opportunities", /Grant Intelligence.*Funding Opportunities/]
    ]) {
      await navigateModule(page, viewport.name, module);
      await assertPortalAndNoOverflow(page, heading, viewport.width);
    }

    // Exercise signing-workflow links where the connected-workflow strip is available; no records are created or signed.
    if (viewport.name !== "mobile") {
      await navigateModule(page, viewport.name, "Documents");
      await page.locator(".module-interlink-bar").getByRole("button", { name: "Signing Workspace" }).click();
      await expect(page.locator(".module-interlink-bar .workflow-action-portal.active")).toContainText("Signing Workspace");
      await page.locator(".module-interlink-bar").getByRole("button", { name: "Post-Signature Work" }).click();
      await expect(page.locator(".module-interlink-bar .workflow-action-portal.active")).toContainText("Post-Signature Work");
    }

    expect(uncaughtErrors, "uncaught JavaScript errors during portal navigation").toEqual([]);
    expect(successfulExternalRequests, "no external or production request may complete in the isolated fixture").toEqual([]);
    test.info().annotations.push({ type: "network-isolation", description: `Blocked ${externalRequests.length} attempted external request(s); none completed.` });
  });
}

// Every route rendered by the application shell is inspected at three viewport sizes.
// This is a read-only UI regression: the fixture blocks external traffic and creates no records.
const APP_PORTALS = [
  "Dashboard",
  "IT Operations",
  "Board Members Registration",
  "Invitations",
  "Members & Personnel",
  "Meetings",
  "Meeting Room",
  "Participants",
  "Resolutions",
  "Voting",
  "Authorization & Approvals",
  "Documents",
  "Signature Platform",
  "Induction and Orientation",
  "Induction Applications",
  "Downloads",
  "Finance Portfolio",
  "Procurement",
  "External Auditor Portal",
  "Auditors & Special Invitees",
  "Settings",
  "Add Administrator",
  "Employee Payments",
  "Actions",
  "Decisions",
  "Reports",
  "Risk Register",
  "Audit Trail",
  "Grant Intelligence & Funding Opportunities",
  "Research, Statistics and Knowledge"
];

async function assertSharedReadability(page, module, width) {
  const title = page.locator(".topbar h2");
  await expect(title, "portal heading should render for " + module).toBeVisible({ timeout: 30000 });
  await expect(title).not.toHaveText("");
  const workspace = page.locator("[data-active-portal-content]:visible").first();
  await expect(workspace, "active portal content should render for " + module).toBeVisible({ timeout: 30000 });
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  expect(dimensions.document, "horizontal overflow in " + module + " at " + width + "px").toBeLessThanOrEqual(dimensions.viewport + 1);

  if (module !== "Dashboard") {
    const workspaceBackground = await page.locator(".content-area:not(.dashboard-content-area)").evaluate(el => getComputedStyle(el).backgroundColor);
    expect(workspaceBackground, "shared Procurement-inspired workspace should be applied to " + module).toBe("rgb(248, 250, 249)");
  }

  const candidates = await workspace.evaluate(root => {
    const parse = value => {
      const match = String(value || "").match(/^rgba?\(([^)]+)\)$/i);
      if (!match) return null;
      const parts = match[1].split(",").map(part => Number.parseFloat(part.trim()));
      return parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)
        ? [parts[0], parts[1], parts[2], parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1] : null;
    };
    const path = el => el.tagName.toLowerCase() + ((typeof el.className === "string" && el.className.trim()) ? "." + el.className.trim().split(/\s+/).join(".") : "");
    const chain = el => { const list=[]; for(let n=el;n;n=n.parentElement) list.unshift(n); return list; };
    const parseRules = el => {
      const found=[];
      const visit=(rules,sheet)=>{ for(const rule of rules){ if(rule.cssRules){visit(rule.cssRules,sheet);continue;} if(!rule.selectorText||!rule.style)continue; let matches=false; try{matches=el.matches(rule.selectorText)}catch{} if(!matches)continue; const color=rule.style.getPropertyValue("color"),fill=rule.style.getPropertyValue("-webkit-text-fill-color"),background=rule.style.getPropertyValue("background-color")||rule.style.getPropertyValue("background"); if(color||fill||background)found.push({selector:rule.selectorText,file:sheet.href||"inline <style>",line:null,color:color||null,textFill:fill||null,background:background||null}); }};
      for(const sheet of document.styleSheets){try{visit(sheet.cssRules,sheet)}catch{}}
      return found.slice(-12);
    };
    const all=[...root.querySelectorAll("*")], result=[];
    let id=0;
    for(const el of all){
      const textNodes=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.nodeValue.trim());
      if(!textNodes.length)continue;
      const rects=[];
      for(const node of textNodes){const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects())if(r.width>0&&r.height>0)rects.push({left:r.left,top:r.top,right:r.right,bottom:r.bottom});}
      const box=el.getBoundingClientRect(),style=getComputedStyle(el);
      if(!rects.length||box.width<=0||box.height<=0||style.display==="none"||style.visibility==="hidden"||style.visibility==="collapse"||Number(style.opacity)<=0||el.closest('[aria-hidden="true"], [inert]'))continue;
      const chainList=chain(el); let bg=[255,255,255],needsPixels=false,nearestBackground=null;
      for(const n of chainList){
        const s=getComputedStyle(n), c=parse(s.backgroundColor);
        if(c)bg=[c[0]*c[3]+bg[0]*(1-c[3]),c[1]*c[3]+bg[1]*(1-c[3]),c[2]*c[3]+bg[2]*(1-c[3])];
      }
      for(const n of chainList.slice().reverse()){
        const s=getComputedStyle(n),c=parse(s.backgroundColor);
        if(s.backgroundImage&&s.backgroundImage!=="none"){needsPixels=true;break;}
        if(c&&c[3]>=0.999){needsPixels=false;break;}
      }
      for(const n of chainList.slice().reverse()){
        const s=getComputedStyle(n),c=parse(s.backgroundColor);
        if((c&&c[3]>0)||(s.backgroundImage&&s.backgroundImage!=="none")){nearestBackground={element:path(n),className:typeof n.className==="string"?n.className:n.getAttribute("class")||"",backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage||"none"};break;}
      }
      const sampleId=String(++id);el.setAttribute("data-contrast-sample-id",sampleId);
      const fg=style.webkitTextFillColor&&style.webkitTextFillColor!=="currentcolor"?style.webkitTextFillColor:style.color;
      const inlineOrigin=chainList.slice().reverse().find(n=>n.style&&((n.style.color&&getComputedStyle(n).color===style.color)||(n.style.getPropertyValue("-webkit-text-fill-color")&&getComputedStyle(n).webkitTextFillColor===fg)));
      const matchedRules=[];for(const n of chainList)matchedRules.push(...parseRules(n));
      const exact=matchedRules.filter(rule=>rule.color===fg||rule.textFill===fg||rule.color===style.color||rule.textFill===style.color);
      result.push({id:sampleId,tag:el.tagName,text:textNodes.map(n=>n.nodeValue.trim()).join(" ").replace(/\s+/g," "),fg,className:typeof el.className==="string"?el.className:el.getAttribute("class")||"",rect:{left:Math.min(...rects.map(r=>r.left)),top:Math.min(...rects.map(r=>r.top)),right:Math.max(...rects.map(r=>r.right)),bottom:Math.max(...rects.map(r=>r.bottom))},box:{left:box.left,top:box.top,width:box.width,height:box.height},needsPixels,background:bg.map(Math.round),nearestBackground,winningRule:exact.length?exact[exact.length-1]:(inlineOrigin?{selector:"inline style on "+path(inlineOrigin),file:"inline component style; source file/line not exposed",line:null}:null),matchedRules:matchedRules.slice(-12)});
    }
    return result;
  });

  await page.addStyleTag({content:"html.__irpa_contrast_sampler * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }"});
  const parseColor=value=>{const match=String(value||"").match(/^rgba?\(([^)]+)\)$/i);if(!match)return null;const p=match[1].split(",").map(x=>Number.parseFloat(x.trim()));return p.length>=3&&p.slice(0,3).every(Number.isFinite)?[p[0],p[1],p[2],p.length>3&&Number.isFinite(p[3])?p[3]:1]:null;};
  const lum=rgb=>{const c=rgb.map(v=>v/255).map(v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4));return .2126*c[0]+.7152*c[1]+.0722*c[2];};
  const contrast=(fg,bg)=>{const a=fg[3];const f=[fg[0]*a+bg[0]*(1-a),fg[1]*a+bg[1]*(1-a),fg[2]*a+bg[2]*(1-a)];const x=lum(f),y=lum(bg);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const failures=[];
  for(const item of candidates){
    let bg=item.background,ratio=null,samplingMethod="alpha-composited ancestor backgrounds",samplingError=null;
    try{
      const fg=parseColor(item.fg);if(!fg)throw new Error("unparseable foreground colour: "+item.fg);
      if(item.needsPixels){
        samplingMethod="rendered screenshot pixels";
        const locator=workspace.locator('[data-contrast-sample-id="'+item.id+'"]');
        await locator.scrollIntoViewIfNeeded();
        const geom=await locator.evaluate(el=>{const nodes=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.nodeValue.trim()),rects=[];for(const n of nodes){const r=document.createRange();r.selectNodeContents(n);for(const x of r.getClientRects())if(x.width>0&&x.height>0)rects.push({left:x.left,top:x.top,right:x.right,bottom:x.bottom});}const b=el.getBoundingClientRect();if(!rects.length)throw new Error("text range has no rendered rectangle");return{width:b.width,height:b.height,textRect:{left:Math.min(...rects.map(r=>r.left))-b.left,top:Math.min(...rects.map(r=>r.top))-b.top,right:Math.max(...rects.map(r=>r.right))-b.left,bottom:Math.max(...rects.map(r=>r.bottom))-b.top}};});
        await page.evaluate(()=>document.documentElement.classList.add("__irpa_contrast_sampler"));
        let png;try{png=await locator.screenshot({animations:"disabled"});}finally{await page.evaluate(()=>document.documentElement.classList.remove("__irpa_contrast_sampler"));}
        const sampled=await page.evaluate(async({dataUrl,geometry,foreground})=>{const image=new Image();image.src=dataUrl;await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("screenshot image decode failed"));});const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("canvas context unavailable");ctx.drawImage(image,0,0);const sx=image.naturalWidth/geometry.width,sy=image.naturalHeight/geometry.height,left=Math.max(0,Math.floor(geometry.textRect.left*sx)),top=Math.max(0,Math.floor(geometry.textRect.top*sy)),right=Math.min(canvas.width,Math.ceil(geometry.textRect.right*sx)),bottom=Math.min(canvas.height,Math.ceil(geometry.textRect.bottom*sy));if(right<=left||bottom<=top)throw new Error("text box outside screenshot");const data=ctx.getImageData(left,top,right-left,bottom-top).data;const m=foreground.match(/^rgba?\(([^)]+)\)$/i);if(!m)throw new Error("unparseable foreground during pixel sampling");const p=m[1].split(",").map(x=>Number.parseFloat(x.trim())),fg=[p[0],p[1],p[2],p.length>3&&Number.isFinite(p[3])?p[3]:1];const luminance=rgb=>{const c=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*c[0]+.7152*c[1]+.0722*c[2];};let worst=Infinity,worstBg=null,count=0,total=[0,0,0];for(let y=0;y<bottom-top;y+=2){for(let x=0;x<right-left;x+=2){const i=(y*(right-left)+x)*4;if(data[i+3]<255)continue;const bg=[data[i],data[i+1],data[i+2]],f=[fg[0]*fg[3]+bg[0]*(1-fg[3]),fg[1]*fg[3]+bg[1]*(1-fg[3]),fg[2]*fg[3]+bg[2]*(1-fg[3])],a=luminance(f),b=luminance(bg),r=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);total[0]+=bg[0];total[1]+=bg[1];total[2]+=bg[2];count++;if(r<worst){worst=r;worstBg=bg;}}}if(!count||!worstBg)throw new Error("no opaque rendered pixels behind text");return{bg:"rgb("+worstBg.map(Math.round).join(", ")+")",ratio:worst,averageBg:"rgb("+total.map(v=>Math.round(v/count)).join(", ")+")",sampledPixels:count};},{dataUrl:"data:image/png;base64,"+png.toString("base64"),geometry:geom,foreground:item.fg});
        bg=sampled.bg;ratio=sampled.ratio;item.averageBackground=sampled.averageBg;item.sampledPixels=sampled.sampledPixels;
      }else ratio=contrast(fg,bg);
    }catch(error){samplingError=error&&error.message?error.message:String(error);}
    const record={portal:module,tag:item.tag,text:item.text,fg:item.fg,bg:Array.isArray(bg)?"rgb("+bg.map(Math.round).join(", ")+")":bg,ratio:ratio===null?null:Number(ratio.toFixed(3)),className:item.className,nearestBackground:item.nearestBackground,winningRule:item.winningRule,matchedRules:item.matchedRules,samplingMethod,samplingError};
    if(samplingError||ratio===null||ratio<4.5)failures.push(record);
  }
  expect(candidates.length,"portal should render visible leaf text for readability checks in "+module).toBeGreaterThan(0);
  return failures;
}
for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 }
]) {
  test(`all registered portal workspaces retain readability at ${viewport.name} size`, async ({ page }) => {
    page.setDefaultTimeout(10000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const externalRequests = [];
    const completedExternalRequests = [];
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("requestfinished", request => {
      const url = new URL(request.url());
      if (!["localhost", "127.0.0.1"].includes(url.hostname)) completedExternalRequests.push(url.href);
    });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["localhost", "127.0.0.1"].includes(url.hostname)) return route.continue();
      externalRequests.push(url.href);
      return route.abort();
    });

    await page.goto("/?adminModule=" + encodeURIComponent("Grant Intelligence & Funding Opportunities"));
    await page.locator('.auth-card input[type="email"]').fill(fixtureEmail);
    await page.locator('.auth-card input[type="password"]').fill(fixturePassword);
    await page.getByRole("button", { name: "Sign In Securely" }).click();
    await expect(page.locator(".topbar h2")).toContainText(/Grant Intelligence.*Funding Opportunities/, { timeout: 45000 });

    const readabilityFailures = [];
    for (const module of APP_PORTALS) {
      await page.goto("/?adminModule=" + encodeURIComponent(module));
      await expect(page.locator(".topbar h2")).toBeVisible({ timeout: 30000 });
      await expect(page.locator("[data-active-portal-content]:visible").first()).toBeVisible({ timeout: 30000 });
      readabilityFailures.push(...await assertSharedReadability(page, module, viewport.width));
    }
    console.log("AUTHENTICATED_READABILITY_FAILURES", JSON.stringify({
      viewport: viewport.name, width: viewport.width, threshold: 4.5, failures: readabilityFailures
    }));
    expect(readabilityFailures, `all registered portals must meet 4.5:1 contrast at ${viewport.name}; full failure list is logged above`).toEqual([]);

    expect(completedExternalRequests, "isolated browser test must not complete external/production requests").toEqual([]);
    expect(pageErrors, "no uncaught runtime errors across the portal sweep").toEqual([]);
    test.info().annotations.push({
      type: "coverage",
      description: `Inspected ${APP_PORTALS.length} portal routes at ${viewport.width}px; blocked ${externalRequests.length} external requests.`
    });
  });
}
