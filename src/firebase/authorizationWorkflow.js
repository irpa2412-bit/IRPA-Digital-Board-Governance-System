import { auth } from "./config";

const WORKFLOW="Authorization";
const MODULE="Authorization & Approvals";
const ROLES={
  reviewer:["Director Internal Oversight","Internal Oversight Officer","Director Human Resources","HR Manager","Director Finance & Administration","Finance Manager","Programme/Technical Officer","Operations Manager"],
  approver:["Executive Director"],
  implementer:["Executive Director","Director Finance & Administration","Finance Manager","Operations Manager","Programme/Technical Officer","Director Human Resources","HR Manager"]
};

async function callAuthorizationWorkflow(operation,data={}){
  const user=auth.currentUser;
  if(!user?.uid)throw new Error("Authentication is required.");
  const token=await user.getIdToken();
  const gateway=String(import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_URL||"https://irpa-google-drive-gateway.irpa-governance.workers.dev").trim().replace(/\/+$/, "");
  let response;
  try{
    response=await fetch(gateway+"/api/authorization/workflows",{
      method:"POST",
      headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify({operation,...data})
    });
  }catch{
    throw new Error("Cloudflare Authorisation service is unavailable. No Firebase callable or client-side Firestore fallback was used.");
  }
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result.ok!==true)throw new Error(result.error||"The Authorisation workflow operation failed.");
  return result;
}

export async function getAuthorizationWorkflows(){
  const result=await callAuthorizationWorkflow("list");
  return Array.isArray(result.workflows)?result.workflows:[];
}
export async function createAuthorizationWorkflow(input){
  if(!String(input?.title||"").trim()||!String(input?.justification||"").trim())throw new Error("Title and justification are required.");
  const result=await callAuthorizationWorkflow("create",{data:input||{}});
  return result.id;
}
export async function transitionAuthorization(id,next,decision=""){
  if(!id||!next)throw new Error("A workflow record and target stage are required.");
  await callAuthorizationWorkflow("transition",{id,next,decision});
}
export {ROLES,WORKFLOW,MODULE};
