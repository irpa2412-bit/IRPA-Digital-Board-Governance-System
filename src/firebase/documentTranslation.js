import {auth} from "./config";

const ENDPOINT="https://irpa-live-interpreter.irpa-governance.workers.dev/api/document-translate";

export async function translateDocumentChunk({requestId,content,targetLanguage,sourceLanguage}){
  const user=auth.currentUser;
  if(!user)throw new Error("Sign in to process a document translation request.");
  const text=String(content||"");
  if(!text.trim())return {translatedText:"",provider:"No content"};
  if(text.length>2500)throw new Error("A document translation chunk must not exceed 2,500 characters.");
  const token=await user.getIdToken();
  const response=await fetch(ENDPOINT,{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+token},
    body:JSON.stringify({requestId,content:text,targetLanguage,sourceLanguage})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||"The document translation service could not translate this section.");
  return result;
}
