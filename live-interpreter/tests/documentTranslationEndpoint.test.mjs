import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const origin="https://irpa-digital-board-governance-frontend.irpa-governance.workers.dev";
const requestRecord={
  requestType:"DOCUMENT_TRANSLATION",documentId:"LIFE-test-1",documentOwnerUid:"owner-uid",requestedByUid:"owner-uid",
  sourceLanguage:"en",targetLanguage:"maa",status:"IN_REVIEW",contentTransferAuthorized:true,contentTransferred:false
};
function restValue(value){
  if(typeof value==="boolean")return{booleanValue:value};
  if(typeof value==="number")return{integerValue:String(value)};
  return{stringValue:String(value)};
}
function restDocument(data){return{fields:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,restValue(value)]))};}
function mockFetch({uid="owner-uid",requestData=requestRecord}={}){
  return async input=>{
    const url=String(input);
    if(url.includes("identitytoolkit.googleapis.com/v1/accounts:lookup")){
      return new Response(JSON.stringify({users:[{localId:uid,email:uid+"@example.test"}]}),{status:200,headers:{"content-type":"application/json"}});
    }
    if(url.includes("firestore.googleapis.com")&&url.includes("/documents/documentTranslationRequests/request-1")){
      return new Response(JSON.stringify(restDocument(requestData)),{status:200,headers:{"content-type":"application/json"}});
    }
    if(url.includes("firestore.googleapis.com")&&/\/(adminProfiles|members|employees)\//.test(url)){
      return new Response(JSON.stringify({error:{message:"NOT_FOUND"}}),{status:404,headers:{"content-type":"application/json"}});
    }
    throw new Error("Unexpected mocked network request: "+url);
  };
}
async function invoke({uid="owner-uid",requestData=requestRecord,body={requestId:"request-1",content:"Thank you for the water.",sourceLanguage:"en-TZ",targetLanguage:"maa"}}={}){
  const previous=globalThis.fetch;
  globalThis.fetch=mockFetch({uid,requestData});
  try{
    const request=new Request("https://irpa-live-interpreter.irpa-governance.workers.dev/api/document-translate",{
      method:"POST",headers:{origin,authorization:"Bearer test-token","content-type":"application/json"},body:JSON.stringify(body)
    });
    return await worker.fetch(request,{});
  }finally{globalThis.fetch=previous;}
}

test("authenticated document owner receives dictionary-assisted English-to-Maa output",async()=>{
  const response=await invoke();
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.ok,true);
  assert.equal(result.dictionaryAssisted,true);
  assert.equal(result.requiresHumanReview,true);
  assert.match(result.translatedText,/Ashe/);
  assert.match(result.translatedText,/enkare/i);
  assert.equal(result.coverage,"partial");
});

test("authenticated document owner receives dictionary-assisted Kiswahili-to-Maa output",async()=>{
  const response=await invoke({
    requestData:{...requestRecord,sourceLanguage:"sw"},
    body:{requestId:"request-1",content:"Asante kwa maji mengi sana.",sourceLanguage:"sw-TZ",targetLanguage:"maa"}
  });
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.ok,true);
  assert.equal(result.dictionaryAssisted,true);
  assert.match(result.translatedText,/ashe/i);
  assert.match(result.translatedText,/enkare/i);
  assert.match(result.translatedText,/oleng/i);
});

test("document translation API rejects requests before explicit content-transfer consent",async()=>{
  const response=await invoke({requestData:{...requestRecord,status:"REQUESTED",contentTransferAuthorized:false}});
  assert.equal(response.status,409);
});

test("document translation API rejects a user who is neither owner nor authorised reviewer",async()=>{
  const response=await invoke({uid:"unrelated-user"});
  assert.equal(response.status,403);
});

test("Maa output rejects unsupported source languages",async()=>{
  const response=await invoke({requestData:{...requestRecord,sourceLanguage:"AUTO"},body:{requestId:"request-1",content:"Merci beaucoup",sourceLanguage:"fr-FR",targetLanguage:"maa"}});
  assert.equal(response.status,400);
});
