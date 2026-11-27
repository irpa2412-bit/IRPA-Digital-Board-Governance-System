"use strict";
const crypto=require("node:crypto"),path=require("node:path"),{createRequire}=require("node:module");
const req=createRequire(path.resolve(process.cwd(),"functions/package.json"));
const {initializeApp,cert}=req("firebase-admin/app"),{getAuth}=req("firebase-admin/auth"),{getFirestore}=req("firebase-admin/firestore");
const PROJECT="irpa-digital-board-governance";
const ALLOW=new Set(["uid","email","displayName","initials","method","pathwayVersion","driveSignatureFolderId","driveSignatureFolderName","driveSignatureFolderPath","driveSignatureFolderUid","completedDocumentsFolderId","completedDocumentsFolderLink","completedDocumentsFolderPath","signaturePath","signatureUrl","signatureDriveUrl","signatureSha256","initialsPath","initialsUrl","initialsDriveUrl","initialsSha256","status","adoptionDate","updatedAt","revokedAt","revokedByUid","revokedByEmail","revocationReason"]);
const findings=[],norm=v=>String(v==null?"":v).trim().toLowerCase(),str=v=>typeof v==="string"&&v.trim().length>0;
const hash=(k,v)=>crypto.createHash("sha256").update(k+":"+String(v)).digest("hex").slice(0,24);
const activeMember=d=>["active","activated"].includes(norm(d.status))||norm(d.registrationStatus)==="activated";
const activeEmployee=d=>norm(d.status)==="active"||norm(d.employmentStatus)==="active"||norm(d.registrationStatus)==="activated";
const activeAuditor=d=>d.active!==false&&(d.active===true||["active","activated"].includes(norm(d.status))||norm(d.registrationStatus)==="activated"||d.accountActivated===true);
const add=x=>findings.push({...x,accountRef:hash("account",x.accountKey),...(x.recordKey?{recordRef:hash("record",x.recordKey)}:{}),accountKey:undefined,recordKey:undefined});
const dedupe=xs=>[...new Map(xs.filter(Boolean).map(x=>[x.id||x.uid,x])).values()];
const read=async(db,n)=>{const s=await db.collection(n).get();return s.docs.map(d=>({id:d.id,data:d.data()||{}}));};
async function allUsers(a){let out=[],token;do{const p=await a.listUsers(1000,token);out.push(...p.users);token=p.pageToken;}while(token);return out;}
(async()=>{
 const raw=process.env.FIREBASE_SERVICE_ACCOUNT;if(!raw)throw new Error("SERVICE_ACCOUNT_SECRET_MISSING");
 const sa=JSON.parse(raw);if(sa.project_id!==PROJECT)throw new Error("SERVICE_ACCOUNT_PROJECT_MISMATCH");
 initializeApp({credential:cert(sa),projectId:PROJECT});
 const auth=getAuth(),db=getFirestore();
 const [users,members,invitations,admins,employees,auditors,profiles,signers]=await Promise.all([
  allUsers(auth),read(db,"members"),read(db,"invitations"),read(db,"adminProfiles"),read(db,"employees"),read(db,"auditorProfiles"),read(db,"signatureProfiles"),read(db,"signerIdentities")
 ]);
 const authUid=new Map(users.map(x=>[x.uid,x])),authEmail=new Map(),invById=new Map(invitations.map(x=>[x.id,x])),invByEmail=new Map();
 const adminUid=new Map(admins.map(x=>[x.id,x])),employeeUid=new Map(employees.map(x=>[x.id,x])),employeeByDataUid=new Map(),employeeByEmail=new Map(),auditorEmail=new Map(auditors.map(x=>[norm(x.data.email||x.id),x]));
 for(const e of employees){const euid=norm(e.data.uid),eemail=norm(e.data.email||e.data.firebaseAuthEmail);if(euid){const a=employeeByDataUid.get(euid)||[];a.push(e);employeeByDataUid.set(euid,a);}if(eemail){const a=employeeByEmail.get(eemail)||[];a.push(e);employeeByEmail.set(eemail,a);}}
 const signatureUid=new Map(profiles.map(x=>[x.id,x])),signatureByDataUid=new Map(),signatureByEmail=new Map(),signerUid=new Map(signers.map(x=>[x.id,x])),memberByDocId=new Map(members.map(x=>[x.id,x]));
 for(const p of profiles){const puid=norm(p.data.uid),pemail=norm(p.data.email);if(puid){const a=signatureByDataUid.get(puid)||[];a.push(p);signatureByDataUid.set(puid,a);}if(pemail){const a=signatureByEmail.get(pemail)||[];a.push(p);signatureByEmail.set(pemail,a);}}
 for(const u of users){const e=norm(u.email);if(e){const a=authEmail.get(e)||[];a.push(u);authEmail.set(e,a);}}
 for(const i of invitations){const e=norm(i.data.email);if(e){const a=invByEmail.get(e)||[];a.push(i);invByEmail.set(e,a);}}
 const memberUsers=new Map(),blocked=new Set(),loginDenied=new Set(),accountSummaries=[];
 const linkedAuth=new Set();
 for(const m of members){
  const d=m.data,uid=norm(d.uid),email=norm(d.email),linkEmail=norm(d.email||d.firebaseAuthEmail);
  const byDoc=authUid.get(m.id),byDataUid=uid?authUid.get(uid):null,emailHits=linkEmail?(authEmail.get(linkEmail)||[]):[];
  const matches=dedupe([byDoc,byDataUid,...emailHits]);
  const u=byDoc||byDataUid||emailHits[0]||null;
  const accountKey=u?u.uid:(uid||m.id),aRef=hash("account",accountKey);
  if(u){linkedAuth.add(u.uid);const a=memberUsers.get(u.uid)||[];a.push(m);memberUsers.set(u.uid,a);}
  if(!u)add({category:"MEMBER_RECORD_WITHOUT_AUTH_USER",reasonCode:"MEMBER_RECORD_HAS_NO_MATCHING_FIREBASE_AUTH_USER",severity:activeMember(d)?"ACTIVE_MEMBER_WITHOUT_AUTH_ACCOUNT":"NO_AUTH_ACCOUNT_YET",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Preserve the member record. Allow only verified invitation activation by the intended recipient; do not fabricate an Auth user or alter the role."});
  if(matches.length>1)add({category:"MEMBER_IDENTITY_LINKAGE",reasonCode:"MEMBER_RECORD_MATCHES_MULTIPLE_AUTH_IDENTITIES",severity:"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Manual reconciliation. Keep every Auth identity and member record; do not merge or reassign automatically."});
  if(u&&m.id!==u.uid){add({category:"UID_MISSING_OR_MISMATCHED",reasonCode:"MEMBER_DOCUMENT_ID_DOES_NOT_MATCH_AUTH_UID",severity:"BLOCKS_MEMBER_RULE_AUTHORITY",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Manual review. Firestore member authorization resolves members/{auth.uid}; do not move/recreate the record. Preserve source and roles."});blocked.add(aRef);}
  if(!uid)add({category:"UID_MISSING_OR_MISMATCHED",reasonCode:"MEMBER_UID_FIELD_MISSING",severity:u&&m.id===u.uid?"REPAIR_CANDIDATE":"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:u&&m.id===u.uid?"After confirming the invitation/email, fill only uid with the verified Auth UID; preserve every other field and role.":"No safe UID source. Manual identity review; setting uid alone cannot fix a document-path mismatch."});
  else if(u&&uid!==u.uid)add({category:"UID_MISSING_OR_MISMATCHED",reasonCode:"MEMBER_UID_FIELD_MISMATCHES_AUTH_UID",severity:"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Do not overwrite either UID. Verify current UID ownership and invitation redemption evidence first."});
  else if(!u)add({category:"UID_MISSING_OR_MISMATCHED",reasonCode:"MEMBER_UID_HAS_NO_AUTH_USER",severity:"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Retain the UID until the Auth identity is verified; do not create or relink an Auth user automatically."});
  if(!linkEmail)add({category:"EMAIL_MISSING_OR_MISMATCHED",reasonCode:"MEMBER_EMAIL_MISSING",severity:"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Fill email only from a unique verified Auth identity and matching invitation; otherwise manual review."});
  else if(u&&norm(u.email)!==linkEmail)add({category:"EMAIL_MISSING_OR_MISMATCHED",reasonCode:"MEMBER_EMAIL_DIFFERS_FROM_AUTH_EMAIL",severity:"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Do not overwrite email automatically. Verify ownership and invitation recipient first."});
  const invitationId=String(d.invitationId||"").trim(),invitation=invitationId?invById.get(invitationId):null;
  const invitationEmailKey=linkEmail||(u?norm(u.email):""),invEmailMatches=invitationEmailKey?(invByEmail.get(invitationEmailKey)||[]):[];
  if(!invitationId){const unique=invEmailMatches.length===1?invEmailMatches[0]:null;add({category:"INVITATION_ID_MISSING_OR_MISMATCHED",reasonCode:"MEMBER_INVITATION_ID_MISSING",severity:unique?"REPAIR_CANDIDATE":"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:unique?"Candidate to fill only invitationId from the unique email-matched invitation after confirming record type, target record, role and accepted UID.":"No unique invitation proves the link; do not infer or fabricate an invitationId."});}
  else if(!invitation)add({category:"INVITATION_ID_MISSING_OR_MISMATCHED",reasonCode:"MEMBER_INVITATION_ID_NOT_FOUND",severity:"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Reconcile against invitation register and archived evidence; do not substitute by email similarity."});
  else{
   const invEmail=norm(invitation.data.email),accepted=norm(invitation.data.acceptedUid);
   if(linkEmail&&invEmail&&linkEmail!==invEmail)add({category:"INVITATION_ID_MISSING_OR_MISMATCHED",reasonCode:"INVITATION_EMAIL_DIFFERS_FROM_MEMBER_EMAIL",severity:"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Keep the invitation link unchanged until the assigned recipient is manually verified."});
   if(u&&invEmail&&norm(u.email)!==invEmail)add({category:"INVITATION_ID_MISSING_OR_MISMATCHED",reasonCode:"INVITATION_EMAIL_DIFFERS_FROM_AUTH_EMAIL",severity:"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Do not change the invitation recipient or accepted UID automatically."});
   if(accepted&&u&&accepted!==u.uid)add({category:"INVITATION_ID_MISSING_OR_MISMATCHED",reasonCode:"INVITATION_ACCEPTED_UID_DIFFERS_FROM_AUTH_UID",severity:"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Security review required. Do not reassign an accepted invitation or overwrite acceptedUid."});
   if(norm(invitation.data.status)==="cancelled")add({category:"PENDING_OR_INCOMPLETE_ACTIVATION",reasonCode:"MEMBER_INVITATION_CANCELLED",severity:"MANUAL_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Preserve the cancelled invitation. Verify replacement authority before issuing a new invitation."});
  }
  const roleValues=[d.role,...(Array.isArray(d.roles)?d.roles:[]),...(Array.isArray(d.assignedRoles)?d.assignedRoles:[]),...(Array.isArray(d.selectedRoles)?d.selectedRoles:[]),].filter(str);
  if(!str(d.role)&&roleValues.length)add({category:"ROLE_MISSING_OR_EMPTY",reasonCode:"MEMBER_SCALAR_ROLE_MISSING_BUT_ARRAY_ROLES_PRESENT",severity:"PARTIAL_AUTHORITY_REVIEW",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Preserve existing role arrays. Review the scalar role against the signed register; never infer or change it automatically."});if(!roleValues.length){add({category:"ROLE_MISSING_OR_EMPTY",reasonCode:"MEMBER_HAS_NO_SCALAR_OR_ARRAY_ROLE",severity:"BLOCKS_ROLE_BASED_AUTHORITY",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Manual verification against signed member/Board register. Never infer, add or change a role."});blocked.add(aRef);}
  if(!activeMember(d)){const pending=["pending","invited","awaiting activation","provisioning pending"].includes(norm(d.registrationStatus))||["pending","sent","accepted"].includes(norm(invitation&&invitation.data.status));add({category:"PENDING_OR_INCOMPLETE_ACTIVATION",reasonCode:pending?"MEMBER_ACTIVATION_PENDING":"MEMBER_NOT_ACTIVE_UNDER_FIRESTORE_RULES",severity:"BLOCKS_MEMBER_RULE_AUTHORITY",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"Activate only through authenticated Worker after verifying Auth UID, invitation recipient and invitation record; preserve role and status history."});blocked.add(aRef);}
  else{const missing=[];if(d.accountActivated!==true)missing.push("accountActivated");if(norm(d.registrationStatus)!=="activated")missing.push("registrationStatus");if(!d.activatedAt)missing.push("activatedAt");if(!uid||u&&uid!==u.uid)missing.push("uid");if(!invitationId)missing.push("invitationId");if(missing.length)add({category:"PENDING_OR_INCOMPLETE_ACTIVATION",reasonCode:"WORKER_ACTIVATION_METADATA_INCOMPLETE",severity:"REPAIR_CANDIDATE",subjectType:"member_record",accountKey,recordKey:m.id,proposedFix:"After Worker deployment, verify invitation and Auth identity, then fill only missing fields among uid, invitationId, accountActivated=true, registrationStatus=Activated and activatedAt. Do not change role or status."});}
  if(u&&invitation&&!activeMember(d)&&!(d.accountActivated===true&&norm(d.registrationStatus)==="activated"&&Boolean(d.activatedAt))&&norm(invitation.data.status)!=="cancelled"){add({category:"LOGIN_PATH_DENIALS",reasonCode:"MEMBER_MAGIC_LINK_CLIENT_MEMBER_WRITE_BLOCKED_BY_ADMIN_ONLY_RULE",severity:"CONDITIONAL_BLOCKER_IF_MEMBER_INVITE_LINK_USED",subjectType:"auth_user",accountKey:u.uid,recordKey:m.id,proposedFix:"The legacy memberInvite magic-link path calls a client-side members update. Deploy and prove the Worker activation route before changing member rules; keep the old path until then."});loginDenied.add(aRef);blocked.add(aRef);}
  const sigKey=u?u.uid:(uid||m.id),sigMatches=dedupe([signatureUid.get(sigKey),...(signatureByDataUid.get(sigKey)||[]),...(linkEmail?(signatureByEmail.get(linkEmail)||[]):[])]),sig=sigMatches.find(x=>x.id===sigKey)||sigMatches[0]||null;
  if(sigMatches.length>1)add({category:"SIGNATURE_PROFILE_IDENTITY",reasonCode:"MULTIPLE_SIGNATURE_PROFILES_MATCH_MEMBER",severity:"MANUAL_REVIEW",subjectType:"signature_profile",accountKey,recordKey:sig.id,proposedFix:"Manual reconciliation. Preserve every Signature Profile and asset; do not merge, move or delete profiles."});
  if(!sig)add({category:"SIGNATURE_PROFILE_MISSING",reasonCode:"MEMBER_HAS_NO_SIGNATURE_PROFILE",severity:"SIGNATURE_SETUP_REQUIRED_NOT_LOGIN_BLOCKING",subjectType:"signature_profile",accountKey,recordKey:m.id,proposedFix:"No automatic profile creation. Preserve login; create a Signature Profile only through normal owner-controlled setup when the member adopts e-signature."});
  else{const sd=sig.data,unknown=Object.keys(sd).filter(k=>!ALLOW.has(k)).sort();if(norm(sd.status)==="revoked"||sd.revokedAt)add({category:"SIGNATURE_PROFILE_REVOKED",reasonCode:"SIGNATURE_PROFILE_ALREADY_REVOKED",severity:"SIGNING_DISABLED_BY_EXISTING_REVOCATION",subjectType:"signature_profile",accountKey,recordKey:sig.id,proposedFix:"Preserve revocation and audit metadata. Do not reactivate or delete; use the authorized revocation-review process."});if(unknown.length)add({category:"SIGNATURE_PROFILE_FIELDS_OUTSIDE_ALLOWLIST",reasonCode:"SIGNATURE_PROFILE_HAS_LEGACY_FIELDS_NOT_IN_ALLOWLIST",severity:"LEGACY_FIELDS_PRESERVED_NOT_BLOCKING_UPDATE",subjectType:"signature_profile",accountKey,recordKey:sig.id,proposedFix:"Do not delete or rewrite legacy fields. The proposed update rule checks changed keys; allowlisted merge updates preserve untouched legacy fields. Avoid writing unknown fields.",outsideAllowlistFields:unknown});if(norm(sd.uid)!==sigKey||u&&norm(sd.email)!==norm(u.email))add({category:"SIGNATURE_PROFILE_IDENTITY",reasonCode:"SIGNATURE_PROFILE_UID_OR_EMAIL_MISMATCH",severity:"MANUAL_REVIEW",subjectType:"signature_profile",accountKey,recordKey:sig.id,proposedFix:"Manual verification. Do not repoint profile ownership or stored signature assets."});}
 }
 for(const u of users){
  const uid=u.uid,email=norm(u.email),aRef=hash("account",uid),admin=adminUid.get(uid),employee=dedupe([employeeUid.get(uid),...(employeeByDataUid.get(uid)||[]),...(email?(employeeByEmail.get(email)||[]):[])]).find(x=>activeEmployee(x.data))||null,auditor=email?auditorEmail.get(email):null;
  const claims=u.customClaims||{},adminClaim=claims.admin===true,claimRoles=Array.isArray(claims.irpaRoles)?claims.irpaRoles.filter(str):[];
  const hasAdmin=adminClaim||Boolean(admin&&admin.data.active===true)||email==="irpa2412@gmail.com";
  const hasEmployee=Boolean(employee&&activeEmployee(employee.data)),hasAuditor=Boolean(auditor&&activeAuditor(auditor.data));
  const linked=memberUsers.get(uid)||[],direct=memberByDocId.get(uid),memberAtUid=Boolean(direct&&activeMember(direct.data));
  if(!linked.length){const types=[];if(hasAdmin)types.push("ADMIN");if(hasEmployee)types.push("EMPLOYEE");if(hasAuditor)types.push("AUDITOR");if(signerUid.has(uid))types.push("SIGNER");add({category:"AUTH_USER_WITHOUT_MEMBERS_RECORD",reasonCode:types.length?"AUTH_USER_NO_MEMBER_RECORD_EXPECTED_"+types.join("_"):"AUTH_USER_NO_MEMBER_RECORD_UNCLASSIFIED",severity:types.length?"INFO_EXPECTED_NON_MEMBER_IDENTITY":"REVIEW_NO_REGISTER_LINK",subjectType:"auth_user",accountKey:uid,proposedFix:types.length?"No members record change. Preserve the separate authority identity.":"Manual identity reconciliation. Link only to a verified member or invitation; do not create a member record from email alone."});}
  if(u.disabled){add({category:"LOGIN_PATH_DENIALS",reasonCode:"FIREBASE_AUTH_ACCOUNT_DISABLED",severity:"BLOCKS_AUTHENTICATION",subjectType:"auth_user",accountKey:uid,proposedFix:"Do not re-enable automatically. Confirm disablement reason and obtain account-owner authorization."});loginDenied.add(aRef);blocked.add(aRef);}
  if(linked.length&&!memberAtUid&&!hasAdmin&&!hasEmployee&&!hasAuditor&&!adminClaim&&!claimRoles.length){add({category:"LOGIN_PATH_DENIALS",reasonCode:"MEMBER_AUTHORITY_DOCUMENT_PATH_OR_ACTIVE_STATUS_UNAVAILABLE",severity:"BLOCKS_MEMBER_RULE_AUTHORITY",subjectType:"auth_user",accountKey:uid,proposedFix:"Reconcile the members/{auth.uid} document path and active status before applying admin-only member rules; do not change roles."});loginDenied.add(aRef);blocked.add(aRef);}
  const hasAuthority=hasAdmin||hasEmployee||hasAuditor||memberAtUid||adminClaim||claimRoles.length>0;
  const state=u.disabled?"AUTHENTICATION_DENIED_DISABLED_ACCOUNT":(linked.some(m=>m.data.invitationId&&invById.has(String(m.data.invitationId)))?"MEMBER_INVITATION_MAGIC_LINK_REQUIRES_WORKER_REVIEW":hasAuthority?"REGISTERED_AUTHORITY_PATH_AVAILABLE":"AUTHENTICATED_NON_SENSITIVE_WORKSPACE");
  accountSummaries.push({accountRef:aRef,loginPathState:state,identityPath:hasAdmin?"ADMIN":memberAtUid?"MEMBER":hasEmployee?"EMPLOYEE":hasAuditor?"AUDITOR":adminClaim||claimRoles.length?"CUSTOM_CLAIM":signerUid.has(uid)?"SIGNER":"NONE"});
 }
 const categorySets=new Map(),reasonAccountSets=new Map();
 for(const f of findings){const s=categorySets.get(f.category)||new Set();s.add(f.accountRef);categorySets.set(f.category,s);const r=reasonAccountSets.get(f.reasonCode)||new Set();r.add(f.accountRef);reasonAccountSets.set(f.reasonCode,r);}
 const categoryCounts=Object.fromEntries([...categorySets].map(([k,v])=>[k,v.size])),reasonCodeCounts=Object.fromEntries([...reasonAccountSets].map(([k,v])=>[k,v.size])),loginPathCounts=accountSummaries.reduce((o,x)=>(o[x.loginPathState]=(o[x.loginPathState]||0)+1,o),{});
 const report={schemaVersion:1,auditMode:"READ_ONLY",targetProjectId:PROJECT,targetPlan:"ADMIN_ONLY_MEMBERS_WORKER_ACTIVATION_ALLOWLISTED_SIGNATURE_PROFILES",generatedAt:new Date().toISOString(),policyReference:{proposedMemberRule:"members/{id}: update allowed only for administrator",signatureProfileAllowlist:[...ALLOW],legacyFieldHandling:"Existing fields outside allowlist are reported but preserved; proposed update rule checks changedKeys."},scannedCounts:{firebaseAuthUsers:users.length,memberRecords:members.length,invitationRecords:invitations.length,adminProfiles:admins.length,employeeRecords:employees.length,auditorProfiles:auditors.length,signatureProfiles:profiles.length,signerIdentities:signers.length},categoryCounts,reasonCodeCounts,loginPathCounts,distinctAccountsWithBlockingFindings:blocked.size,distinctAccountsWithLoginPathDenials:loginDenied.size,findings,accountSummaries};
 const fs=require("node:fs");fs.mkdirSync("reports",{recursive:true});fs.writeFileSync("reports/member-account-compatibility-dry-run.json",JSON.stringify(report,null,2)+"\n",{mode:0o600});
 const safe={categoryCounts,reasonCodeCounts};
 console.log("ACCOUNT_COMPATIBILITY_DRY_RUN_COUNTS="+JSON.stringify(safe));
 const summary=[
  "## Accounts by category",
  "",
  "| Category | Account count |",
  "|---|---:|",
  ...Object.entries(categoryCounts).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>"| "+k+" | "+v+" |"),
  "",
  "## Findings by reason code",
  "",
  "| Reason code | Finding count |",
  "|---|---:|",
  ...Object.entries(reasonCodeCounts).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>"| "+k+" | "+v+" |"),
  ""
 ].join("\n");
 fs.writeFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
 console.log("AUDIT_COMPLETE");
})().catch(e=>{const code=String(e&&(e.code||e.name)||"UNCLASSIFIED").replace(/[^A-Z0-9_:-]/gi,"_").slice(0,80);console.error("ACCOUNT_COMPATIBILITY_DRY_RUN_FAILED="+code);process.exit(1);});
