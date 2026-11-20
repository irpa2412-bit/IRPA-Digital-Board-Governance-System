import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { collection, doc } from "firebase/firestore";
import { auth, db } from "./config";
import { uploadControlledDocumentRouted, registerControlledDocumentRecord } from "./signatureStorage";
import { createSignatureEnvelope, startSignatureWorkflow, getSignatureEnvelope } from "./signaturePlatform";
import { callMeetingService } from "./meetingGatewayApi";
import { GOVERNANCE_FIELD_TYPES } from "../components/GovernanceFieldPalette";
import { buildDailyAttendanceSignerAssignments } from "../utils/dailyAttendanceSigners.mjs";

const PAGE={width:842,height:595,margin:28,top:112,rowHeight:22,rowsPerPage:20};
const clean=value=>String(value??"").trim();
const categoryLabel=value=>({
 BOARD_MEMBER:"Board Member",UNMATCHED_BOARD_REGISTRATION:"Unverified Board Role",BOARD_COMMITTEE_MEMBER:"Board Committee",
 MANAGEMENT:"Management",STAFF:"Employees / Staff",IRPA_MEMBER:"IRPA Member",
 EXTERNAL_INVITEE:"External Participant",OTHER:"Other Participant"
})[String(value||"").toUpperCase()]||"Other Participant";

function attendanceStatus(row){
 const status=clean(row.dailyAttendanceStatus||row.attendanceStatus).toUpperCase();
 if(!status||["UNMARKED","INVITED","REGISTERED","N/A","NA"].includes(status))return "N/A — Not Attended";
 if(status==="PRESENT")return "Present";
 if(status==="EXCUSED")return "Excused";
 if(status==="ABSENT")return "Absent";
 return "N/A — Not Attended";
}

async function buildDailyAttendancePdf({meeting,date,records}){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const fields=[],present=buildDailyAttendanceSignerAssignments(records.filter(row=>attendanceStatus(row)==="Present"),date);
 const unresolved=present.filter(row=>!clean(row.name||row.participantName||row.fullName)||String(row.name||"").startsWith("NAME NOT FOUND"));
 if(unresolved.length)throw new Error("Cannot dispatch signed attendance: resolve the registered full name for "+unresolved.map(row=>clean(row.email||row.participantEmail||row.participantUid||row.participantId)).join(", ")+" in the Members or Employees register first.");
 if(!GOVERNANCE_FIELD_TYPES.includes("Signature"))throw new Error("The shared Governance Field Palette does not expose a Signature field.");
 const categories=["BOARD_MEMBER","BOARD_COMMITTEE_MEMBER","UNMATCHED_BOARD_REGISTRATION","MANAGEMENT","STAFF","IRPA_MEMBER","EXTERNAL_INVITEE","OTHER"];
 const grouped=categories.map(category=>({category,rows:records.filter(row=>String(row.registrationCategory||"OTHER").toUpperCase()===category)})).filter(group=>group.rows.length);
 let pageNumber=0;
 const totalPages=grouped.reduce((total,group)=>total+Math.max(1,Math.ceil(group.rows.length/PAGE.rowsPerPage)),0);
 for(const group of grouped){
  const pages=Math.max(1,Math.ceil(group.rows.length/PAGE.rowsPerPage));
  for(let pageIndex=0;pageIndex<pages;pageIndex++){
   pageNumber++;
   const page=pdf.addPage([PAGE.width,PAGE.height]);
   const rows=group.rows.slice(pageIndex*PAGE.rowsPerPage,(pageIndex+1)*PAGE.rowsPerPage);
   page.drawText("IRPA — DAILY ATTENDANCE",{x:PAGE.margin,y:PAGE.height-34,size:16,font:bold,color:rgb(.08,.12,.2)});
   page.drawText(clean(meeting.title||meeting.meetingTitle||"Meeting"),{x:PAGE.margin,y:PAGE.height-52,size:10,font,color:rgb(.15,.18,.22)});
   page.drawText("Reference: "+clean(meeting.reference||meeting.meetingReference||meeting.id)+"   Date: "+date,{x:PAGE.margin,y:PAGE.height-68,size:9,font,color:rgb(.2,.2,.2)});
   page.drawText("CATEGORY SHEET: "+categoryLabel(group.category),{x:PAGE.margin,y:PAGE.height-82,size:9,font:bold,color:rgb(.12,.2,.32)});
   const cols=[28,48,185,350,470,550,635];
   const headers=["No.","Participant name","Email address","Occupation / position","Category","Attendance","Signature placement"];
   const y0=PAGE.height-99;
   page.drawLine({start:{x:PAGE.margin,y:y0-5},end:{x:PAGE.width-PAGE.margin,y:y0-5},thickness:1,color:rgb(.25,.3,.4)});
   headers.forEach((label,i)=>page.drawText(label,{x:cols[i],y:y0,size:7,font:bold,color:rgb(.08,.12,.2)}));
   rows.forEach((row,index)=>{
    const globalIndex=group.rows.indexOf(row),top=PAGE.top+index*PAGE.rowHeight,y=PAGE.height-top,status=attendanceStatus(row);
    const name=clean(row.name||row.participantName||row.fullName||"Unnamed participant").slice(0,25);
    const email=clean(row.email||row.participantEmail||row.invitedEmail).toLowerCase().slice(0,31);
    const occupation=[clean(row.occupation||row.capacity||row.title||row.role||row.participantRole),clean(row.department),clean(row.institution)].filter(Boolean).join(" · ").slice(0,38)||"—";
    page.drawText(String(globalIndex+1),{x:cols[0],y,size:7,font});
    page.drawText(name,{x:cols[1],y,size:7,font});
    page.drawText(email||"—",{x:cols[2],y,size:6.5,font});
    page.drawText(occupation||"—",{x:cols[3],y,size:6.5,font});
    page.drawText(categoryLabel(group.category).slice(0,15),{x:cols[4],y,size:6.5,font});
    page.drawText(status,{x:cols[5],y,size:7,font:status==="Present"?bold:font,color:status==="Present"?rgb(.05,.35,.16):rgb(.35,.35,.35)});
    if(status==="Present"){
     const uid=clean(row.signerUid||row.participantUid||row.uid||row.userId),participantId=clean(row.participantId||row.id),signerId=clean(row.signerId);
     if(!uid||!signerId||!email)throw new Error("Cannot dispatch: "+name+" is marked Present but has no valid per-person signer identity and email address.");
     const fieldId="ATT-"+String(date)+"-"+participantId.replace(/[^A-Za-z0-9_-]/g,"-");
     fields.push({fieldId,type:"Signature",page:pageNumber,x:(cols[6]-4)/PAGE.width*100,y:(top-7)/PAGE.height*100,width:(PAGE.width-PAGE.margin-cols[6]+4)/PAGE.width*100,height:16/PAGE.height*100,required:true,signerUid:uid,signerId,participantId,roleAssignmentIndex:0,responsibility:"Daily attendance signature"});
    }else{
     page.drawText("N/A",{x:cols[6],y,size:8,font,color:rgb(.48,.48,.48)});
    }
   });
   page.drawText("Page "+pageNumber+" of "+totalPages,{x:PAGE.width-90,y:18,size:8,font,color:rgb(.4,.4,.4)});
  }
 }
 return {bytes:await pdf.save(),fields,present};
}
export async function resumeDailyAttendanceSigning({meeting,date,dispatch}={}){
 const owner=auth.currentUser;
 if(!owner?.uid||!owner?.email)throw new Error("The meeting host must be signed in with an authenticated email account.");
 const meetingHostUid=clean(meeting?.meetingHostUid||meeting?.hostUid||meeting?.organizerUid||meeting?.organiserUid||meeting?.initiatorUid||meeting?.createdByUid||meeting?.ownerUid||meeting?.chairpersonUid);
 if(!meetingHostUid||meetingHostUid!==owner.uid)throw new Error("Only the recorded meeting host may resume this attendance signing request.");
 if(dispatch?.status!=="PREPARING"||!dispatch?.envelopeId||!dispatch?.documentId)throw new Error("There is no prepared daily attendance signing request to resume.");
 const envelope=await getSignatureEnvelope(dispatch.envelopeId);
 let started;
 try{
  started=await startSignatureWorkflow(envelope);
 }catch(error){
  await callMeetingService("/api/meeting-attendance/daily/dispatch",{meetingId:meeting.id,date,phase:"FAILED",envelopeId:dispatch.envelopeId,documentId:dispatch.documentId,ownerUid:owner.uid,error:String(error?.message||"Email-link dispatch failed").slice(0,500)}).catch(()=>null);
  throw error;
 }
 await callMeetingService("/api/meeting-attendance/daily/dispatch",{meetingId:meeting.id,date,phase:"SENT",envelopeId:dispatch.envelopeId,documentId:dispatch.documentId,ownerUid:owner.uid,gatewayEnvelopeId:started.gatewayEnvelopeId||null,gatewayInvitationStatus:started.gatewayInvitationStatus||"Sent"});
 if(started.ownerSigningToken)window.location.assign("/?emailSignToken="+encodeURIComponent(started.ownerSigningToken));
 return {envelopeId:dispatch.envelopeId,documentId:dispatch.documentId,signerCount:(dispatch.gatewaySignerMap||[]).length,status:started.gatewayInvitationStatus||"Sent"};
}

export async function dispatchDailyAttendanceSigning({meeting,date,records}={}){
 const owner=auth.currentUser;
 if(!owner?.uid||!owner?.email)throw new Error("The meeting host must be signed in with an authenticated email account.");
 const meetingHostUid=clean(meeting?.meetingHostUid||meeting?.hostUid||meeting?.organizerUid||meeting?.organiserUid||meeting?.initiatorUid||meeting?.createdByUid||meeting?.ownerUid||meeting?.chairpersonUid);
 if(!meetingHostUid)throw new Error("This meeting has no recorded host identity. Assign the meeting host before preparing an attendance signing document.");
 if(meetingHostUid!==owner.uid)throw new Error("Only the recorded meeting host may own this attendance document and dispatch its signing request.");
 if(!meeting?.id||!date||!Array.isArray(records)||!records.length)throw new Error("A meeting, attendance date and compiled participant register are required.");
 const {bytes,fields,present}=await buildDailyAttendancePdf({meeting,date,records});
 if(!present.length)throw new Error("There are no participants marked Present for this day. No signing request was dispatched.");
 const presentSignerIds=present.map(row=>clean(row.signerId));
 if(new Set(presentSignerIds).size!==presentSignerIds.length)throw new Error("The daily attendance sheet contains the same signer ID more than once. Correct the duplicate identity before dispatching signing requests.");
 const recipients=present.map(row=>{
  const uid=clean(row.signerUid||row.participantUid||row.uid||row.userId);
  const role=clean(row.role||row.participantRole)||categoryLabel(row.registrationCategory),title=clean(row.title||row.position||row.boardPosition),occupation=clean(row.occupation||row.capacity||row.profession||title||role),capacity=clean(row.capacity||row.occupation||title||role);return {uid,signerId:row.signerId,participantId:row.participantId,identityType:row.identityType,accountUid:row.accountUid||null,email:clean(row.email||row.participantEmail||row.invitedEmail).toLowerCase(),name:clean(row.name||row.participantName||row.fullName),role,institutionalRole:role,title,occupation,capacity,department:clean(row.department),institution:clean(row.institution),participantCategory:categoryLabel(row.registrationCategory),roleAssignments:[{role,title,capacity,occupation}]};
 });
 const documentId=doc(collection(db,"documents")).id;
 const reference="IRPA-ATT-"+String(meeting.reference||meeting.id).replace(/[^A-Za-z0-9_-]/g,"-")+"-"+date;
 const title="Daily Attendance — "+clean(meeting.title||meeting.meetingTitle||"Meeting")+" — "+date;
 const file=new File([bytes],reference+".pdf",{type:"application/pdf"});
 const uploaded=await uploadControlledDocumentRouted({
  documentId,title,reference,documentType:"Governance Document",archiveCategory:"Governance Documents",
  classification:String(meeting.meetingCategory||meeting.category||"").toUpperCase().includes("BOARD")?"Restricted":"Internal",
  uploadedAt:new Date().toISOString(),file,contentType:"application/pdf"
 });
 const archive=uploaded.categoryArchive;
 if(!archive?.file?.fileId)throw new Error("The controlled attendance PDF upload did not return a primary archive file ID.");
 const documentPayload={
  title,reference,documentReference:reference,documentType:"Governance Document",documentTypeSelectedAt:new Date().toISOString(),
  documentUid:documentId,archiveCategory:"Governance Documents",classification:String(meeting.meetingCategory||meeting.category||"").toUpperCase().includes("BOARD")?"Restricted":"Internal",
  archiveFolderId:archive.folderId,archiveUidLink:archive.archiveUidLink,archivePath:archive.archivePath,archiveAccess:archive.archiveAccess||"Restricted",
  archiveFileId:archive.file.fileId,archiveFileWebViewLink:archive.file.webViewLink||null,fileId:archive.file.fileId,
  fileUrl:"drive://"+archive.file.fileId,webViewLink:archive.file.webViewLink||null,fileName:reference+".pdf",
  contentType:"application/pdf",fileSize:bytes.length,storageProvider:"Google Drive",purpose:"Daily Meeting Attendance Register",
  status:"Draft",authorizationStatus:"Draft",authorizedUids:[owner.uid],uploadedByUid:owner.uid,uploadedByEmail:owner.email,
  uploadedAt:new Date().toISOString(),recordOrigin:"PRODUCTION"
 };
 await registerControlledDocumentRecord({documentId,documentPayload});
 const ownerSigningEnabled=present.some(row=>clean(row.accountUid||row.participantUid||row.uid||row.userId)===owner.uid);
 const envelope=await createSignatureEnvelope({
  title,documentId,documentReference:reference,documentUrl:"drive://"+archive.file.fileId,
  documentClassification:documentPayload.classification,documentArchiveCategory:"Governance Documents",
  documentType:"Governance Document",documentUploadedAt:documentPayload.uploadedAt,
  signingMode:"Parallel",recipients,fields,ownerSigningEnabled
 });
 const gatewaySignerMap=(envelope.recipients||[]).filter(r=>r?.uid&&r?.email&&r.actionRequired!==false&&r.optionalSigning!==true&&!r.accessOnly&&r.participantId&&!["View Only","Read Only","Information / FYI","Observer"].includes(String(r.role||"").trim())).sort((a,b)=>Number(a.routingOrder||1)-Number(b.routingOrder||1)).map((r,index)=>({signerId:"S"+String(index+1),participantId:r.participantId,participantUid:r.accountUid||null,participantEmail:clean(r.email).toLowerCase(),participantName:clean(r.name||r.displayName||r.email)}));
 await callMeetingService("/api/meeting-attendance/daily/dispatch",{meetingId:meeting.id,date,phase:"PREPARE",envelopeId:envelope.id,documentId,ownerUid:owner.uid,participantIds:present.map(r=>r.participantId),signerIds:gatewaySignerMap.map(r=>r.signerId),gatewaySignerMap});
 let started;
 try{
  started=await startSignatureWorkflow(envelope);
 }catch(error){
  await callMeetingService("/api/meeting-attendance/daily/dispatch",{meetingId:meeting.id,date,phase:"FAILED",envelopeId:envelope.id,documentId,ownerUid:owner.uid,error:String(error?.message||"Email-link dispatch failed").slice(0,500)}).catch(()=>null);
  throw error;
 }
 try{
  await callMeetingService("/api/meeting-attendance/daily/dispatch",{meetingId:meeting.id,date,phase:"SENT",envelopeId:envelope.id,documentId,ownerUid:owner.uid,signerUids:recipients.map(r=>r.uid),gatewayEnvelopeId:started.gatewayEnvelopeId||null,gatewayInvitationStatus:started.gatewayInvitationStatus||"Sent"});
 }catch(error){
  throw new Error("The Signature Portal workflow started and email invitations may have been sent, but the Meeting Portal dispatch record could not be reconciled. Do not press Dispatch again; ask the host administrator to reconcile envelope "+envelope.id+".");
 }
 if(started.ownerSigningToken&&ownerSigningEnabled)window.location.assign("/?emailSignToken="+encodeURIComponent(started.ownerSigningToken));
 return {envelopeId:envelope.id,documentId,reference,signerCount:recipients.length,status:started.gatewayInvitationStatus||"Sent"};
}
