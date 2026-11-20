import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { collection, doc } from "firebase/firestore";
import { auth, db } from "./config";
import { uploadControlledDocumentRouted, registerControlledDocumentRecord } from "./signatureStorage";
import { createSignatureEnvelope, startSignatureWorkflow } from "./signaturePlatform";
import { callMeetingService } from "./meetingGatewayApi";

const PAGE={width:842,height:595,margin:28,top:92,rowHeight:22,rowsPerPage:20};
const clean=value=>String(value??"").trim();
const categoryLabel=value=>({
 BOARD_MEMBER:"Board Member",BOARD_COMMITTEE_MEMBER:"Board Committee",
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
 const fields=[],present=records.filter(row=>attendanceStatus(row)==="Present");
 const pages=Math.max(1,Math.ceil(records.length/PAGE.rowsPerPage));
 for(let pageIndex=0;pageIndex<pages;pageIndex++){
  const page=pdf.addPage([PAGE.width,PAGE.height]);
  const rows=records.slice(pageIndex*PAGE.rowsPerPage,(pageIndex+1)*PAGE.rowsPerPage);
  page.drawText("IRPA — DAILY MEETING ATTENDANCE",{x:PAGE.margin,y:PAGE.height-34,size:16,font:bold,color:rgb(.08,.12,.2)});
  page.drawText(clean(meeting.title||meeting.meetingTitle||"Meeting"),{x:PAGE.margin,y:PAGE.height-52,size:10,font,color:rgb(.15,.18,.22)});
  page.drawText("Reference: "+clean(meeting.reference||meeting.meetingReference||meeting.id)+"   Date: "+date,{x:PAGE.margin,y:PAGE.height-68,size:9,font,color:rgb(.2,.2,.2)});
  const cols=[PAGE.margin,62,285,420,575,690];
  const headers=["No.","Participant","Category / Role","Attendance","Signature placement"];
  const y0=PAGE.height-86;
  page.drawLine({start:{x:PAGE.margin,y:y0-5},end:{x:PAGE.width-PAGE.margin,y:y0-5},thickness:1,color:rgb(.25,.3,.4)});
  headers.forEach((label,i)=>page.drawText(label,{x:cols[i],y:y0,size:8,font:bold,color:rgb(.08,.12,.2)}));
  rows.forEach((row,index)=>{
   const globalIndex=pageIndex*PAGE.rowsPerPage+index;
   const top=PAGE.top+index*PAGE.rowHeight;
   const y=PAGE.height-top;
   const status=attendanceStatus(row);
   const name=clean(row.name||row.participantName||row.fullName||"Unnamed participant").slice(0,38);
   const category=categoryLabel(row.registrationCategory);
   const role=clean(row.role||row.participantRole).slice(0,24);
   page.drawText(String(globalIndex+1),{x:cols[0],y,size:8,font});
   page.drawText(name,{x:cols[1],y,size:8,font});
   page.drawText((category+" / "+role).slice(0,30),{x:cols[2],y,size:7,font});
   page.drawText(status,{x:cols[3],y,size:8,font:status==="Present"?bold:font,color:status==="Present"?rgb(.05,.35,.16):rgb(.35,.35,.35)});
   page.drawLine({start:{x:cols[4],y:y-2},end:{x:PAGE.width-PAGE.margin,y:y-2},thickness:.5,color:rgb(.65,.68,.72)});
   if(status==="Present"){
    const uid=clean(row.participantUid||row.uid||row.userId);
    const email=clean(row.email||row.participantEmail||row.invitedEmail).toLowerCase();
    if(!uid||!email)throw new Error("Cannot dispatch: "+name+" is marked Present but does not have both a registered account UID and email address.");
    fields.push({fieldId:"ATT-"+date+"-"+clean(row.participantId||row.id),type:"Signature",page:pageIndex+1,x:(cols[4]-4)/PAGE.width*100,y:(top-7)/PAGE.height*100,width:(PAGE.width-PAGE.margin-cols[4]+4)/PAGE.width*100,height:16/PAGE.height*100,required:true,signerUid:uid,responsibility:"Daily attendance signature"});
   }else{
    page.drawText("N/A",{x:cols[4],y,size:8,font,color:rgb(.48,.48,.48)});
   }
  });
  page.drawText("Page "+(pageIndex+1)+" of "+pages,{x:PAGE.width-90,y:18,size:8,font,color:rgb(.4,.4,.4)});
 }
 return {bytes:await pdf.save(),fields,present};
}

export async function dispatchDailyAttendanceSigning({meeting,date,records}={}){
 const owner=auth.currentUser;
 if(!owner?.uid||!owner?.email)throw new Error("The meeting host must be signed in with an authenticated email account.");
 const meetingHostUid=clean(meeting?.meetingHostUid||meeting?.hostUid||meeting?.initiatorUid||meeting?.createdByUid||meeting?.ownerUid);
 if(meetingHostUid&&meetingHostUid!==owner.uid)throw new Error("Only the recorded meeting host may own this attendance document and dispatch its signing request.");
 if(!meeting?.id||!date||!Array.isArray(records)||!records.length)throw new Error("A meeting, attendance date and compiled participant register are required.");
 const {bytes,fields,present}=await buildDailyAttendancePdf({meeting,date,records});
 if(!present.length)throw new Error("There are no participants marked Present for this day. No signing request was dispatched.");
 const recipients=[...new Map(present.map(row=>{
  const uid=clean(row.participantUid||row.uid||row.userId);
  return [uid,{uid,email:clean(row.email||row.participantEmail||row.invitedEmail).toLowerCase(),name:clean(row.name||row.participantName||row.fullName),role:clean(row.role||row.participantRole)||categoryLabel(row.registrationCategory),institutionalRole:clean(row.role||row.participantRole)}];
 })).values()];
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
 const ownerSigningEnabled=present.some(row=>clean(row.participantUid||row.uid||row.userId)===owner.uid);
 const envelope=await createSignatureEnvelope({
  title,documentId,documentReference:reference,documentUrl:"drive://"+archive.file.fileId,
  documentClassification:documentPayload.classification,documentArchiveCategory:"Governance Documents",
  documentType:"Governance Document",documentUploadedAt:documentPayload.uploadedAt,
  signingMode:"Parallel",recipients,fields,ownerSigningEnabled
 });
 await callMeetingService("/api/meeting-attendance/daily/dispatch",{meetingId:meeting.id,date,phase:"PREPARE",envelopeId:envelope.id,documentId,ownerUid:owner.uid,signerUids:recipients.map(r=>r.uid)});
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
