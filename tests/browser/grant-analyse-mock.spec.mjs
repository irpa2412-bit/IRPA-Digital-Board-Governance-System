import {test,expect} from "@playwright/test";
import {mkdirSync,writeFileSync} from "node:fs";
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
  test(`Grant pipeline Analyse states remain isolated at ${viewport.name} size`,async({page},testInfo)=>{
    await page.setViewportSize({width:viewport.width,height:viewport.height});

    const blockedHosts=new Set();
    const pageErrors=[];
    const pipelineRequests=[];
    const requestRecords=new WeakMap();
    let responseMode="success";
    let evaluationCalls=0;
    let selectedArticle=null;

    page.on("pageerror",error=>pageErrors.push(error.message));
    page.on("request",request=>{
      let url;
      try{url=new URL(request.url());}catch{return;}
      if(!url.pathname.endsWith("/pipeline/evaluate"))return;
      const record={url:url.href,method:request.method(),requestBody:request.postData(),responseStatus:null,responseBody:null,failure:null};
      pipelineRequests.push(record);
      requestRecords.set(request,record);
    });
    page.on("response",async response=>{
      const record=requestRecords.get(response.request());
      if(!record)return;
      record.responseStatus=response.status();
      record.responseBody=await response.text().catch(error=>"<response body unavailable: "+error.message+">");
    });
    page.on("requestfailed",request=>{
      const record=requestRecords.get(request);
      if(record)record.failure=request.failure()?.errorText||"request failed";
    });

    // One dispatcher both mocks the pipeline endpoint and blocks every other
    // non-local host. No real Worker or backend request can leave the browser.
    await page.route("**/*",async route=>{
      const request=route.request();
      const url=new URL(request.url());
      if(url.pathname.endsWith("/pipeline/evaluate")&&request.method()==="POST"){
        evaluationCalls+=1;
        if(responseMode==="timeout"){
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
      }
      if(localHosts.has(url.hostname))return route.continue();
      blockedHosts.add(url.host);
      return route.abort("blockedbyclient");
    });

    const opportunityCard=title=>page.locator("article").filter({
      has:page.getByRole("heading",{name:title,exact:true})
    }).first();

    const captureFailureEvidence=async()=>{
      const dir="test-results/analyse-diagnostics/"+viewport.name;
      mkdirSync(dir,{recursive:true});
      const articleText=selectedArticle
        ? await selectedArticle.innerText().catch(error=>"<article text capture failed: "+error.message+">")
        : "<no selected article locator>";
      const wholePageText=await page.locator("body").innerText().catch(error=>"<page text capture failed: "+error.message+">");
      await page.screenshot({path:dir+"/failure.png",fullPage:true}).catch(error=>{
        writeFileSync(dir+"/screenshot-error.txt",error.message);
      });
      writeFileSync(dir+"/selected-article.txt",articleText);
      writeFileSync(dir+"/whole-page.txt",wholePageText);
      const evidence={
        viewport,
        pageUrl:page.url(),
        evaluationCalls,
        pipelineRequests,
        blockedHosts:[...blockedHosts],
        pageErrors,
        selectedArticleText:articleText,
        wholePageText
      };
      writeFileSync(dir+"/diagnostics.json",JSON.stringify(evidence,null,2));
      console.log("\n===== GRANT ANALYSE FAILURE DIAGNOSTICS ("+viewport.name+") =====");
      console.log("SELECTED ARTICLE TEXT:\n"+articleText);
      console.log("WHOLE PAGE TEXT:\n"+wholePageText);
      console.log("RECORDED /pipeline/evaluate REQUESTS (status and body):\n"+JSON.stringify(pipelineRequests,null,2));
      console.log("BLOCKED HOSTS:\n"+JSON.stringify([...blockedHosts],null,2));
      console.log("PAGE ERRORS:\n"+JSON.stringify(pageErrors,null,2));
      console.log("===== END GRANT ANALYSE FAILURE DIAGNOSTICS =====\n");
      await testInfo.attach("grant-analyse-diagnostics-"+viewport.name,{
        path:dir+"/diagnostics.json",
        contentType:"application/json"
      });
    };

    try{
      await signInToGrantIntelligenceFixture(page);

      const tanzania=opportunityCard("Tanzania Pastoral Rangeland Resilience Grant");
      const outsideTanzania=opportunityCard("East Africa Regional Biodiversity Fund");
      const missingDetails=opportunityCard("Pastoral Community Innovation Opportunity");

      for(const [title,card] of [
        ["Tanzania Pastoral Rangeland Resilience Grant",tanzania],
        ["East Africa Regional Biodiversity Fund",outsideTanzania],
        ["Pastoral Community Innovation Opportunity",missingDetails]
      ]){
        const count=await card.count();
        expect(count,`expected exactly one article for seeded opportunity "${title}"`).toBe(1);
        await expect(card).toBeVisible({timeout:30000});
      }

      // 1. Successful evaluation. Select by the unique accessible heading;
      // assert uniqueness before interacting. Result text may render outside
      // the article, so all response assertions search the whole page.
      selectedArticle=tanzania;
      await tanzania.locator("details > summary").click();
      await tanzania.getByRole("button",{name:"Analyse",exact:true}).click();
      await expect.poll(()=>evaluationCalls,{timeout:7000,message:"Analyse must issue the mocked POST /pipeline/evaluate request"}).toBe(1);
      await expect.poll(()=>pipelineRequests[0]?.responseStatus,{timeout:7000,message:"mocked pipeline response must be received"}).toBe(200);
      await expect(page.getByText("Conditionally eligible",{exact:true})).toBeVisible();
      await expect(page.getByText(/Geographic eligibility: Pass/)).toBeVisible();
      await expect(page.getByText("Confirm applicant registration requirements.",{exact:true})).toBeVisible();
      await expect(page.getByText("Fit 84/100",{exact:true})).toBeVisible();
      await expect(page.getByText("AI-generated, verify before use.",{exact:true})).toBeVisible();

      // 2. Advance the application's 30-second AbortSignal timeout.
      selectedArticle=missingDetails;
      await missingDetails.locator("details > summary").click();
      await page.clock.install();
      responseMode="timeout";
      await missingDetails.getByRole("button",{name:"Analyse",exact:true}).click();
      await expect(missingDetails.getByText(/Evaluating eligibility/)).toBeVisible();
      await page.clock.fastForward(30050);
      await expect(missingDetails.getByRole("alert")).toContainText("timed out after 30 seconds");
      await expect(missingDetails.getByRole("button",{name:"Retry",exact:true})).toBeVisible();
      await page.clock.resume();

      // 3. Server error, followed by 4. successful retry.
      selectedArticle=outsideTanzania;
      await outsideTanzania.locator("details > summary").click();
      responseMode="server-error";
      await outsideTanzania.getByRole("button",{name:"Analyse",exact:true}).click();
      await expect(outsideTanzania.getByRole("alert")).toContainText("Mock pipeline service unavailable.");
      responseMode="success";
      await outsideTanzania.getByRole("button",{name:"Retry",exact:true}).click();
      await expect(page.getByText("Conditionally eligible",{exact:true}).last()).toBeVisible();
      await expect(page.getByText("Fit 84/100",{exact:true}).last()).toBeVisible();

      expect(evaluationCalls,"expected success, timeout, server error and retry requests").toBe(4);
      expect(pipelineRequests.every(request=>new URL(request.url).pathname.endsWith("/pipeline/evaluate")&&request.method==="POST")).toBe(true);
      expect(blockedHosts.size,"no request may target a real backend host").toBe(0);
      expect(pageErrors,"no uncaught browser errors").toEqual([]);
    }catch(error){
      await captureFailureEvidence();
      throw error;
    }
  });
}
