const TEAM_ROLES=new Set(["Procurement Officer","Procurement Manager","Procurement Team Member"]);
const APPROVER_ROLES=new Set(["Executive Director","Director Livestock","Livestock Director","Director Internal Oversight","Internal Oversight Director","Director Finance & Administration","Finance Manager","Accountant","Finance Officer","Director Human Resources","Director Outreach","Director Community Development","Director Environment","Director Field","Director Operations","Operations Director","Outreach Director","Community Development Director","Environment Director","Field Director"]);
const GOODS=new Set(["Office Supplies & Stationery","ICT Equipment & Services","Furniture & Office Equipment","Vehicles & Transport Services","Vehicle Maintenance & Spare Parts","Fuel & Lubricants","Construction & Civil Works","Building Maintenance & Repairs","Water Infrastructure & Borehole Services","Solar Energy & Electrical Services","Livestock & Veterinary Supplies","Animal Health Services","Livestock Equipment & Infrastructure","Agricultural Inputs & Fodder","Rangeland Restoration & Environmental Services","Tree Seedlings & Nursery Supplies","Research & Consultancy Services","Training & Capacity Development","Travel & Accommodation Services","Communication & Media Services","Printing & Branding Services","Security Services","Cleaning & Sanitation Services","Professional & Legal Services","Insurance Services","Financial & Audit Services","Events & Conference Services","Food & Catering Services","Logistics & Freight Services","Others"]);
const UNITS={
"Governance":["Governance Unit","Board Governance Unit"],"Executive Office":["Executive Director's Office","Management Coordination Unit"],"Internal Oversight":["Internal Oversight Unit","Compliance & Assurance Unit"],"Livestock Development":["Livestock Production Unit","Veterinary Services Unit","Breeding & Genetics Unit","Livestock Infrastructure Unit"],"Environment & Sustainable Rangeland Management":["Rangeland Management Unit","Rangeland Restoration Unit","Invasive Species Control Unit","Climate Change & Resilience Unit","Environmental Conservation & Education Unit"],"Finance & Administration":["Finance Unit","Accounting Unit","Administration Unit","Procurement Unit"],"Human Resources":["Human Resources & Staff Welfare Unit","Training & Capacity Development Unit","Personnel & Records Unit"],"Outreach":["Communications & Outreach Unit","Partnerships & Resource Mobilization Unit","ICT & Digital Engagement Unit"],"Community Development":["Community Mobilization Unit","Women & Youth Empowerment Unit","Gender & Social Inclusion Unit"],"Field Department":["Field Implementation Unit","Monitoring, Evaluation, Accountability & Learning Unit","Community-Based Monitoring Unit"],"Operations":["Logistics & Transport Unit","Infrastructure & Facilities Unit","General Operations Unit"]};
const DEPARTMENTS=new Set(Object.keys(UNITS));
const METHODS={"Request for Quotations":{min:3,max:3,default:3},"Competitive Tender":{min:1,max:10,default:3},"Direct Procurement":{min:1,max:1,default:1},"Framework Contract":{min:1,max:1,default:1}};
const CRITERIA={quality:2,delivery:2,compliance:2,value:2,responsiveness:1,documentation:1};
const clean=v=>String(v??"").trim();
const lower=v=>clean(v).toLowerCase();
const money=v=>{const n=Number(v);return Number.isFinite(n)?Math.round(n*100)/100:0;};
const monthsAfter=(value,months)=>{const d=new Date(value);d.setMonth(d.getMonth()+months);return d;};

function decode(v){if(!v)return null;if("stringValue"in v)return v.stringValue;if("booleanValue"in v)return v.booleanValue;if("integerValue"in v)return Number(v.integerValue);if("doubleValue"in v)return v.doubleValue;if("timestampValue"in v)return v.timestampValue;if("nullValue"in v)return null;if("arrayValue"in v)return(v.arrayValue.values||[]).map(decode);if("mapValue"in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));return null;}
function encode(v){if(v===null||v===undefined)return{nullValue:null};if(v instanceof Date)return{timestampValue:v.toISOString()};if(typeof v==="boolean")return{booleanValue:v};if(typeof v==="number")return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};if(Array.isArray(v))return{arrayValue:{values:v.map(encode)}};if(typeof v==="object")return{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};return{stringValue:String(v)};}
const fields=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,encode(v)]));

export function createProcurementServicesRouter(ctx){
 return async function procurementServicesRouter(request,env,pathname){
  if(pathname!=="/api/procurement/action"||request.method!=="POST")return null;
  let claims,data;
  try{claims=await ctx.authenticateFirebaseRequest(request,env);}catch{return ctx.json({ok:false,error:"A valid IRPA sign-in is required."},401,ctx.corsHeaders(request));}
  try{data=await request.json();}catch{return ctx.json({ok:false,error:"A valid JSON request is required."},400,ctx.corsHeaders(request));}
  const operation=clean(data.operation),input=data.data&&typeof data.data==="object"?data.data:{};
  const project=ctx.getFirebaseProjectId(env),token=await ctx.getFirestoreAdminAccessToken(env),base="projects/"+project+"/databases/(default)/documents";
  async function read(col,id){if(!id||String(id).includes("/"))return null;const res=await fetch("https://firestore.googleapis.com/v1/"+base+"/"+col+"/"+encodeURIComponent(id),{headers:{Authorization:"Bearer "+token}});if(res.status===404)return null;if(!res.ok)throw new Error("Procurement record lookup failed.");const d=await res.json();return{id:String(d.name||"").split("/").pop(),updateTime:d.updateTime||null,...Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,decode(v)]))};}
  async function query(col,field,value){const res=await fetch("https://firestore.googleapis.com/v1/"+base+":runQuery",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({structuredQuery:{from:[{collectionId:col}],where:{fieldFilter:{field:{fieldPath:field},op:"EQUAL",value:encode(value)}},limit:100}})});if(!res.ok)throw new Error("Procurement register lookup failed.");return(await res.json()).filter(x=>x.document).map(x=>({id:String(x.document.name||"").split("/").pop(),updateTime:x.document.updateTime||null,...Object.fromEntries(Object.entries(x.document.fields||{}).map(([k,v])=>[k,decode(v)]))}));}
  async function commit(writes){const res=await fetch("https://firestore.googleapis.com/v1/"+base+":commit",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({writes})});if(!res.ok){const e=new Error("Procurement record and audit could not be committed atomically.");e.status=res.status;throw e;}return res.json();}
  const [admin,member,employee]=await Promise.all([read("adminProfiles",claims.user_id),read("members",claims.user_id),read("employees",claims.user_id)]);
  const isAdmin=admin?.active===true;
  const activeProfile=[member,employee].find(x=>x&&(x.status==="Active"||x.status==="Activated"||x.registrationStatus==="Activated"||x.employmentStatus==="Active"));
  if(!isAdmin&&!activeProfile)return ctx.json({ok:false,error:"An active IRPA member or employee department profile is required."},403,ctx.corsHeaders(request));
  const actor={uid:claims.user_id,email:lower(claims.email||activeProfile?.email),name:clean(activeProfile?.name||activeProfile?.fullName||claims.email),role:clean(activeProfile?.role),department:clean(activeProfile?.department),unit:clean(activeProfile?.unit),authorizationType:clean(activeProfile?.authorizationType)};
  const team=isAdmin||actor.authorizationType==="administrator"||actor.role==="Administrator"||TEAM_ROLES.has(actor.role)||(actor.department==="Finance & Administration"&&actor.unit==="Procurement Unit");
  const approver=isAdmin||actor.authorizationType==="administrator"||actor.role==="Administrator"||APPROVER_ROLES.has(actor.role);
  const deny=(message,status=403)=>ctx.json({ok:false,error:message},status,ctx.corsHeaders(request));
  const audit=(action,col,id,details={})=>({update:{name:base+"/audit/"+crypto.randomUUID(),fields:fields({action,collection:col,recordId:id,details,actorUid:actor.uid,actorEmail:actor.email||null,createdAt:new Date()})},currentDocument:{exists:false}});
  const update=(col,id,record,mask)=>({update:{name:base+"/"+col+"/"+id,fields:fields(record)},updateMask:{fieldPaths:mask||Object.keys(record)},...(record._precondition?{currentDocument:{updateTime:record._precondition}}:{})});
  const writeExisting=(col,id,record,doc)=>({update:{name:base+"/"+col+"/"+id,fields:fields(record)},updateMask:{fieldPaths:Object.keys(record)},currentDocument:doc?.updateTime?{updateTime:doc.updateTime}:{exists:false}});
  const nextCounter=async(counter,prefix)=>{
    const old=await read("systemSettings","procurementCounters"),n=Number(old?.[counter]||0)+1;
    const value=prefix+"-"+new Date().getFullYear()+"-"+String(n).padStart(5,"0");
    return {value,write:{update:{name:base+"/systemSettings/procurementCounters",fields:fields({[counter]:n,updatedAt:new Date()})},updateMask:{fieldPaths:[counter,"updatedAt"]},currentDocument:old?.updateTime?{updateTime:old.updateTime}:{exists:false}}};
  };
  const getRequest=async id=>{if(!id||String(id).includes("/"))throw new Error("A valid procurement request ID is required.");const r=await read("procurementRequests",id);if(!r)throw new Error("Procurement request not found.");return r;};
  try{
   if(operation==="refreshVendorRestriction"){
    if(!team)return deny("Procurement Team authorization is required.");
    const id=clean(input.id),v=await read("procurementVendors",id);if(!v)return deny("Vendor / service provider not found.",404);
    const now=new Date();let changes=null,blacklistWrite=null;
    if(v.status==="Blacklisted"||v.performanceStatus==="Blacklisted"){
      let start=v.blacklistStartedAt||v.enteredAt||v.blacklistedAt;
      if(!start){start=now;const bl=await read("procurementVendorBlacklist",id);const blValues={vendorId:id,blacklistStartedAt:now,updatedAt:now};blacklistWrite={update:{name:base+"/procurementVendorBlacklist/"+id,fields:fields(blValues)},updateMask:{fieldPaths:Object.keys(blValues)},...(bl?.updateTime?{currentDocument:{updateTime:bl.updateTime}}:{currentDocument:{exists:false}})};}
      const probationAt=monthsAfter(start,6);
      if(now>=probationAt){const probationStart=v.probationStartedAt||probationAt;changes={status:"Probation",performanceStatus:"Probation",probationStartedAt:probationStart,probationEndsAt:monthsAfter(probationStart,3),probationEngagements:0,blacklistStartedAt:start,updatedAt:now};}
      else if(!v.blacklistStartedAt)changes={blacklistStartedAt:start,performanceStatus:"Blacklisted",updatedAt:now};
    }else if(v.status==="Probation"&&v.probationStartedAt){
      const end=v.probationEndsAt||monthsAfter(v.probationStartedAt,3);
      if(now>=new Date(end))changes={status:"Approved",performanceStatus:"Eligible",probationEngagements:0,probationCompletedAt:now,updatedAt:now};
    }
    if(changes){const writes=[{update:{name:base+"/procurementVendors/"+id,fields:fields(changes)},updateMask:{fieldPaths:Object.keys(changes)},currentDocument:{updateTime:v.updateTime}},audit("PROCUREMENT_VENDOR_RESTRICTION_REFRESHED","procurementVendors",id,{from:v.status,to:changes.status||v.status})];if(blacklistWrite)writes.push(blacklistWrite);await commit(writes);return ctx.json({ok:true,vendor:{...v,...changes}},200,ctx.corsHeaders(request));}
    return ctx.json({ok:true,vendor:v},200,ctx.corsHeaders(request));
   }
   if(operation==="createVendor"){
    const name=clean(input.name),serviceType=clean(input.serviceType),serviceTypeOther=clean(input.serviceTypeOther),businessLocation=clean(input.businessLocation),bankName=clean(input.bankName),bankBranch=clean(input.bankBranch),bankAccountName=clean(input.bankAccountName),bankAccountNumber=clean(input.bankAccountNumber),bankAddress=clean(input.bankAddress),swiftCode=clean(input.swiftCode).toUpperCase();
    if(!name)return deny("Vendor / service provider name is required.",400);
    if(!GOODS.has(serviceType))return deny("Select a goods/service from the controlled list.",400);
    if((serviceType==="Others"||serviceType==="Other")&&!serviceTypeOther)return deny("Please clarify the Others selection.",400);
    if(!businessLocation||!bankName||!bankBranch||!bankAccountName||!bankAccountNumber||!bankAddress||!swiftCode)return deny("Complete the compulsory business location and bank details.",400);
    if(!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(swiftCode))return deny("Enter a valid SWIFT / BIC code (8 or 11 characters).",400);
    if((await query("procurementVendors","name",name)).length)return deny("This vendor / service provider is already registered.",409);
    const counter=await nextCounter("vendorRegistrationNumber","IRPA-VSP"),id=crypto.randomUUID(),now=new Date();
    const vendor={...input,name,serviceType,serviceTypeOther:serviceType==="Others"?serviceTypeOther:"",businessLocation,bankName,bankBranch,bankAccountName,bankAccountNumber,bankAddress,swiftCode,vendorRegistrationNumber:counter.value,status:"Pending Review",registeredByUid:actor.uid,registeredByEmail:actor.email,registeredByName:actor.name,createdAt:now,updatedAt:now};
    await commit([counter.write,{update:{name:base+"/procurementVendors/"+id,fields:fields(vendor)},currentDocument:{exists:false}},audit("PROCUREMENT_VENDOR_REGISTERED","procurementVendors",id,{name,vendorRegistrationNumber:counter.value,businessLocation,bankName,swiftCode})]);
    return ctx.json({ok:true,id,vendorRegistrationNumber:counter.value},200,ctx.corsHeaders(request));
   }
   if(operation==="createRequest"){
    const vendorId=clean(input.vendorId),v=await read("procurementVendors",vendorId);
    if(!v)return deny("Registered vendor / service provider not found.",404);
    if(!["Approved","Probation"].includes(v.status)||v.status==="Blacklisted"||v.performanceStatus==="Blacklisted")return deny("Only approved or probationary non-blacklisted vendors may be selected.",409);
    if(v.status==="Probation"&&Number(v.probationEngagements||0)>=2)return deny("This vendor has reached the maximum of 2 engagements during probation.",409);
    const method=METHODS[clean(input.procurementMethod)],department=clean(input.department),unit=clean(input.unit);
    if(!method)return deny("Select a valid procurement method.",400);
    if(!DEPARTMENTS.has(department)||!(UNITS[department]||[]).includes(unit))return deny("Select a valid IRPA department and unit.",400);
    const title=clean(input.title),description=clean(input.description),amount=money(input.estimatedAmount);
    if(!title||!description||amount<=0)return deny("Procurement title, scope and a positive estimated amount are required.",400);
    const required=Math.max(method.min,Math.min(method.max,Number(input.quotationRequiredCount||method.default)));
    const counters=await read("systemSettings","procurementCounters"),requestCount=Number(counters?.requestNumber||0)+1,documentCount=Number(counters?.documentReference||0)+1,requestNumber="IRPA-PREQ-"+new Date().getFullYear()+"-"+String(requestCount).padStart(5,"0"),documentReference="IRPA-DOC-"+new Date().getFullYear()+"-"+String(documentCount).padStart(5,"0");
    const counterWrite={update:{name:base+"/systemSettings/procurementCounters",fields:fields({requestNumber:requestCount,documentReference:documentCount,updatedAt:new Date()})},updateMask:{fieldPaths:["requestNumber","documentReference","updatedAt"]},...(counters?.updateTime?{currentDocument:{updateTime:counters.updateTime}}:{currentDocument:{exists:false}})};
    const id=crypto.randomUUID(),now=new Date(),requestRecord={requestNumber,documentReference,documentReferenceType:"Procurement Document",title,description,department,unit,estimatedAmount:amount,procurementMethod:clean(input.procurementMethod)||"Request for Quotations",quotationRequiredCount:required,vendorId:v.id,vendorName:v.name,vendorRegistrationNumber:v.vendorRegistrationNumber||v.registrationNumber||"",vendorStatus:v.status,status:"Quotations Required",quotationCount:0,requestedByUid:actor.uid,requestedByEmail:actor.email,requestedByName:actor.name,createdAt:now,updatedAt:now};
    const writes=[counterWrite,{update:{name:base+"/procurementRequests/"+id,fields:fields(requestRecord)},currentDocument:{exists:false}},audit("PROCUREMENT_REQUEST_INITIATED","procurementRequests",id,{requestNumber,documentReference,vendorStatus:v.status})];
    if(v.status==="Probation"){const vendorPatch={...v,probationEngagements:Number(v.probationEngagements||0)+1,updatedAt:now};delete vendorPatch.id;delete vendorPatch.updateTime;writes.push({update:{name:base+"/procurementVendors/"+vendorId,fields:fields(vendorPatch)},updateMask:{fieldPaths:["probationEngagements","updatedAt"]},currentDocument:{updateTime:v.updateTime}});}
    await commit(writes);return ctx.json({ok:true,id,requestNumber:number.value,documentReference:docRef.value},200,ctx.corsHeaders(request));
   }
   if(operation==="registerPR"){
    if(!team)return deny("Procurement Team authorization is required.");
    const r=await getRequest(clean(input.id));if(r.status!=="PR Registration")return deny("PR registration is not open.",409);
    const v=await read("procurementVendors",r.vendorId);if(!v||!["Approved","Probation"].includes(v.status))return deny("The vendor must be approved or on active probation.",409);
    const counter=await nextCounter("prNumber","IRPA-PR"),now=new Date(),changes={prNumber:counter.value,prRegisteredAt:now,prRegisteredByUid:actor.uid,vendorStatus:v.status,status:"Procurement Review",updatedAt:now};
    await commit([counter.write,{update:{name:base+"/procurementRequests/"+r.id,fields:fields(changes)},updateMask:{fieldPaths:Object.keys(changes)},currentDocument:{updateTime:r.updateTime}},audit("PROCUREMENT_PR_REGISTERED","procurementRequests",r.id,{prNumber:counter.value})]);
    return ctx.json({ok:true,prNumber:counter.value},200,ctx.corsHeaders(request));
   }
   if(operation==="reviewRequest"){
    if(!team)return deny("Procurement Team authorization is required.");
    const id=clean(input.id),decision=clean(input.decision),type=clean(input.type||"request"),now=new Date();
    if(!["Approved","Rejected"].includes(decision))return deny("Select Approved or Rejected.",400);
    if(type==="vendor"){const v=await read("procurementVendors",id);if(!v)return deny("Vendor not found.",404);const changes={status:decision==="Approved"?"Approved":"Rejected",reviewedByUid:actor.uid,reviewedByName:actor.name,reviewedAt:now,updatedAt:now};await commit([{update:{name:base+"/procurementVendors/"+id,fields:fields(changes)},updateMask:{fieldPaths:Object.keys(changes)},currentDocument:{updateTime:v.updateTime}},audit("PROCUREMENT_VENDOR_REVIEWED","procurementVendors",id,{decision})]);return ctx.json({ok:true},200,ctx.corsHeaders(request));}
    const r=await getRequest(id);if(r.status!=="Procurement Review")return deny("Procurement Team review is not open.",409);
    const changes={status:decision==="Approved"?"Pending Authorization":"Rejected",procurementReviewDecision:decision,procurementReviewedByUid:actor.uid,procurementReviewedAt:now,updatedAt:now};
    await commit([{update:{name:base+"/procurementRequests/"+id,fields:fields(changes)},updateMask:{fieldPaths:Object.keys(changes)},currentDocument:{updateTime:r.updateTime}},audit("PROCUREMENT_REQUEST_REVIEWED","procurementRequests",id,{decision})]);return ctx.json({ok:true},200,ctx.corsHeaders(request));
   }
   if(operation==="authorizeRequest"){
    if(!approver)return deny("An authorized IRPA officer is required.");
    if(clean(input.approverUid)!==actor.uid)return deny("Only the selected authorised officer may approve this procurement.");
    const id=clean(input.id),r=await getRequest(id);
    if(!APPROVER_ROLES.has(actor.role)&&!isAdmin&&actor.authorizationType!=="administrator")return deny("Your role is not an eligible procurement approver.");
    if(r.status!=="Pending Authorization")return deny("Authorization is not open.",409);
    if(r.requestedByUid===actor.uid)return deny("The procurement requester cannot authorize the same request.");
    const changes={status:"PO Generation",approverUid:actor.uid,authorizedByUid:actor.uid,authorizedByName:actor.name,authorizedByRole:actor.role,authorizedAt:new Date(),authorizationStatus:"Approved",updatedAt:new Date()};
    await commit([{update:{name:base+"/procurementRequests/"+id,fields:fields(changes)},updateMask:{fieldPaths:Object.keys(changes)},currentDocument:{updateTime:r.updateTime}},audit("PROCUREMENT_AUTHORIZED","procurementRequests",id,{approverUid:actor.uid,approverRole:actor.role})]);return ctx.json({ok:true},200,ctx.corsHeaders(request));
   }
   if(operation==="generatePO"){
    if(!team)return deny("Procurement Team authorization is required.");
    const r=await getRequest(clean(input.id));if(r.status!=="PO Generation")return deny("PO generation is not open.",409);
    const counter=await nextCounter("poNumber","IRPA-PO"),now=new Date(),changes={poNumber:counter.value,poGeneratedAt:now,poGeneratedByUid:actor.uid,status:"Delivery Note Required",updatedAt:now};
    await commit([counter.write,{update:{name:base+"/procurementRequests/"+r.id,fields:fields(changes)},updateMask:{fieldPaths:Object.keys(changes)},currentDocument:{updateTime:r.updateTime}},audit("PROCUREMENT_PO_GENERATED","procurementRequests",r.id,{poNumber:counter.value,prNumber:r.prNumber})]);return ctx.json({ok:true,poNumber:counter.value},200,ctx.corsHeaders(request));
   }
   if(operation==="scoreVendor"){
    if(!team)return deny("Procurement Team authorization is required.");
    const vendorId=clean(input.vendorId),year=Number(input.year),scores=input.scores||{};
    if(!Number.isInteger(year)||year<2020||year>2100)return deny("Enter a valid scoring year.",400);
    let total=0;for(const [key,max] of Object.entries(CRITERIA)){const n=Number(scores[key]);if(!Number.isFinite(n)||n<0||n>max)return deny("Invalid vendor score for "+key+".",400);total+=n;}
    const v=await read("procurementVendors",vendorId);if(!v)return deny("Vendor / service provider not found.",404);
    const scoreId=vendorId+"_"+year,oldScore=await read("procurementVendorScores",scoreId);if(oldScore)return deny("An annual performance score for this vendor already exists for "+year+".",409);
    const now=new Date(),blacklisted=total<6,score={vendorId,vendorRegistrationNumber:v.vendorRegistrationNumber||"",vendorName:v.name||"",year,scores,totalScore:total,maximumScore:10,threshold:6,performanceStatus:blacklisted?"Blacklisted":"Eligible",scoredByUid:actor.uid,scoredByName:actor.name,scoredAt:now,createdAt:now};
    const vendorChanges=blacklisted?{status:"Blacklisted",performanceStatus:"Blacklisted",blacklistScore:total,blacklistYear:year,blacklistStartedAt:now,probationEngagements:0,updatedAt:now}:{performanceScore:total,performanceScoreYear:year,performanceStatus:"Eligible",updatedAt:now};
    const writes=[{update:{name:base+"/procurementVendorScores/"+scoreId,fields:fields(score)},currentDocument:{exists:false}},{update:{name:base+"/procurementVendors/"+vendorId,fields:fields(vendorChanges)},updateMask:{fieldPaths:Object.keys(vendorChanges)},currentDocument:{updateTime:v.updateTime}},audit("PROCUREMENT_VENDOR_PERFORMANCE_SCORED","procurementVendorScores",scoreId,{vendorId,year,totalScore:total,performanceStatus:blacklisted?"Blacklisted":"Eligible"})];
    if(blacklisted){const bl=await read("procurementVendorBlacklist",vendorId),blChanges={vendorId,vendorRegistrationNumber:v.vendorRegistrationNumber||"",vendorName:v.name||"",reason:"Annual vendor/service provider performance score below 6 points.",score:total,threshold:6,scoreYear:year,status:"Active",enteredByUid:actor.uid,enteredByName:actor.name,enteredAt:now,blacklistStartedAt:now,probationEngagements:0,updatedAt:now};writes.push({update:{name:base+"/procurementVendorBlacklist/"+vendorId,fields:fields(blChanges)},updateMask:{fieldPaths:Object.keys(blChanges)},...(bl?.updateTime?{currentDocument:{updateTime:bl.updateTime}}:{currentDocument:{exists:false}})});}
    await commit(writes);return ctx.json({ok:true,scoreId,totalScore:total,blacklisted},200,ctx.corsHeaders(request));
   }
   if(operation==="reserveQuotationHash"){
    const id=clean(input.id),number=Number(input.number),fileHash=clean(input.fileHash),r=await getRequest(id);
    if(r.requestedByUid!==actor.uid)return deny("Only the procurement requester may upload quotations.");
    if(r.status!=="Quotations Required")return deny("Quotation upload is not open at this stage.",409);
    const method=METHODS[r.procurementMethod]||METHODS["Request for Quotations"],required=Number(r.quotationRequiredCount||method.default);
    if(!Number.isInteger(number)||number<1||number>required)return deny("Quotation number is outside the required range.",400);
    if(!/^[a-f0-9]{64}$/i.test(fileHash))return deny("A valid SHA-256 quotation hash is required.",400);
    const existing=await read("procurementQuotationHashes",fileHash);
    if(existing&&(existing.requestId!==id||Number(existing.quotationNumber)!==number))return deny("DUPLICATE QUOTATION REJECTED: this document is already registered to another quotation.",409);
    if(!existing){const now=new Date();await commit([{update:{name:base+"/procurementQuotationHashes/"+fileHash,fields:fields({requestId:id,requestNumber:r.requestNumber,quotationNumber:number,fileHash,uploadedByUid:actor.uid,uploadedAt:now,status:"Reserved",reservationOnly:true})},currentDocument:{exists:false}},audit("PROCUREMENT_QUOTATION_HASH_RESERVED","procurementQuotationHashes",fileHash,{requestId:id,quotationNumber:number})]);}
    return ctx.json({ok:true,reserved:true},200,ctx.corsHeaders(request));
   }
   if(operation==="registerQuotation"){
    const id=clean(input.id),number=Number(input.number),r=await getRequest(id);
    if(r.requestedByUid!==actor.uid)return deny("Only the procurement requester may upload quotations.");
    if(r.status!=="Quotations Required")return deny("Quotation upload is not open at this stage.",409);
    const method=METHODS[r.procurementMethod]||METHODS["Request for Quotations"],required=Number(r.quotationRequiredCount||method.default);
    if(!Number.isInteger(number)||number<1||number>required)return deny("Quotation number is outside the required range.",400);
    if(!clean(input.fileId)||!clean(input.fileHash))return deny("Quotation file ID and SHA-256 hash are required.",400);
    const hashId=clean(input.fileHash),hashDoc=await read("procurementQuotationHashes",hashId);
    if(hashDoc&&(hashDoc.requestId!==id||Number(hashDoc.quotationNumber)!==number))return deny("DUPLICATE QUOTATION REJECTED: this document is already registered to another quotation.",409);
    const quotes=[...(r.quotations||[])];quotes[number-1]={number,fileName:clean(input.fileName),fileId:clean(input.fileId),fileHash:hashId,webViewLink:input.webViewLink||null,archiveUidLink:input.archiveUidLink||null,uploadedByUid:actor.uid,uploadedAt:new Date()};
    const count=quotes.filter(Boolean).length,now=new Date(),changes={quotations:quotes,quotationCount:count,procurementArchiveUidLink:input.archiveUidLink||r.procurementArchiveUidLink||null,procurementArchiveFolderId:input.archiveFolderId||r.procurementArchiveFolderId||null,status:count>=required?"PR Registration":"Quotations Required",updatedAt:now};
    const writes=[];
    if(!hashDoc)writes.push({update:{name:base+"/procurementQuotationHashes/"+hashId,fields:fields({requestId:id,requestNumber:r.requestNumber,quotationNumber:number,fileHash:hashId,uploadedByUid:actor.uid,uploadedAt:now,status:"Registered",reservationOnly:false})},currentDocument:{exists:false}});else if(hashDoc.reservationOnly){writes.push({update:{name:base+"/procurementQuotationHashes/"+hashId,fields:fields({status:"Registered",reservationOnly:false,uploadedAt:now})},updateMask:{fieldPaths:["status","reservationOnly","uploadedAt"]},currentDocument:{updateTime:hashDoc.updateTime}});}
    writes.push({update:{name:base+"/procurementRequests/"+id,fields:fields(changes)},updateMask:{fieldPaths:Object.keys(changes)},currentDocument:{updateTime:r.updateTime}},audit("PROCUREMENT_QUOTATION_UPLOADED","procurementRequests",id,{quotationNumber:number,quotationCount:count,fileHash:hashId,duplicateScanner:"SHA-256"}));
    await commit(writes);return ctx.json({ok:true,quotationCount:count,status:changes.status},200,ctx.corsHeaders(request));
   }
   if(operation==="registerEvidence"){
    const id=clean(input.id),type=clean(input.type),r=await getRequest(id);
    if(r.requestedByUid!==actor.uid)return deny("Only the procurement requester may upload delivery notes and invoices.");
    if(!["deliveryNote","invoice"].includes(type))return deny("Unsupported procurement evidence type.",400);
    if(type==="deliveryNote"&&r.status!=="Delivery Note Required")return deny("Delivery Note upload is not open.",409);
    if(type==="invoice"&&r.status!=="Invoice Required")return deny("Invoice upload is not open.",409);
    if(!clean(input.fileId))return deny("A registered PDF file ID is required.",400);
    const now=new Date(),nextStatus=type==="deliveryNote"?"Delivery Note Verification":"Invoice Verification",evidence={fileName:clean(input.fileName),fileId:clean(input.fileId),webViewLink:input.webViewLink||null,archiveUidLink:input.archiveUidLink||null,uploadedByUid:actor.uid,uploadedAt:now,verificationStatus:"Pending"};
    const changes={[type]:evidence,procurementArchiveUidLink:input.archiveUidLink||r.procurementArchiveUidLink||null,procurementArchiveFolderId:input.archiveFolderId||r.procurementArchiveFolderId||null,status:nextStatus,updatedAt:now};
    await commit([{update:{name:base+"/procurementRequests/"+id,fields:fields(changes)},updateMask:{fieldPaths:Object.keys(changes)},currentDocument:{updateTime:r.updateTime}},audit("PROCUREMENT_"+type.toUpperCase()+"_UPLOADED","procurementRequests",id,{fileId:input.fileId,verificationStatus:"Pending"})]);return ctx.json({ok:true,status:nextStatus},200,ctx.corsHeaders(request));
   }
   if(operation==="verifyEvidence"){
    if(!team)return deny("Procurement Team authorization is required.");
    const id=clean(input.id),type=clean(input.type),decision=clean(input.decision),r=await getRequest(id);
    if(!["deliveryNote","invoice"].includes(type))return deny("Unsupported evidence verification type.",400);
    const expected=type==="deliveryNote"?"Delivery Note Verification":"Invoice Verification";
    if(r.status!==expected)return deny("Evidence verification is not open.",409);
    if(!r[type]?.fileId)return deny("The required document has not been uploaded.",409);
    if(!["Approved","Rejected"].includes(decision))return deny("Select Approved or Rejected.",400);
    const nextStatus=type==="deliveryNote"?(decision==="Approved"?"Invoice Required":"Delivery Note Required"):(decision==="Approved"?"Finance Handoff":"Invoice Required");
    const evidence={...r[type],verificationStatus:decision,verificationNotes:clean(input.notes),verifiedByUid:actor.uid,verifiedByName:actor.name,verifiedAt:new Date()};
    const changes={[type]:evidence,status:nextStatus,updatedAt:new Date()};
    await commit([{update:{name:base+"/procurementRequests/"+id,fields:fields(changes)},updateMask:{fieldPaths:Object.keys(changes)},currentDocument:{updateTime:r.updateTime}},audit("PROCUREMENT_"+type.toUpperCase()+"_VERIFIED","procurementRequests",id,{decision,nextStatus,notes:clean(input.notes)})]);return ctx.json({ok:true,status:nextStatus},200,ctx.corsHeaders(request));
   }
   if(operation==="completeFinanceHandoff"){
    if(!team)return deny("Procurement Team authorization is required.");
    const id=clean(input.id),r=await getRequest(id);
    if(r.status==="Sent to Finance"&&r.financeTransactionId)return ctx.json({ok:true,financeTransactionId:r.financeTransactionId,idempotent:true},200,ctx.corsHeaders(request));
    if(r.status!=="Finance Handoff")return deny("Finance handoff is not open.",409);
    if(!r.prNumber||!r.poNumber||!r.authorizedByUid||!r.authorizedAt)return deny("Finance handoff requires a registered PR, generated PO and independent authorization.",409);
    const method=METHODS[r.procurementMethod]||METHODS["Request for Quotations"],required=Number(r.quotationRequiredCount||method.default),quotations=(r.quotations||[]).filter(x=>x?.fileId);
    if(quotations.length!==required)return deny("Finance handoff requires all required quotation/tender documents.",409);
    if(!r.deliveryNote?.fileId||r.deliveryNote.verificationStatus!=="Approved")return deny("Delivery note must be uploaded and independently approved.",409);
    if(!r.invoice?.fileId||r.invoice.verificationStatus!=="Approved")return deny("Invoice must be uploaded and independently approved.",409);
    const financeId="PROC-"+r.id,existing=await read("financeTransactions",financeId);
    let archiveLink=clean(existing?.financeArchiveUidLink||input.financeArchiveUidLink),archiveFolder=clean(existing?.financeArchiveFolderId||input.financeArchiveFolderId),files=Array.isArray(existing?.financeEvidence)?existing.financeEvidence:(Array.isArray(input.financeEvidence)?input.financeEvidence:[]);
    if(existing&&existing.procurementRequestId!==r.id)return deny("Finance handoff reference collision detected; no record was changed.",409);
    const expectedCount=quotations.length+2;
    if(!archiveLink||!archiveFolder||files.length!==expectedCount||files.some(x=>!clean(x.fileId)))return deny("The controlled Finance evidence archive is incomplete; no handoff was committed.",409);
    const now=new Date(),traceId="FIN-TRACE-Procurement-"+r.id,trace=await read("financePaymentTrace",traceId);
    const transaction={title:"Procurement Payment — "+r.title,reference:r.poNumber,amount:money(r.estimatedAmount),date:now.toISOString().slice(0,10),description:"Procurement payment request. Evidence package: "+r.requestNumber+"; PR "+r.prNumber+"; PO "+r.poNumber+".",payee:r.vendorName,transactionType:"Procurement Payment",costCentre:r.department,procurementRequestId:r.id,procurementRequestNumber:r.requestNumber,procurementPrNumber:r.prNumber,procurementPoNumber:r.poNumber,procurementEvidence:{quotations:r.quotations||[],deliveryNote:r.deliveryNote,invoice:r.invoice},financeArchiveUidLink:archiveLink,financeArchiveFolderId:archiveFolder,financeEvidence:files,sourceModule:"Procurement",status:"Pending Approval",workflowStage:"Payment Processing",createdByUid:existing?.createdByUid||actor.uid,createdAt:existing?.createdAt||now,updatedAt:now};
    const traceData={traceReference:"IRPA-TRACE-"+(r.requestNumber||r.id),sourceModule:"Procurement",sourceRecordId:r.id,sourceReference:r.requestNumber||r.id,procurementRequestId:r.id,procurementRequestNumber:r.requestNumber||null,procurementPrNumber:r.prNumber||null,procurementPoNumber:r.poNumber||null,payee:r.vendorName||null,amount:money(r.estimatedAmount),authorizationStatus:"Authorized",authorizationReference:r.approvalReference||r.requestNumber||null,authorizedByUid:r.authorizedByUid||r.approverUid||null,authorizedByName:r.authorizedByName||null,authorizedByRole:r.authorizedByRole||null,authorizedAt:r.authorizedAt||null,handoffStatus:"Handoff Received",paymentStatus:"Pending Authorization",workflowStage:"Payment Processing",financeTransactionId:financeId,financeArchiveUidLink:archiveLink,financeArchiveFolderId:archiveFolder,evidenceCount:files.length,handedOffByUid:actor.uid,handedOffAt:now,lastUpdatedByUid:actor.uid,lastUpdatedByEmail:actor.email,updatedAt:now};
    if(!trace)Object.assign(traceData,{createdAt:now,createdByUid:actor.uid,createdByEmail:actor.email});
    const requestChanges={status:"Sent to Finance",financeTransactionId:financeId,financeStatus:"Pending Payment",financeArchiveUidLink:archiveLink,financeArchiveFolderId:archiveFolder,financeEvidence:files,sentToFinanceByUid:actor.uid,sentToFinanceAt:now,updatedAt:now};
    const writes=[];
    if(!existing)writes.push({update:{name:base+"/financeTransactions/"+financeId,fields:fields(transaction)},currentDocument:{exists:false}});
    writes.push({update:{name:base+"/financePaymentTrace/"+traceId,fields:fields(traceData)},updateMask:{fieldPaths:Object.keys(traceData)},...(trace?.updateTime?{currentDocument:{updateTime:trace.updateTime}}:{currentDocument:{exists:false}})});
    writes.push({update:{name:base+"/procurementRequests/"+r.id,fields:fields(requestChanges)},updateMask:{fieldPaths:Object.keys(requestChanges)},currentDocument:{updateTime:r.updateTime}});
    writes.push(audit("PROCUREMENT_SENT_TO_FINANCE","procurementRequests",r.id,{financeTransactionId:financeId,financeArchiveUidLink:archiveLink,evidenceCopied:files.length,traceId}));
    await commit(writes);return ctx.json({ok:true,financeTransactionId:financeId},200,ctx.corsHeaders(request));
   }
   return deny("Unsupported Procurement operation.",400);
  }catch(error){console.error("PROCUREMENT_API_FAILURE",{uid:claims.user_id,operation,message:String(error?.message||error).slice(0,180)});return ctx.json({ok:false,error:String(error?.message||"Procurement service failed.")},Number(error?.status)||503,ctx.corsHeaders(request));}
 };
}
