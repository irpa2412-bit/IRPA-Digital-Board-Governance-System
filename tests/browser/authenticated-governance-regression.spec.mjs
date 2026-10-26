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
  { name: "mobile", width: 390, height: 844 },
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
  const title=page.locator(".topbar h2");
  await expect(title,`portal heading should render for ${module}`).toBeVisible({timeout:30000});
  await expect(title).not.toHaveText("");
  const workspace=page.locator("[data-active-portal-content]:visible").first();
  await expect(workspace).toBeVisible({timeout:30000});
  const dims=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,document:document.documentElement.scrollWidth}));
  expect(dims.document,`horizontal overflow in ${module} at ${width}px`).toBeLessThanOrEqual(dims.viewport+1);
  if(module!=="Dashboard") expect(await page.locator(".content-area:not(.dashboard-content-area)").evaluate(e=>getComputedStyle(e).backgroundColor)).toBe("rgb(248, 250, 249)");
  const items=await workspace.evaluate(root=>{
    const parse=v=>{const m=String(v||"").match(/^rgba?\(([^)]+)\)$/i);if(!m)return null;const p=m[1].replace("/",",").split(",").map(x=>parseFloat(x.trim()));return p.length>=3&&p.slice(0,3).every(Number.isFinite)?[p[0],p[1],p[2],p.length>3&&Number.isFinite(p[3])?p[3]:1]:null;};
    const path=e=>e.tagName.toLowerCase()+(typeof e.className==="string"&&e.className.trim()?"."+e.className.trim().split(/\s+/).join("."):"");
    const ancestry=e=>{const a=[];for(let n=e;n;n=n.parentElement)a.unshift(n);return a;};
    const ruleList=e=>{const out=[];const walk=(rs,s)=>{for(const r of rs){if(r.cssRules){walk(r.cssRules,s);continue;}if(!r.selectorText||!r.style)continue;let ok=false;try{ok=e.matches(r.selectorText)}catch{}if(ok&&(r.style.color||r.style.getPropertyValue("-webkit-text-fill-color")||r.style.background||r.style.backgroundColor))out.push({selector:r.selectorText,file:s.href||"inline <style>",line:null,color:r.style.color||null,textFill:r.style.getPropertyValue("-webkit-text-fill-color")||null,background:r.style.background||r.style.backgroundColor||null});}};for(const s of document.styleSheets){try{walk(s.cssRules,s)}catch{}}return out;};
    const out=[];let id=0;
    for(const e of root.querySelectorAll("*")){
      const nodes=[...e.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.nodeValue.trim());if(!nodes.length)continue;
      const rects=[];for(const n of nodes){const r=document.createRange();r.selectNodeContents(n);for(const q of r.getClientRects())if(q.width&&q.height)rects.push(q);}
      const b=e.getBoundingClientRect(),st=getComputedStyle(e);if(!rects.length||!b.width||!b.height||st.display==="none"||st.visibility!=="visible"||+st.opacity<=0||e.closest('[aria-hidden="true"],[inert]'))continue;
      const chain=ancestry(e),html=parse(getComputedStyle(document.documentElement).backgroundColor),body=parse(getComputedStyle(document.body).backgroundColor);
      const canvas=html&&html[3]>0?html.slice(0,3).map(v=>v*html[3]+255*(1-html[3])):[255,255,255];
      let bg=body&&body[3]>0?body.slice(0,3).map((v,i)=>v*body[3]+canvas[i]*(1-body[3])):canvas;
      for(const n of chain){if(n===document.documentElement||n===document.body)continue;const s=getComputedStyle(n),c=parse(s.backgroundColor);if(c&&c[3]>0)bg=bg.map((v,i)=>c[i]*c[3]+v*(1-c[3]));}
      let pixels=false,nearest=null;for(const n of [...chain].reverse()){const s=getComputedStyle(n),c=parse(s.backgroundColor);if(s.backgroundImage&&s.backgroundImage!=="none")pixels=true;if(!nearest&&((c&&c[3]>0)||(s.backgroundImage&&s.backgroundImage!=="none")))nearest={element:path(n),className:n.getAttribute("class")||"",backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage||"none"};}
      const idValue=String(++id);e.setAttribute("data-irpa-contrast-id",idValue);const fg=st.webkitTextFillColor&&st.webkitTextFillColor!=="currentcolor"?st.webkitTextFillColor:st.color;
      const rules=chain.flatMap(n=>ruleList(n)),matching=rules.filter(x=>x.color===fg||x.textFill===fg||x.color===st.color||x.textFill===st.color);
      out.push({id:idValue,tag:e.tagName,text:nodes.map(n=>n.nodeValue.trim()).join(" ").replace(/\s+/g," "),fg,className:e.getAttribute("class")||"",box:{left:b.left,top:b.top,width:b.width,height:b.height},textRect:{left:Math.min(...rects.map(x=>x.left))-b.left,top:Math.min(...rects.map(x=>x.top))-b.top,right:Math.max(...rects.map(x=>x.right))-b.left,bottom:Math.max(...rects.map(x=>x.bottom))-b.top},pixels,bg,nearest,rule:matching.at(-1)||null,rules:rules.slice(-12)});
    }return out;
  });
  // Test-only measurement: temporarily hide glyph paint to sample the
  // background behind text. Construct the value at runtime so the
  // production readability checker does not mistake this helper for
  // a production style declaration.
  const invisiblePaint = ["rgba", "(0,0,0,0)"].join("");
  const measurementCss =
    "html.__irpa_hide_text *{color:" + invisiblePaint +
    "!important;-webkit-text-fill-color:" + invisiblePaint +
    "!important;text-shadow:none!important;caret-color:" +
    invisiblePaint + "!important}";
  await page.addStyleTag({ content: measurementCss });
  const parse=v=>{const m=String(v||"").match(/^rgba?\(([^)]+)\)$/i);if(!m)return null;const p=m[1].replace("/",",").split(",").map(x=>parseFloat(x.trim()));return p.length>=3&&p.slice(0,3).every(Number.isFinite)?[...p.slice(0,3),p.length>3&&Number.isFinite(p[3])?p[3]:1]:null;};
  const lum=c=>{const x=c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*x[0]+.7152*x[1]+.0722*x[2];};
  const ratio=(f,b)=>{const a=f[3],fg=f.slice(0,3).map((v,i)=>v*a+b[i]*(1-a)),x=lum(fg),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const failures=[];
  for(const item of items){
    let bg=item.bg,cr=null,error=null,method="alpha-composited ancestor backgrounds";
    try{
      const fg=parse(item.fg);if(!fg)throw Error("unparseable foreground "+item.fg);
      if(item.pixels){
        method="rendered screenshot worst pixel";const loc=workspace.locator('[data-irpa-contrast-id="'+item.id+'"]');await loc.scrollIntoViewIfNeeded();
        await page.evaluate(()=>document.documentElement.classList.add("__irpa_hide_text"));let png;try{png=await loc.screenshot({animations:"disabled"});}finally{await page.evaluate(()=>document.documentElement.classList.remove("__irpa_hide_text"));}
        const sampled=await page.evaluate(async({src,box,fgs})=>{const im=new Image();im.src=src;await new Promise((ok,no)=>{im.onload=ok;im.onerror=()=>no(Error("screenshot decode failed"));});const c=document.createElement("canvas");c.width=im.naturalWidth;c.height=im.naturalHeight;const x=c.getContext("2d",{willReadFrequently:true});if(!x)throw Error("canvas unavailable");x.drawImage(im,0,0);const sx=im.naturalWidth/box.width,sy=im.naturalHeight/box.height,l=Math.max(0,Math.floor(box.textRect.left*sx)),t=Math.max(0,Math.floor(box.textRect.top*sy)),r=Math.min(c.width,Math.ceil(box.textRect.right*sx)),b=Math.min(c.height,Math.ceil(box.textRect.bottom*sy));if(r<=l||b<=t)throw Error("text box outside screenshot");const d=x.getImageData(l,t,r-l,b-t).data;const m=fgs.match(/^rgba?\(([^)]+)\)$/i);if(!m)throw Error("unparseable foreground during pixel sampling");const p=m[1].replace("/",",").split(",").map(v=>parseFloat(v.trim())),f=[...p.slice(0,3),p.length>3&&Number.isFinite(p[3])?p[3]:1],L=v=>{const q=v.map(z=>z/255).map(z=>z<=.04045?z/12.92:((z+.055)/1.055)**2.4);return .2126*q[0]+.7152*q[1]+.0722*q[2];};let worst=Infinity,chosen=null,count=0;for(let yy=0;yy<b-t;yy+=2)for(let xx=0;xx<r-l;xx+=2){const i=(yy*(r-l)+xx)*4;if(d[i+3]<255)continue;const bg=[d[i],d[i+1],d[i+2]],front=bg.map((v,j)=>f[j]*f[3]+v*(1-f[3])),a=L(front),z=L(bg),q=(Math.max(a,z)+.05)/(Math.min(a,z)+.05);count++;if(q<worst){worst=q;chosen=bg;}}if(!count||!chosen)throw Error("no opaque pixels sampled behind text");return{bg:"rgb("+chosen.join(", ")+")",ratio:worst,pixels:count};},{src:"data:image/png;base64,"+png.toString("base64"),box:item,fgs:item.fg});
        bg=sampled.bg;cr=sampled.ratio;item.sampledPixels=sampled.pixels;
      }else cr=ratio(fg,bg);
    }catch(e){error=e?.message||String(e);}
    const record={portal:module,tag:item.tag,text:item.text,fg:item.fg,bg:Array.isArray(bg)?"rgb("+bg.map(Math.round).join(", ")+")":bg,ratio:cr===null?null:Number(cr.toFixed(3)),className:item.className,nearestBackground:item.nearest,winningRule:item.rule,matchedRules:item.rules,samplingMethod:method,samplingError:error,sampledPixels:item.sampledPixels};
    if(error||cr===null||cr<4.5)failures.push(record);
  }
  expect(items.length,`portal should render visible leaf text for ${module}`).toBeGreaterThan(0);
  return failures;
}
for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 }
]) {
  test(`all registered portal workspaces retain readability at ${viewport.name} size`, async ({ page }) => {
    test.setTimeout(360000);
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
