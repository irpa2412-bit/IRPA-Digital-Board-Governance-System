import {test,expect} from "@playwright/test";
import {signInToGrantIntelligenceFixture} from "./grant-analyse-fixture.mjs";

const localHosts=new Set(["localhost","127.0.0.1"]);
const successPayload={
  evaluationId:"mock-eval",
  eligibility:{
    status:"Conditionally eligible",
    reasons:[{criterion:"Geographic eligibility",status:"Pass",reason:"Tanzania is included."}],
    missing:["Confirm applicant registration requirements."]
  },
  fit:{score:84,breakdown:{rangeland:{score:28,max:30,reason:"Strong rangeland alignment."}}},
  validityStatus:"Needs verification"
};

for(const viewport of [
  {name:"mobile",width:390,height:844},
  {name:"desktop",width:1440,height:900}
]){
  test(`Grant pipeline Analyse states remain isolated at ${viewport.name} size`,async({page})=>{
    await page.setViewportSize({width:viewport.width,height:viewport.height});

    const externalRequests=[];
    const completedExternalRequests=[];
    const pageErrors=[];
    page.on("pageerror",error=>pageErrors.push(error.message));

    // Only the pipeline evaluation endpoint is mocked. Every non-local host is
    // blocked and recorded, so a production Worker/Firebase request fails the test.
    await page.route("**/*",async route=>{
      const url=new URL(route.request().url());
      if(localHosts.has(url.hostname))return route.continue();
      externalRequests.push(url.href);
      return route.abort("blockedbyclient");
    });

    let responseMode="success";
    let evaluationCalls=0;
    await page.route("**/pipeline/evaluate",async route=>{
      evaluationCalls+=1;
      if(responseMode==="timeout"){
        // Leave the request pending until the browser's real 30-second
        // AbortSignal timeout fires under Playwright's controllable clock.
        await page.waitForTimeout(31000).catch(()=>{});
        await route.abort("timedout").catch(()=>{});
        return;
      }
      if(responseMode==="server-error"){
        return route.fulfill({
          status:503,
          contentType:"application/json",
          body:JSON.stringify({error:"Mock pipeline service unavailable."})
        });
      }
      return route.fulfill({
        status:200,
        contentType:"application/json",
        body:JSON.stringify(successPayload)
      });
    });

    page.on("requestfinished",request=>{
      if(!localHosts.has(new URL(request.url()).hostname))completedExternalRequests.push(request.url());
    });

    await signInToGrantIntelligenceFixture(page);

    const opportunityCard=title=>page.locator("article").filter({hasText:title}).first();
    const tanzania=opportunityCard("Tanzania Pastoral Rangeland Resilience Grant");
    const outsideTanzania=opportunityCard("East Africa Regional Biodiversity Fund");
    const missingDetails=opportunityCard("Pastoral Community Innovation Opportunity");

    await expect(tanzania).toBeVisible({timeout:30000});
    await expect(outsideTanzania).toBeVisible({timeout:30000});
    await expect(missingDetails).toBeVisible({timeout:30000});

    // 1. Successful evaluation renders the returned eligibility and fit data.
    await tanzania.locator("details > summary").click();
    await tanzania.getByRole("button",{name:"Analyse",exact:true}).click();
    await expect(tanzania.getByText("Conditionally eligible",{exact:true})).toBeVisible();
    await expect(tanzania.getByText(/Geographic eligibility: Pass/)).toBeVisible();
    await expect(tanzania.getByText("Confirm applicant registration requirements.",{exact:true})).toBeVisible();
    await expect(tanzania.getByText("Fit 84/100",{exact:true})).toBeVisible();
    await expect(tanzania.getByText("AI-generated, verify before use.",{exact:true})).toBeVisible();

    // 2. Advance the application's 30-second AbortSignal timeout without
    // waiting in real time; verify the timeout message and visible Retry action.
    await missingDetails.locator("details > summary").click();
    await page.clock.install();
    responseMode="timeout";
    await missingDetails.getByRole("button",{name:"Analyse",exact:true}).click();
    await expect(missingDetails.getByText(/Evaluating eligibility/)).toBeVisible();
    await page.clock.fastForward(30050);
    await expect(missingDetails.getByRole("alert")).toContainText("timed out after 30 seconds");
    await expect(missingDetails.getByRole("button",{name:"Retry",exact:true})).toBeVisible();
    await page.clock.resume();

    // 3. A server-side failure is shown against the affected opportunity.
    await outsideTanzania.locator("details > summary").click();
    responseMode="server-error";
    await outsideTanzania.getByRole("button",{name:"Analyse",exact:true}).click();
    await expect(outsideTanzania.getByRole("alert")).toContainText("Mock pipeline service unavailable.");

    // 4. Retry uses the same endpoint and succeeds after the server recovers.
    responseMode="success";
    await outsideTanzania.getByRole("button",{name:"Retry",exact:true}).click();
    await expect(outsideTanzania.getByText("Conditionally eligible",{exact:true})).toBeVisible();
    await expect(outsideTanzania.getByText("Fit 84/100",{exact:true})).toBeVisible();

    expect(evaluationCalls,"expected success, timeout, server error and retry requests").toBe(4);
    expect(externalRequests,"no request may target a real backend host").toEqual([]);
    expect(completedExternalRequests,"no request to a real backend host may complete").toEqual([]);
    expect(pageErrors,"no uncaught browser errors").toEqual([]);
  });
}
