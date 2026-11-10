export const SOCIAL_ACCEPTANCE_PLATFORMS=Object.freeze([{id:"facebook",label:"Facebook"},{id:"instagram",label:"Instagram"},{id:"linkedin",label:"LinkedIn"},{id:"x",label:"X"},{id:"youtube",label:"YouTube"},{id:"whatsapp",label:"WhatsApp"}]);
const ok=status=>Number.isInteger(status)&&status>=200&&status<300;
export async function runSocialPlatformAcceptance({request,approvalReason,onStep=()=>{},runId="TEST-"+Date.now(),timeoutMs=60000,retries=1}){
 if(typeof request!=="function")throw new TypeError("A request function is required.");
 const reason=String(approvalReason||"").trim(),rows=[],createdItems=[],total=SOCIAL_ACCEPTANCE_PLATFORMS.length*6+1;let number=0;
 const emit=row=>onStep([...rows],{...row});
 async function perform(name,path,method,payload,requiresItem=false){
  number++;const row={step:number,total,name,status:"RUNNING",httpStatus:null,detail:"Request in progress."};rows.push(row);emit(row);
  if(requiresItem&&!payload?.id){Object.assign(row,{status:"FAIL",detail:"No TEST item ID is available because its create step failed."});emit(row);return null;}
  let lastError="";
  for(let attempt=0;attempt<=retries;attempt++){
   try{const result=await request(path,method,payload?.body,timeoutMs),status=Number(result?.httpStatus??result?.status??0),data=result?.data??result?.body??{};row.httpStatus=status||"—";if(ok(status)){Object.assign(row,{status:"PASS",detail:String(data.message||data.item?.status||"Request completed.")});emit(row);return data;}lastError=String(result?.error||data.error||data.message||"Request returned HTTP "+status+".");}
   catch(error){lastError=String(error?.message||error||"Request failed.");row.httpStatus=error?.httpStatus||"—";}
   if(attempt<retries){row.status="RUNNING";row.detail="Retrying once after: "+lastError;emit(row);}
  }
  Object.assign(row,{status:"FAIL",detail:lastError||"Request failed after one retry."});emit(row);return null;
 }
 for(const platform of SOCIAL_ACCEPTANCE_PLATFORMS){
  const title="TEST "+platform.label+" "+runId;
  const create=await perform(platform.label+" - create TEST item","/api/communications/editorial/items","POST",{body:{kind:"post",title,content:"TEST ONLY - "+platform.label+" acceptance content. Not for publication.",platforms:[platform.id],campaignTag:runId,language:"en"}});
  const item=create?.item;if(item?.id)createdItems.push({id:item.id,title:item.title,platform:platform.label,runId,status:item.status||"Draft"});const id=item?.id||"";
  await perform(platform.label+" - edit TEST item","/api/communications/editorial/items/"+encodeURIComponent(id),"PATCH",{id,body:{title:title+" - edited",content:"TEST ONLY - "+platform.label+" edited acceptance content. Not for publication."}},true);
  await perform(platform.label+" - revise TEST item","/api/communications/editorial/items/"+encodeURIComponent(id),"PATCH",{id,body:{title:title+" - revised",content:"TEST ONLY - "+platform.label+" revised acceptance content. Not for publication."}},true);
  await perform(platform.label+" - submit TEST item for approval","/api/communications/editorial/items/"+encodeURIComponent(id)+"/submit","POST",{id,body:{}},true);
  await perform(platform.label+" - approve TEST item (sole administrator)","/api/communications/editorial/items/"+encodeURIComponent(id)+"/approve","POST",{id,body:{reason}},true);
  await perform(platform.label+" - export TEST item (manual only)","/api/communications/editorial/items/"+encodeURIComponent(id)+"/exported","POST",{id,body:{}},true);
 }
 const inventory=await perform("List retained TEST items with IDs","/api/communications/editorial/items","GET",null);
 const listed=Array.isArray(inventory?.items)?inventory.items.filter(item=>item.campaignTag===runId||String(item.title||"").includes(runId)):[];
 const all=new Map();for(const item of [...createdItems,...listed.map(item=>({id:item.id,title:item.title,platform:(item.platforms||[])[0]||"unknown",runId,status:item.status||"Unknown"}))])if(item.id)all.set(item.id,item);
 const items=[...all.values()];rows[rows.length-1].detail="Found "+items.length+" retained TEST item(s) for run "+runId+".";emit(rows[rows.length-1]);return {runId,rows,items,total};
}