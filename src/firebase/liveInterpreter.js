import {auth} from "./config";

const ENDPOINT="https://irpa-live-interpreter.irpa-governance.workers.dev/api/translate";

export async function translateMeetingPhrase({meetingId,content,targetLanguage,sourceLanguage}){
  const user=auth.currentUser;
  if(!user)throw new Error("Sign in to use the live interpreter.");
  const token=await user.getIdToken();
  const response=await fetch(ENDPOINT,{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+token},
    body:JSON.stringify({meetingId,content,targetLanguage,sourceLanguage})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||"The live interpreter could not translate this phrase.");
  return result;
}
