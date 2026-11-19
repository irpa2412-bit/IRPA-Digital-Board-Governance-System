const norm=value=>String(value||"").trim().toLocaleLowerCase().replace(/\s+/g," ");
const email=value=>String(value||"").trim().toLocaleLowerCase();
const rolesFor=person=>Array.isArray(person?.roleAssignments)&&person.roleAssignments.length?person.roleAssignments:[{role:person?.role||"Signer",title:person?.title||"",capacity:person?.capacity||"",occupation:person?.occupation||""}];
const roleKey=role=>[role?.role,role?.title,role?.capacity,role?.occupation].map(norm).join("|");

export function findDuplicateParticipantGroups(recipients=[]){
 const groups=new Map();
 for(const recipient of recipients){
  const name=norm(recipient?.name),mail=email(recipient?.email);
  if(!name||!mail||!recipient?.uid)continue;
  const key=name+"|"+mail;
  const group=groups.get(key)||[];group.push(recipient);groups.set(key,group);
 }
 return [...groups.values()].filter(group=>new Set(group.map(item=>String(item.uid))).size>1);
}

export function analyzeFieldAssignments({recipients=[],fields=[],ownerUid="",ownerSigningEnabled=false}={}){
 const ids=new Set(recipients.map(item=>String(item?.uid||"")).filter(Boolean));
 if(ownerSigningEnabled&&ownerUid)ids.add(String(ownerUid));
 const fieldIssues=(fields||[]).flatMap((field,index)=>{
  const uid=String(field?.signerUid||"").trim();
  if(!uid)return [{kind:"unassigned-field",reason:"no signer",fieldId:field?.fieldId||"",fieldNumber:index+1,page:Number(field?.page)||1,index}];
  if(uid===String(ownerUid)&&!ownerSigningEnabled)return [{kind:"unassigned-field",reason:"owner signing is off",fieldId:field?.fieldId||"",fieldNumber:index+1,page:Number(field?.page)||1,index}];
  if(!ids.has(uid))return [{kind:"orphaned-field",reason:"signer not in list",fieldId:field?.fieldId||"",fieldNumber:index+1,page:Number(field?.page)||1,index,signerUid:uid}];
  return [];
 });
 const recipientsWithoutFields=(recipients||[]).filter(person=>person?.uid&&!(fields||[]).some(field=>String(field?.signerUid||"")===String(person.uid))).map(person=>({uid:String(person.uid),name:person.name||person.email||"Participant",email:person.email||"",reason:"no signer fields assigned",fieldCount:0}));
 return {fieldIssues,orphanedFields:fieldIssues.filter(item=>item.kind==="orphaned-field"),recipientsWithoutFields,duplicateGroups:findDuplicateParticipantGroups(recipients)};
}

function mergePair(recipients,fields,keepUid,removeUid){
 const keep=recipients.find(item=>String(item.uid)===String(keepUid));
 const remove=recipients.find(item=>String(item.uid)===String(removeUid));
 if(!keep||!remove)throw new Error("Both participant entries must exist before merging.");
 if(norm(keep.name)!==norm(remove.name)||email(keep.email)!==email(remove.email)||!email(keep.email))throw new Error("Only participants with the same name and email can be merged.");
 const keepRoles=rolesFor(keep),removeRoles=rolesFor(remove);
 const assignments=[...keepRoles,...removeRoles];
 const unique=[...new Map(assignments.map(item=>[roleKey(item),item])).values()];
 const merged={...keep,roleAssignments:unique,role:keep.role||remove.role,title:keep.title||remove.title,capacity:keep.capacity||remove.capacity};
 const movedFields=fields.map(field=>{if(String(field?.signerUid||"")!==String(removeUid))return field;const oldRole=removeRoles[Math.max(0,Math.min(Number(field.roleAssignmentIndex||0),removeRoles.length-1))];const roleAssignmentIndex=Math.max(0,unique.findIndex(item=>roleKey(item)===roleKey(oldRole)));return {...field,signerUid:String(keepUid),roleAssignmentIndex};});
 return {recipients:recipients.filter(item=>String(item.uid)!==String(removeUid)).map(item=>String(item.uid)===String(keepUid)?merged:item),fields:movedFields};
}

export function mergeDuplicateParticipants(recipients=[],fields=[]){
 let nextRecipients=[...recipients],nextFields=[...fields],merged=[];
 for(const group of findDuplicateParticipantGroups(nextRecipients)){
  const live=group.filter(person=>nextRecipients.some(item=>String(item.uid)===String(person.uid)));
  if(live.length<2)continue;
  const ranked=[...live].sort((a,b)=>nextFields.filter(f=>String(f?.signerUid||"")===String(b.uid)).length-nextFields.filter(f=>String(f?.signerUid||"")===String(a.uid)).length);
  const keep=ranked[0];
  for(const remove of ranked.slice(1)){
   if(!nextRecipients.some(item=>String(item.uid)===String(remove.uid)))continue;
   const result=mergePair(nextRecipients,nextFields,keep.uid,remove.uid);nextRecipients=result.recipients;nextFields=result.fields;
   merged.push({keptUid:String(keep.uid),removedUid:String(remove.uid),name:keep.name||keep.email});
  }
 }
 return {recipients:nextRecipients,fields:nextFields,merged};
}

function resolveFieldParticipant(field,recipients){
 const snapshot=field?.signerSnapshot||field?.signer||{};
 const targetEmail=email(field?.signerEmail||field?.email||snapshot.email);
 const targetName=norm(field?.signerName||field?.name||snapshot.name);
 if(targetEmail){const matches=recipients.filter(person=>email(person.email)===targetEmail&&(!targetName||norm(person.name)===targetName));return matches.length===1?matches[0]:null;}
 if(targetName){const matches=recipients.filter(person=>norm(person.name)===targetName);return matches.length===1?matches[0]:null;}
 return null;
}

export function repairDraftAssignments({recipients=[],fields=[],ownerUid="",ownerSigningEnabled=false}={}){
 const merged=mergeDuplicateParticipants(recipients,fields);
 const ids=new Set(merged.recipients.map(item=>String(item.uid||"")).filter(Boolean));
 if(ownerSigningEnabled&&ownerUid)ids.add(String(ownerUid));
 let relinked=0;
 const nextFields=merged.fields.map(field=>{
  const uid=String(field?.signerUid||"").trim();
  if(!uid||ids.has(uid))return field;
  const match=resolveFieldParticipant(field,merged.recipients);
  if(!match)return field;
  relinked++;return {...field,signerUid:String(match.uid)};
 });
 const diagnostics=analyzeFieldAssignments({recipients:merged.recipients,fields:nextFields,ownerUid,ownerSigningEnabled});
 return {recipients:merged.recipients,fields:nextFields,merged:merged.merged,relinked,unresolvedOrphans:diagnostics.orphanedFields,recipientsWithoutFields:diagnostics.recipientsWithoutFields,fieldIssues:diagnostics.fieldIssues};
}

export function relinkOrphanedField(fields=[],fieldId,signerUid,recipients=[]){
 if(!recipients.some(person=>String(person?.uid||"")===String(signerUid)))throw new Error("Choose a current participant before re-linking this field.");
 let found=false;
 const next=(fields||[]).map(field=>{if(String(field?.fieldId||"")!==String(fieldId))return field;found=true;return {...field,signerUid:String(signerUid)};});
 if(!found)throw new Error("The orphaned field could not be found in this draft.");
 return next;
}

export function describeFieldAssignmentIssues(input){
 const result=analyzeFieldAssignments(input);
 return result.fieldIssues.map(issue=>({page:issue.page,fieldNumber:issue.fieldNumber,reason:issue.reason,kind:issue.kind}));
}
