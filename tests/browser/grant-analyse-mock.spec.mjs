import {test,expect} from "@playwright/test";
import {mkdirSync,writeFileSync} from "node:fs";
import {signInToGrantIntelligenceFixture} from "./grant-analyse-fixture.mjs";

const localHosts=new Set(["localhost","127.0.0.1"]);
const mockPipelineUrl="http://127.0.0.1:4174/__fixture_no_backend__/pipeline/evaluate";
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
    const consoleMessages=[];
    const pageErrors=[];
    const allRequests=[];
    const requestRecords=new WeakMap();
    const pipelineRequests=[];
    let recordingAfterClick=false;
    let evaluationCalls=0;
    let responseMode="success";
    let selectedArticle=null;
    let analyseButton=null;

    page.on("console",message=>consoleMessages.push({type:message.type(),text:message.text(),location:message.location()}));
    page.on("pageerror",error=>pageErrors.push(error.stack||error.message));
    page.on("request",request=>{
      if(!recordingAfterClick)return;
      const record={url:request.url(),method:request.method(),status:null,responseBody:null,failure:null};
      allRequests.push(record);
      requestRecords.set(request,record);
      if(new URL(request.url()).pathname.endsWith("/pipeline/evaluate"))pipelineRequests.push(record);
    });
    page.on("response",async response=>{
      const record=requestRecords.get(response.request());
      if(!record)return;
      record.status=response.status();
      record.responseBody=await response.text().catch(error=>"<body unavailable: "+error.message+">");
    });
    page.on("requestfailed",request=>{
      const record=requestRecords.get(request);
      if(record)record.failure=request.failure()?.errorText||"request failed";
    });

    // Exact URL configured by playwright.grant-analyse.config.mjs.
    // This single dispatcher fulfils only the mock endpoint and blocks every
    // other external host; local preview/emulator traffic remains local.
    await page.route("**/*",async route=>{
      const request=route.request();
      const url=new URL(request.url());
      if(url.href===mockPipelineUrl&&request.method()==="POST"){
        evaluationCalls+=1;
        if(responseMode==="timeout"){
          await page.waitForTimeout(31000).catch(()=>{});
          await route.abort("timedout").catch(()=>{});
          return;
        }
        if(responseMode==="server-error"){
          return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Mock pipeline service unavailable."})});
        }
        return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(successPayload)});
      }
      if(localHosts.has(url.hostname))return route.continue();
      blockedHosts.add(url.host);
      return route.abort("blockedbyclient");
    });

    const register=page.locator("section").filter({
      has:page.getByRole("heading",{name:"Opportunity register",exact:true})
    });
    const opportunityCard=title=>register.locator("article").filter({hasText:title});

    const captureFailureEvidence=async()=>{
      const dir="test-results/analyse-diagnostics/"+viewport.name;
      mkdirSync(dir,{recursive:true});
      const articleText=selectedArticle
        ? await selectedArticle.innerText().catch(error=>"<article text capture failed: "+error.message+">")
        : "<no selected article>";
      const pageText=await page.locator("body").innerText().catch(error=>"<page text capture failed: "+error.message+">");
      const buttonDisabled=analyseButton
        ? await analyseButton.isDisabled().catch(error=>"<disabled state unavailable: "+error.message+">")
        : "<no selected Analyse button>";
      const evidence={viewport,pageUrl:page.url(),mockPipelineUrl,evaluationCalls,allRequestsAfterClick:allRequests,pipelineRequests,blockedHosts:[...blockedHosts],analyseButtonDisabled:buttonDisabled,selectedArticleText:articleText,wholePageText:pageText,consoleMessages,pageErrors};
      await page.screenshot({path:dir+"/failure.png",fullPage:true}).catch(error=>writeFileSync(dir+"/screenshot-error.txt",error.message));
      writeFileSync(dir+"/page-text.txt",pageText);
      writeFileSync(dir+"/selected-article-text.txt",articleText);
      writeFileSync(dir+"/diagnostics.json",JSON.stringify(evidence,null,2));
      console.log("\n===== GRANT ANALYSE FAILURE ("+viewport.name+") =====");
      console.log("MOCK URL: "+mockPipelineUrl);
      console.log("ANALYSE BUTTON DISABLED: "+buttonDisabled);
      console.log("SELECTED ARTICLE TEXT:\n"+articleText);
      console.log("FULL PAGE TEXT:\n"+pageText);
      console.log("ALL REQUESTS AFTER CLICK (URL, METHOD, STATUS, RESPONSE BODY):\n"+JSON.stringify(allRequests,null,2));
      console.log("BLOCKED HOSTS:\n"+JSON.stringify([...blockedHosts],null,2));
      console.log("CONSOLE MESSAGES:\n"+JSON.stringify(consoleMessages,null,2));
      console.log("PAGE ERRORS:\n"+JSON.stringify(pageErrors,null,2));
      console.log("===== END GRANT ANALYSE FAILURE =====\n");
      await testInfo.attach("grant-analyse-diagnostics-"+viewport.name,{path:dir+"/diagnostics.json",contentType:"application/json"});
    };

    try{
      await signInToGrantIntelligenceFixture(page);
      await expect(register.getByRole("heading",{name:"Opportunity register",exact:true})).toBeVisible({timeout:30000});
      await expect(register.locator("article")).toHaveCount(3,{timeout:30000});
      const tanzania=opportunityCard("Tanzania Pastoral Rangeland Resilience Grant");
      const outsideTanzania=opportunityCard("East Africa Regional Biodiversity Fund");
      const missingDetails=opportunityCard("Pastoral Community Innovation Opportunity");
      for(const [title,card] of [
        ["Tanzania Pastoral Rangeland Resilience Grant",tanzania],
        ["East Africa Regional Biodiversity Fund",outsideTanzania],
        ["Pastoral Community Innovation Opportunity",missingDetails]
      ]){
        expect(await card.count(),`expected exactly one article for "${title}"`).toBe(1);
        await expect(card).toBeVisible({timeout:30000});
      }

      selectedArticle=tanzania;
      analyseButton=tanzania.getByRole("button",{name:"Analyse",exact:true});
      expect(await analyseButton.count(),"exactly one Analyse button inside the selected article").toBe(1);
      await tanzania.locator("details > summary").click();
      await expect(analyseButton).toBeEnabled();
      recordingAfterClick=true;
      await analyseButton.click();
      await expect.poll(()=>evaluationCalls,{timeout:7000,message:"Analyse must issue exactly one request to the configured mock Worker URL"}).toBe(1);
      await expect.poll(()=>pipelineRequests[0]?.status,{timeout:7000,message:"mock Worker response must be HTTP 200"}).toBe(200);
      await expect(page.getByText("Conditionally eligible",{exact:true})).toBeVisible();
      await expect(page.getByText(/Geographic eligibility: Pass/)).toBeVisible();
      await expect(page.getByText("Confirm applicant registration requirements.",{exact:true})).toBeVisible();
      await expect(page.getByText("Fit 84/100",{exact:true})).toBeVisible();
      await expect(page.getByText("AI-generated, verify before use.",{exact:true})).toBeVisible();

      selectedArticle=missingDetails;
      analyseButton=missingDetails.getByRole("button",{name:"Analyse",exact:true});
      await missingDetails.locator("details > summary").click();
      await expect(analyseButton).toBeEnabled();
      await page.clock.install();
      responseMode="timeout";
      await analyseButton.click();
      await expect(missingDetails.getByText(/Evaluating eligibility/)).toBeVisible();
      await page.clock.fastForward(30050);
      await expect(missingDetails.getByRole("alert")).toContainText("timed out after 30 seconds");
      await expect(missingDetails.getByRole("button",{name:"Retry",exact:true})).toBeVisible();
      await page.clock.resume();

      selectedArticle=outsideTanzania;
      analyseButton=outsideTanzania.getByRole("button",{name:"Analyse",exact:true});
      await outsideTanzania.locator("details > summary").click();
      responseMode="server-error";
      await expect(analyseButton).toBeEnabled();
      await analyseButton.click();
      await expect(outsideTanzania.getByRole("alert")).toContainText("Mock pipeline service unavailable.");
      responseMode="success";
      await outsideTanzania.getByRole("button",{name:"Retry",exact:true}).click();
      await expect(page.getByText("Conditionally eligible",{exact:true}).last()).toBeVisible();
      await expect(page.getByText("Fit 84/100",{exact:true}).last()).toBeVisible();

      expect(evaluationCalls,"expected success, timeout, server error and retry requests").toBe(4);
      expect(blockedHosts.size,"no request may target a real backend host").toBe(0);
      expect(pageErrors,"no uncaught browser errors").toEqual([]);
    }catch(error){
      await captureFailureEvidence();
      throw error;
    }
  });
}
