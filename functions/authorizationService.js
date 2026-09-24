const crypto = require("crypto");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { ORGANISATION, PERMISSIONS, validPermission, evaluatePolicy } = require("./authorizationPolicy");

const db = getFirestore();
const auth = getAuth();

const DEFAULT_ROLE_PERMISSIONS = Object.freeze({\n  Administrator: ["authorization.permission.view","authorization.permission.grant","authorization.permission.revoke"]\n});\n\nfunction clean(value){ return String(value ?? "").trim(); }
function lower(value){ return clean(value).toLowerCase(); }
function stableJson(value){
  if(Array.isArray(value)) return value.map(stableJson);
  if(value && typeof value==="object"){
    return Object.keys(value).sort().reduce((o,k)=>{o[k]=stableJson(value[k]);return o;},{});
  }
  return value;
}
function grantId({targetUid,permission,scope}){
  return crypto.createHash("sha256").update(JSON.stringify(stableJson({targetUid,permission,scope:scope||{}}))).digest("hex").slice(0,40);
}
async function activeAdministrator(uid){
  if(!uid) return null;
  const snap=await db.collection("adminProfiles").doc(uid).get();
  if(!snap.exists || snap.data()?.active!==true) return null;
  return {uid,email:lower(snap.data()?.email),name:snap.data()?.name||"",role:"Administrator",active:true,source:"adminProfiles"};
}
async function institutionalActor(uid){
  const admin=await activeAdministrator(uid);
  if(admin) return admin;
  const [memberSnap,employeeSnap]=await Promise.all([
    db.collection("members").doc(uid).get(),
    db.collection("employees").doc(uid).get()
  ]);
  const member=memberSnap.exists?memberSnap.data():null;
  const employee=employeeSnap.exists?employeeSnap.data():null;
  const roles=[member?.role,...(Array.isArray(member?.roles)?member.roles:[]),employee?.role,...(Array.isArray(employee?.roles)?employee.roles:[])].map(clean).filter(Boolean);
  if(member?.status==="Active") return {uid,email:lower(member.email),name:member.name||"",role:member.role||roles[0]||"",roles,active:true,source:"members"};
  if(employee?.status==="Active") return {uid,email:lower(employee.email),name:employee.name||"",role:employee.role||roles[0]||"",roles,active:true,source:"employees"};
  return null;
}
async function rolePermissions(actor){
  const roles=[actor.role,...(actor.roles||[])].map(clean).filter(Boolean);
  if(!roles.length) return [];
  const permissions=new Set();
  for(const role of roles){
    const snap=await db.collection("authorizationRolePermissions").doc(role).get();
    if(snap.exists && snap.data()?.active!==false){
      for(const p of Array.isArray(snap.data()?.permissions)?snap.data().permissions:[]) if(validPermission(p)) permissions.add(clean(p));
    }
  }
  return [...permissions];
}
async function directPermissions(uid){
  const snap=await db.collection("authorizationGrants").where("targetUid","==",uid).where("organisation","==",ORGANISATION).where("status","==","Active").get();
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
async function audit(action,recordId,details,actor){
  await db.collection("audit").add({
    action,category:"AUTHORIZATION",
    collection:"authorizationGrants",recordId,
    details:{organisation:ORGANISATION,...details},
    actorUid:actor.uid,actorEmail:actor.email||null,
    createdAt:FieldValue.serverTimestamp()
  });
}
async function requireAdmin(uid){
  const actor=await activeAdministrator(uid);
  if(!actor) throw Object.assign(new Error("Administrator authorization is required."),{code:"permission-denied"});
  return actor;
}

async function getEffectivePermissions(uid){
  const actor=await institutionalActor(uid);
  if(!actor) return {uid,active:false,roles:[],permissions:[]};
  const [rolePerms,grants]=await Promise.all([rolePermissions(actor),directPermissions(uid)]);
  const permissions=new Set(rolePerms);
  for(const grant of grants){
    if(grant.effect!=="Deny" && grant.status==="Active" && validPermission(grant.permission)) permissions.add(grant.permission);
  }
  return {
    uid,
    active:true,
    roles:[...new Set([actor.role,...(actor.roles||[])].filter(Boolean))],
    permissions:[...permissions].sort(),
    grants
  };
}

async function authorize({uid,action,resource={},context={},auditDecision=false}={}){
  const actor=await institutionalActor(uid);
  if(!actor) return {allow:false,reason:"ACTOR_NOT_ACTIVE",policyVersion:"1.0"};
  const effective=await getEffectivePermissions(uid);
  const decision=evaluatePolicy({
    actor,
    organisation:ORGANISATION,
    action,
    resource,
    context,
    effectivePermissions:effective.permissions
  });
  const decisionId=crypto.randomUUID();
  const result={...decision,decisionId,actorUid:uid,permissions:effective.permissions};
  if(auditDecision){
    const decisionRecord={
      decisionId,
      actorUid:uid,
      actorEmail:actor.email||null,
      organisation:ORGANISATION,
      action:clean(action),
      resourceId:resource?.id||resource?.resourceId||null,
      resource,
      context,
      allow:decision.allow===true,
      reason:decision.reason,
      policyVersion:decision.policyVersion,
      createdAt:FieldValue.serverTimestamp()
    };
    await db.collection("authorizationDecisions").doc(decisionId).set(decisionRecord);
    await db.collection("audit").add({
      action:decision.allow?"AUTHORIZATION_ALLOWED":"AUTHORIZATION_DENIED",
      category:"AUTHORIZATION",
      collection:"authorizationDecisions",
      recordId:decisionId,
      details:{action:clean(action),resourceId:resource?.id||resource?.resourceId||null,reason:decision.reason,context},
      actorUid:uid,
      actorEmail:actor.email||null,
      createdAt:FieldValue.serverTimestamp()
    });
  }
  return result;
}

async function grantPermission({actorUid,targetUid,permission,scope={},reason=""}={}){
  const actor=await requireAdmin(actorUid);
  targetUid=clean(targetUid); permission=clean(permission);
  if(!targetUid || !validPermission(permission)) throw Object.assign(new Error("A valid target user and controlled permission are required."),{code:"invalid-argument"});
  if(targetUid===actorUid) throw Object.assign(new Error("Self-grant is not permitted. Administrator access is managed separately."),{code:"failed-precondition"});
  const target=await institutionalActor(targetUid);
  if(!target?.active) throw Object.assign(new Error("The target user is not an active IRPA institutional account."),{code:"failed-precondition"});

  const id=grantId({targetUid,permission,scope});
  const ref=db.collection("authorizationGrants").doc(id);
  const existing=await ref.get();
  if(existing.exists && existing.data()?.status==="Active") return {ok:true,alreadyActive:true,grantId:id,permission,targetUid};

  await ref.set({
    grantId:id,targetUid,permission,effect:"Allow",scope:scope||{},
    status:"Active",organisation:ORGANISATION,grantedByUid:actorUid,grantedByEmail:actor.email||null,
    grantedAt:FieldValue.serverTimestamp(),reason:clean(reason)||null,
    policyVersion:"1.0",updatedAt:FieldValue.serverTimestamp()
  },{merge:true});
  await audit("AUTHORIZATION_PERMISSION_GRANTED",id,{targetUid,permission,scope,reason:clean(reason)||null},actor);
  return {ok:true,alreadyActive:false,grantId:id,permission,targetUid};
}

async function revokePermission({actorUid,targetUid,permission,scope={},reason=""}={}){
  const actor=await requireAdmin(actorUid);
  targetUid=clean(targetUid); permission=clean(permission);
  if(!targetUid || !validPermission(permission)) throw Object.assign(new Error("A valid target user and controlled permission are required."),{code:"invalid-argument"});
  if(targetUid===actorUid) throw Object.assign(new Error("Self-revocation is not permitted through the permission service."),{code:"failed-precondition"});
  if(!clean(reason)) throw Object.assign(new Error("A reason is required when revoking a permission."),{code:"invalid-argument"});
  const id=grantId({targetUid,permission,scope});
  const ref=db.collection("authorizationGrants").doc(id);
  const existing=await ref.get();
  if(!existing.exists) return {ok:true,alreadyRevoked:true,grantId:id,permission,targetUid};
  if(existing.data()?.status==="Revoked") return {ok:true,alreadyRevoked:true,grantId:id,permission,targetUid};

  await ref.set({
    status:"Revoked",revokedAt:FieldValue.serverTimestamp(),
    revokedByUid:actorUid,revokedByEmail:actor.email||null,
    revokeReason:clean(reason)||null,updatedAt:FieldValue.serverTimestamp()
  },{merge:true});
  await audit("AUTHORIZATION_PERMISSION_REVOKED",id,{targetUid,permission,scope,reason:clean(reason)||null},actor);
  return {ok:true,alreadyRevoked:false,grantId:id,permission,targetUid};
}

async function listPermissions({actorUid,targetUid}={}){
  const actor=await requireAdmin(actorUid);
  const uid=clean(targetUid)||actorUid;
  const effective=await getEffectivePermissions(uid);
  return {ok:true,...effective};
}

module.exports = {
  ORGANISATION,
  PERMISSIONS,
  authorize,
  grantPermission,
  revokePermission,
  listPermissions,
  getEffectivePermissions
};
