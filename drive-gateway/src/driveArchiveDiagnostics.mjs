const FOLDER_MIME="application/vnd.google-apps.folder";
const maskId=value=>value?("…"+String(value).slice(-6)):null;
const reasonOf=data=>String(data?.error?.errors?.[0]?.reason||data?.error?.status||"").replace(/[^A-Z0-9_.-]/gi,"").slice(0,80)||null;
async function driveGet(token,path){
 const response=await fetch("https://www.googleapis.com"+path,{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});
 const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{}
 return{status:response.status,ok:response.ok,data,reason:reasonOf(data)};
}
async function listNamedFolders(token,name,parentId){
 const q=[`name='${String(name).replaceAll("'","\\\\'")}'`,`mimeType='${FOLDER_MIME}'`,"trashed=false",parentId?`'${parentId}' in parents`:null].filter(Boolean).join(" and ");
 let pageToken=null;const files=[];
 do{
  const params=new URLSearchParams({q,spaces:"drive",pageSize:"1000",fields:"nextPageToken,files(id,name,parents,owners(displayName,emailAddress),createdTime,appProperties,capabilities(canAddChildren))"});
  if(pageToken)params.set("pageToken",pageToken);
  const result=await driveGet(token,"/drive/v3/files?"+params.toString());
  if(!result.ok)return{...result,files:[]};
  files.push(...(Array.isArray(result.data.files)?result.data.files:[]));
  pageToken=result.data.nextPageToken||null;
 }while(pageToken);
 return{status:200,ok:true,reason:null,files};
}
export async function probeDriveArchiveDestinations({env,helpers,paths=[]}={}){
 const destinations=(paths||[]).map(item=>typeof item==="string"?{name:item,path:item}:{...item});
 let token;
 try{token=await helpers.getDriveAccessToken(env);}
 catch(error){return{tokenRefreshResult:"FAILED",tokenRefreshReason:String(error?.code||error?.name||"TOKEN_REFRESH_FAILED").slice(0,80),oauthScopes:null,quota:{usedBytes:null,freeBytes:null,limitBytes:null},destinations:destinations.map(item=>({name:item.name||item.path,folderIdMasked:null,probe:"DENIED",httpStatus:401,reasonCode:"TOKEN_REFRESH_FAILED",matchedByName:0,creator:"NOT_RECORDED",owner:null}))};}
 let oauthScopes=null,quota={usedBytes:null,freeBytes:null,limitBytes:null};
 try{const info=await fetch("https://oauth2.googleapis.com/tokeninfo?access_token="+encodeURIComponent(token));if(info.ok){const data=await info.json();oauthScopes=String(data.scope||"").split(/\\s+/).filter(Boolean);}}catch{}
 try{const about=await driveGet(token,"/drive/v3/about?fields=storageQuota(limit,usage,usageInDrive,usageInDriveTrash)");if(about.ok){const q=about.data.storageQuota||{},limit=q.limit==null?null:Number(q.limit),used=q.usage==null?null:Number(q.usage);quota={usedBytes:used,freeBytes:limit==null||used==null?null:Math.max(0,limit-used),limitBytes:limit};}}catch{}
 const results=[];
 for(const item of destinations){
  const segments=String(item.path||"").split("/").filter(Boolean);segments.pop();
  let parentId=null,last=null,failed=null,ambiguous=false,matched=0;
  for(const segment of segments){
   const listing=await listNamedFolders(token,segment,parentId);
   if(!listing.ok){failed={httpStatus:listing.status,reasonCode:listing.reason||"DRIVE_FOLDER_LOOKUP_FAILED"};break;}
   matched=listing.files.length;
   if(!matched){failed={httpStatus:listing.status,reasonCode:"FOLDER_NOT_FOUND"};break;}
   if(matched>1){ambiguous=true;failed={httpStatus:listing.status,reasonCode:"MULTIPLE_FOLDER_MATCHES"};break;}
   last=listing.files[0];parentId=last.id;
  }
  let capabilityStatus=null,capabilityReason=null,canAddChildren=false;
  if(!failed&&last){
   const capability=await driveGet(token,"/drive/v3/files/"+encodeURIComponent(last.id)+"?fields=id,capabilities(canAddChildren)");
   capabilityStatus=capability.status;capabilityReason=capability.reason;
   canAddChildren=capability.ok&&capability.data?.capabilities?.canAddChildren===true;
   if(!capability.ok)failed={httpStatus:capability.status,reasonCode:capability.reason||"DRIVE_CAPABILITY_LOOKUP_FAILED"};
   else if(!canAddChildren)failed={httpStatus:capability.status,reasonCode:"CAN_ADD_CHILDREN_FALSE"};
  }
  results.push({
   name:item.name||segments.at(-1)||item.path,
   destinationType:item.destinationType||"archive",
   archiveKey:item.archiveKey||null,
   path:item.path,
   folderIdMasked:maskId(last?.id),
   probe:failed||ambiguous?"DENIED":"PASS",
   httpStatus:failed?.httpStatus??capabilityStatus??200,
   reasonCode:failed?.reasonCode??capabilityReason,
   matchedByName:matched,
   creator:last?.appProperties?.irpaCreatedBy||"NOT_RECORDED",
   creatorSource:last?.appProperties?.irpaCreatedBy?"appProperties.irpaCreatedBy":"NOT_RECORDED",
   owner:last?.owners?.[0]?.emailAddress||last?.owners?.[0]?.displayName||null,
   createdTime:last?.createdTime||null,
   canAddChildren,
   oauthScopes,
   tokenRefreshResult:"SUCCESS",
   quotaUsedBytes:quota.usedBytes,
   quotaFreeBytes:quota.freeBytes,
   quotaLimitBytes:quota.limitBytes
  });
 }
 return{tokenRefreshResult:"SUCCESS",oauthScopes,quota,destinations:results};
}
