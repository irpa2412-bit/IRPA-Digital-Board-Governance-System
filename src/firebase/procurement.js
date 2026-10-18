import{addDoc,collection,doc,getDoc,getDocs,query,runTransaction,serverTimestamp,setDoc,updateDoc,where}from"firebase/firestore";
import{auth,db}from"./config";
import{COLLECTIONS,getRecord,upsertFinancePaymentTrace}from"./data";
import{ref,uploadBytes,ensureDocumentArchiveFolder,downloadDriveBytes}from"./signatureStorage";

export const PROCUREMENT_STAGES=["Quotations Required","PR Registration","Procurement Review","Pending Authorization","PO Generation","PO Generated","Delivery Note Required","Delivery Note Verification","Invoice Required","Invoice Verification","Finance Handoff","Sent to Finance","Payment Completed"];
export const PROCUREMENT_GOODS_SERVICES=[
 "Office Supplies & Stationery",
 "ICT Equipment & Services",
 "Furniture & Office Equipment",
 "Vehicles & Transport Services",
 "Vehicle Maintenance & Spare Parts",
 "Fuel & Lubricants",
 "Construction & Civil Works",
 "Building Maintenance & Repairs",
 "Water Infrastructure & Borehole Services",
 "Solar Energy & Electrical Services",
 "Livestock & Veterinary Supplies",
 "Animal Health Services",
 "Livestock Equipment & Infrastructure",
 "Agricultural Inputs & Fodder",
 "Rangeland Restoration & Environmental Services",
 "Tree Seedlings & Nursery Supplies",
 "Research & Consultancy Services",
 "Training & Capacity Development",
 "Travel & Accommodation Services",
 "Communication & Media Services",
 "Printing & Branding Services",
 "Security Services",
 "Cleaning & Sanitation Services",
 "Professional & Legal Services",
 "Insurance Services",
 "Financial & Audit Services",
 "Events & Conference Services",
 "Food & Catering Services",
 "Logistics & Freight Services",
 "Others"
];
export const PROCUREMENT_DEPARTMENTS=[
 "Executive Office",
 "Internal Oversight",
 "Governance",
 "Livestock Development",
 "Environment & Sustainable Rangeland Management",
 "Finance & Administration",
 "Human Resources",
 "Outreach",
 "Community Development",
 "Field Department",
 "Operations"
];
export const PROCUREMENT_UNITS_BY_DEPARTMENT={
 "Governance":["Governance Unit","Board Governance Unit"],
 "Executive Office":["Executive Director's Office","Management Coordination Unit"],
 "Internal Oversight":["Internal Oversight Unit","Compliance & Assurance Unit"],
 "Livestock Development":["Livestock Production Unit","Veterinary Services Unit","Breeding & Genetics Unit","Livestock Infrastructure Unit"],
 "Environment & Sustainable Rangeland Management":["Rangeland Management Unit","Rangeland Restoration Unit","Invasive Species Control Unit","Climate Change & Resilience Unit","Environmental Conservation & Education Unit"],
 "Finance & Administration":["Finance Unit","Accounting Unit","Administration Unit","Procurement Unit"],
 "Human Resources":["Human Resources & Staff Welfare Unit","Training & Capacity Development Unit","Personnel & Records Unit"],
 "Outreach":["Communications & Outreach Unit","Partnerships & Resource Mobilization Unit","ICT & Digital Engagement Unit"],
 "Community Development":["Community Mobilization Unit","Women & Youth Empowerment Unit","Gender & Social Inclusion Unit"],
 "Field Department":["Field Implementation Unit","Monitoring, Evaluation, Accountability & Learning Unit","Community-Based Monitoring Unit"],
 "Operations":["Logistics & Transport Unit","Infrastructure & Facilities Unit","General Operations Unit"]
};
export const PROCUREMENT_METHODS=[
 {value:"Request for Quotations",label:"Request for Quotations",entryLabel:"Quotations",minEntries:3,maxEntries:3,defaultEntries:3},
 {value:"Competitive Tender",label:"Competitive Tender",entryLabel:"Tender / Bid Documents",minEntries:1,maxEntries:10,defaultEntries:3},
 {value:"Direct Procurement",label:"Direct Procurement",entryLabel:"Supplier Quotation / Justification",minEntries:1,maxEntries:1,defaultEntries:1},
 {value:"Framework Contract",label:"Framework Contract",entryLabel:"Framework Call-off / Quotation",minEntries:1,maxEntries:1,defaultEntries:1}
];
export function procurementMethodConfig(method){return PROCUREMENT_METHODS.find(x=>x.value===method)||PROCUREMENT_METHODS[0]}
const TEAM_ROLES=["Procurement Officer","Procurement Manager","Procurement Team Member"];
const APPROVER_ROLES=["Executive Director","Director Finance & Administration","Finance Manager","Accountant","Finance Officer","Director Livestock","Livestock Director","Director Internal Oversight","Internal Oversight Director","Director Human Resources","Director Outreach","Director Community Development","Director Environment","Director Field","Director Operations","Operations Director","Outreach Director","Community Development Director","Environment Director","Field Director"];
export function procurementTeamRole(role){return TEAM_ROLES.includes(role)}
export function procurementApproverRole(role){return APPROVER_ROLES.includes(role)}
export const PROCUREMENT_PERFORMANCE_CRITERIA=[
 {key:"quality",label:"Quality / conformity of goods or services",max:2},
 {key:"delivery",label:"Timeliness of delivery / service completion",max:2},
 {key:"compliance",label:"Compliance with specifications, contract and IRPA requirements",max:2},
 {key:"value",label:"Price competitiveness / value for money",max:2},
 {key:"responsiveness",label:"Responsiveness and communication",max:1},
 {key:"documentation",label:"Documentation, invoicing and professional conduct",max:1}
];
export const PROCUREMENT_BLACKLIST_THRESHOLD=6;
export const PROCUREMENT_BLACKLIST_MONTHS=6;
export const PROCUREMENT_PROBATION_MONTHS=3;
export const PROCUREMENT_PROBATION_MAX_ENGAGEMENTS=2;
function monthsAfter(date,months){const d=new Date(date);d.setMonth(d.getMonth()+months);return d}
function asDate(value){return value?.toDate?value.toDate():value?new Date(value):null}
export async function refreshVendorRestriction(v){if(!v)return v;const now=new Date();if(v.status==="Blacklisted"||v.performanceStatus==="Blacklisted"){let blacklistStart=asDate(v.blacklistStartedAt||v.enteredAt||v.blacklistedAt);if(!blacklistStart){const blacklistRecord=await getRecord(COLLECTIONS.procurementVendorBlacklist,v.id);blacklistStart=asDate(blacklistRecord?.blacklistStartedAt||blacklistRecord?.enteredAt);if(!blacklistStart){blacklistStart=now;await updateDoc(doc(db,COLLECTIONS.procurementVendors,v.id),{blacklistStartedAt:serverTimestamp(),performanceStatus:"Blacklisted",updatedAt:serverTimestamp()});await setDoc(doc(db,COLLECTIONS.procurementVendorBlacklist,v.id),{vendorId:v.id,blacklistStartedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});v={...v,blacklistStartedAt:now,performanceStatus:"Blacklisted"};}}const probationAt=monthsAfter(blacklistStart,PROCUREMENT_BLACKLIST_MONTHS);if(now>=probationAt){const probationStart=v.probationStartedAt||probationAt;const probationEnd=monthsAfter(asDate(probationStart),PROCUREMENT_PROBATION_MONTHS);await updateDoc(doc(db,COLLECTIONS.procurementVendors,v.id),{status:"Probation",performanceStatus:"Probation",probationStartedAt:probationStart,probationEndsAt:probationEnd,probationEngagements:0,updatedAt:serverTimestamp()});return{...v,status:"Probation",performanceStatus:"Probation",probationStartedAt:probationStart,probationEndsAt:probationEnd,probationEngagements:0}}return v}if(v.status==="Probation"&&v.probationStartedAt){const probationEnd=asDate(v.probationEndsAt)||monthsAfter(asDate(v.probationStartedAt),PROCUREMENT_PROBATION_MONTHS);if(now>=probationEnd){await updateDoc(doc(db,COLLECTIONS.procurementVendors,v.id),{status:"Approved",performanceStatus:"Eligible",probationEngagements:0,probationCompletedAt:serverTimestamp(),updatedAt:serverTimestamp()});return{...v,status:"Approved",performanceStatus:"Eligible",probationEngagements:0}}}return v}
export async function submitVendorPerformanceScore(vendorId,year,scores){return procurementApi("scoreVendor",{vendorId,year,scores});}
export async function getVendorPerformanceScores(vendorId){await team();const q=await getDocs(query(collection(db,COLLECTIONS.procurementVendorScores),where("vendorId","==",vendorId)));return q.docs.map(x=>({id:x.id,...x.data()}))}

async function actor(){const uid=auth.currentUser?.uid;if(!uid)throw new Error("Authentication is required.");const member=await getDoc(doc(db,COLLECTIONS.members,uid));if(member.exists()){const data=member.data()||{};if(data.status==="Active"||data.status==="Activated"||data.registrationStatus==="Activated")return{uid,...data,profileType:"member"}}const employee=await getDoc(doc(db,"employees",uid));if(employee.exists()){const data=employee.data()||{};if(data.status==="Active"||data.employmentStatus==="Active"||data.registrationStatus==="Activated")return{uid,...data,profileType:"employee"}}throw new Error("An active IRPA member or employee department profile is required.")}
async function team(){const a=await actor();const departmentAccess=a.department==="Finance & Administration"&&a.unit==="Procurement Unit";const administrator=a.authorizationType==="administrator"||a.role==="Administrator";if(!procurementTeamRole(a.role)&&!departmentAccess&&!administrator)throw new Error("Procurement Team authorization is required.");return a}
async function audit(action,c,id,details={}){const a=await actor();await addDoc(collection(db,COLLECTIONS.audit),{action,collection:c,recordId:id,details,actorUid:a.uid,actorEmail:a.email||auth.currentUser?.email||null,createdAt:serverTimestamp()})}
async function nextNumber(counter,prefix){const r=doc(db,"systemSettings","procurementCounters");return runTransaction(db,async tx=>{const s=await tx.get(r);const n=Number(s.data()?.[counter]||0)+1;tx.set(r,{[counter]:n,updatedAt:serverTimestamp()},{merge:true});return prefix+"-"+new Date().getFullYear()+"-"+String(n).padStart(5,"0")})}
async function request(id){const r=await getRecord(COLLECTIONS.procurementRequests,id);if(!r)throw new Error("Procurement request not found.");return r}
async function procurementApi(operation,data={}){const user=auth.currentUser;if(!user?.uid)throw new Error("Authentication is required.");const token=await user.getIdToken();const gateway=String(import.meta.env.VITE_GOOGLE_DRIVE_GATEWAY_URL||"https://irpa-google-drive-gateway.irpa-governance.workers.dev").trim().replace(/\/+$/, "");let response;try{response=await fetch(gateway+"/api/procurement/action",{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({operation,data})});}catch{throw new Error("Cloudflare Procurement service is unavailable. No client-side Firestore write fallback was used.");}const result=await response.json().catch(()=>({}));if(!response.ok||result.ok!==true)throw new Error(result.error||"The Procurement operation failed.");return result;}
export async function getMyProcurementRequests(){const a=await actor();const q=await getDocs(query(collection(db,COLLECTIONS.procurementRequests),where("requestedByUid","==",a.uid)));return q.docs.map(x=>({id:x.id,...x.data()}))}
export async function createProcurementVendor(data){const result=await procurementApi("createVendor",data);return result.id;}
export async function createProcurementRequest(data){const result=await procurementApi("createRequest",data);return result.id;}
export async function uploadProcurementQuotation(id,file,number){const a=await actor();const r=await request(id);if(r.requestedByUid!==a.uid)throw new Error("Only the procurement requester may upload quotations.");if(r.status!=="Quotations Required")throw new Error("Quotation upload is not open at this stage.");const method=procurementMethodConfig(r.procurementMethod);const required=Number(r.quotationRequiredCount||method.defaultEntries);if(number<1||number>required)throw new Error("This procurement method requires "+required+" document entr"+(required===1?"y":"ies")+" at this stage.");if(!file)throw new Error("Select a PDF quotation.");if(file.type&&file.type!=="application/pdf")throw new Error("Only PDF quotation documents are accepted.");const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest("SHA-256",bytes);const fileHash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");const hashRef=doc(db,"procurementQuotationHashes",fileHash);await runTransaction(db,async tx=>{const existing=await tx.get(hashRef);if(existing.exists()){const d=existing.data();if(d.requestId!==id||Number(d.quotationNumber)!==Number(number))throw new Error("DUPLICATE QUOTATION REJECTED: this document is already registered as quotation "+d.quotationNumber+" for procurement request "+(d.requestNumber||d.requestId)+".");return;}tx.set(hashRef,{requestId:id,requestNumber:r.requestNumber,quotationNumber:number,fileHash,uploadedByUid:a.uid,uploadedAt:serverTimestamp(),status:"Registered"});});const archive=await ensureDocumentArchiveFolder({documentId:r.requestNumber,title:r.title+" - Procurement Evidence",reference:r.requestNumber,archiveCategory:"Procurement Documents",classification:"Confidential"});const target=ref(null,"procurement/"+r.requestNumber+"/quotations/quotation-"+number+".pdf");const uploaded=await uploadBytes(target,file,{contentType:"application/pdf",purpose:"Procurement Quotation",folderId:archive.folderId,ownerUid:a.uid});const quotes=[...(r.quotations||[])];quotes[number-1]={number,fileName:file.name,fileId:target.fileId,fileHash,webViewLink:uploaded.metadata?.webViewLink||null,archiveUidLink:archive.archiveUidLink,uploadedByUid:a.uid,uploadedAt:new Date().toISOString()};const count=quotes.filter(Boolean).length;await updateDoc(doc(db,COLLECTIONS.procurementRequests,id),{quotations:quotes,quotationCount:count,procurementArchiveUidLink:archive.archiveUidLink,procurementArchiveFolderId:archive.folderId,status:count>=required?"PR Registration":"Quotations Required",updatedAt:serverTimestamp()});await audit("PROCUREMENT_QUOTATION_UPLOADED",COLLECTIONS.procurementRequests,id,{quotationNumber:number,quotationCount:count,fileHash,duplicateScanner:"SHA-256"});}
export async function registerProcurementPR(id){const result=await procurementApi("registerPR",{id});return result.prNumber;}
export async function reviewProcurementRequest(id,decision,type="request"){await procurementApi("reviewRequest",{id,decision,type});}
export async function authorizeProcurementRequest(id,approverUid){if(auth.currentUser?.uid!==approverUid)throw new Error("Only the selected authorised officer may approve this procurement.");await procurementApi("authorizeRequest",{id,approverUid});}
export async function generateProcurementPO(id){const result=await procurementApi("generatePO",{id});return result.poNumber;}
export async function uploadProcurementEvidence(id,type,file){const a=await actor();const r=await request(id);if(r.requestedByUid!==a.uid)throw new Error("Only the procurement requester may upload delivery notes and invoices.");if(!["deliveryNote","invoice"].includes(type))throw new Error("Unsupported procurement evidence type.");if(type==="deliveryNote"&&r.status!=="Delivery Note Required")throw new Error("Delivery Note upload is not open.");if(type==="invoice"&&r.status!=="Invoice Required")throw new Error("Invoice upload is not open.");if(!file)throw new Error("Select the required PDF document.");if(file.type&&file.type!=="application/pdf")throw new Error("Only PDF documents are accepted.");if(file.size>20*1024*1024)throw new Error("PDF document exceeds the 20 MB upload limit.");const archive=await ensureDocumentArchiveFolder({documentId:r.requestNumber,title:r.title+" - Procurement Evidence",reference:r.requestNumber,archiveCategory:"Procurement Documents",classification:"Confidential"});const target=ref(null,"procurement/"+r.requestNumber+"/"+type+".pdf");const uploaded=await uploadBytes(target,file,{contentType:"application/pdf",purpose:"Procurement "+type,folderId:archive.folderId,ownerUid:a.uid});const nextStatus=type==="deliveryNote"?"Delivery Note Verification":"Invoice Verification";await updateDoc(doc(db,COLLECTIONS.procurementRequests,id),{[type]:{fileName:file.name,fileId:target.fileId,webViewLink:uploaded.metadata?.webViewLink||null,archiveUidLink:archive.archiveUidLink,uploadedByUid:a.uid,uploadedAt:new Date().toISOString(),verificationStatus:"Pending"},procurementArchiveUidLink:archive.archiveUidLink,procurementArchiveFolderId:archive.folderId,status:nextStatus,updatedAt:serverTimestamp()});await audit("PROCUREMENT_"+type.toUpperCase()+"_UPLOADED",COLLECTIONS.procurementRequests,id,{fileId:target.fileId,verificationStatus:"Pending"});}
export async function verifyProcurementEvidence(id,type,decision,notes=""){const result=await procurementApi("verifyEvidence",{id,type,decision,notes});return result.status;}
export async function sendProcurementToFinance(id){const a=await team();const r=await request(id);if(r.status==="Sent to Finance"&&r.financeTransactionId)return r.financeTransactionId;if(r.status!=="Finance Handoff")throw new Error("Finance handoff is not open.");if(!r.prNumber||!r.poNumber||!r.authorizedByUid||!r.authorizedAt)throw new Error("Finance handoff blocked: the registered PR, generated PO and independent authorization must all be present.");const required=Number(r.quotationRequiredCount||procurementMethodConfig(r.procurementMethod).defaultEntries);const quotations=(r.quotations||[]).filter(x=>x?.fileId);if(quotations.length!==required)throw new Error("Finance handoff blocked: "+required+" required procurement quotation/tender document(s) must be present.");if(!r.deliveryNote?.fileId||r.deliveryNote.verificationStatus!=="Approved")throw new Error("Finance handoff blocked: delivery note must be uploaded and verified as approved.");if(!r.invoice?.fileId||r.invoice.verificationStatus!=="Approved")throw new Error("Finance handoff blocked: invoice must be uploaded and verified as approved.");const evidence=[...quotations.map((x,i)=>({key:"quotation-"+(i+1),fileId:x.fileId,fileName:x.fileName||("quotation-"+(i+1)+".pdf")})),{key:"delivery-note",fileId:r.deliveryNote.fileId,fileName:r.deliveryNote.fileName||"delivery-note.pdf"},{key:"invoice",fileId:r.invoice.fileId,fileName:r.invoice.fileName||"invoice.pdf"}];const financeTransactionRef=doc(db,COLLECTIONS.financeTransactions,"PROC-"+r.id);let transactionSnapshot=await getDoc(financeTransactionRef);let financeArchiveUidLink="",financeArchiveFolderId="",financeFiles=[];if(transactionSnapshot.exists()){const existing=transactionSnapshot.data();if(existing.procurementRequestId!==r.id)throw new Error("Finance handoff reference collision detected; no record was changed.");financeArchiveUidLink=existing.financeArchiveUidLink||"";financeArchiveFolderId=existing.financeArchiveFolderId||"";financeFiles=Array.isArray(existing.financeEvidence)?existing.financeEvidence:[];if(!financeArchiveUidLink||!financeFiles.length)throw new Error("Existing Finance transaction is incomplete. Reconcile its evidence archive before retrying handoff.");}else{const financeArchive=await ensureDocumentArchiveFolder({documentId:"FIN-"+r.requestNumber,title:r.title+" - Finance Evidence",reference:r.poNumber||r.prNumber||r.requestNumber,archiveCategory:"Finance Documents",classification:"Confidential"});financeArchiveUidLink=financeArchive.archiveUidLink;financeArchiveFolderId=financeArchive.folderId;for(const item of evidence){const bytes=await downloadDriveBytes(item.fileId);const target=ref(null,"finance/"+r.requestNumber+"/"+item.key+".pdf");const uploaded=await uploadBytes(target,bytes,{contentType:"application/pdf",purpose:"Controlled Documents",folderId:financeArchiveFolderId,ownerUid:a.uid});financeFiles.push({sourceFileId:item.fileId,fileId:target.fileId,fileName:item.fileName,webViewLink:uploaded.metadata?.webViewLink||null});}await setDoc(financeTransactionRef,{title:"Procurement Payment — "+r.title,reference:r.poNumber,amount:Number(r.estimatedAmount||0),date:new Date().toISOString().slice(0,10),description:"Procurement payment request. Evidence package: "+r.requestNumber+"; PR "+r.prNumber+"; PO "+r.poNumber+".",payee:r.vendorName,transactionType:"Procurement Payment",costCentre:r.department,procurementRequestId:r.id,procurementRequestNumber:r.requestNumber,procurementPrNumber:r.prNumber,procurementPoNumber:r.poNumber,procurementEvidence:{quotations:r.quotations||[],deliveryNote:r.deliveryNote,invoice:r.invoice},financeArchiveUidLink,financeArchiveFolderId,financeEvidence:financeFiles,sourceModule:"Procurement",status:"Pending Approval",workflowStage:"Payment Processing",createdByUid:a.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});}await upsertFinancePaymentTrace("FIN-TRACE-Procurement-"+r.id,{traceReference:"IRPA-TRACE-"+(r.requestNumber||r.id),sourceModule:"Procurement",sourceRecordId:r.id,sourceReference:r.requestNumber||r.id,procurementRequestId:r.id,procurementRequestNumber:r.requestNumber||null,procurementPrNumber:r.prNumber||null,procurementPoNumber:r.poNumber||null,payee:r.vendorName||null,amount:Number(r.estimatedAmount||0),authorizationStatus:"Authorized",authorizationReference:r.approvalReference||r.requestNumber||null,authorizedByUid:r.authorizedByUid||r.approverUid||null,authorizedByName:r.authorizedByName||null,authorizedByRole:r.authorizedByRole||null,authorizedAt:r.authorizedAt||null,handoffStatus:"Handoff Received",paymentStatus:"Pending Authorization",workflowStage:"Payment Processing",financeTransactionId:financeTransactionRef.id,financeArchiveUidLink,financeArchiveFolderId,evidenceCount:financeFiles.length,handedOffByUid:a.uid,handedOffAt:serverTimestamp()});await audit("PROCUREMENT_SENT_TO_FINANCE",COLLECTIONS.procurementRequests,id,{financeTransactionId:financeTransactionRef.id,financeArchiveUidLink,evidenceCopied:financeFiles.length,traceId:"FIN-TRACE-Procurement-"+r.id});await updateDoc(doc(db,COLLECTIONS.procurementRequests,id),{status:"Sent to Finance",financeTransactionId:financeTransactionRef.id,financeStatus:"Pending Payment",financeArchiveUidLink,financeArchiveFolderId,financeEvidence:financeFiles,sentToFinanceByUid:a.uid,sentToFinanceAt:serverTimestamp(),updatedAt:serverTimestamp()});return financeTransactionRef.id}
