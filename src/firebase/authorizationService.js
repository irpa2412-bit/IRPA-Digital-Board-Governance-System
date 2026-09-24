import { getFunctions, httpsCallable } from "firebase/functions";
import { auth } from "./config";

const functions = getFunctions(undefined,"us-central1");

function currentUid(){
  const uid=auth.currentUser?.uid;
  if(!uid) throw new Error("Authentication is required.");
  return uid;
}

async function call(name,payload={}){
  currentUid();
  const result=await httpsCallable(functions,name)(payload);
  return result.data||{};
}

export async function authorizeAction({action,resource={},context={},auditDecision=false}={}){
  return call("authorizeAction",{action,resource,context,auditDecision});
}

export async function grantPermission({targetUid,permission,scope={},reason=""}={}){
  return call("grantAuthorizationPermission",{targetUid,permission,scope,reason});
}

export async function revokePermission({targetUid,permission,scope={},reason=""}={}){
  return call("revokeAuthorizationPermission",{targetUid,permission,scope,reason});
}

export async function getEffectivePermissions(targetUid=""){
  return call("getEffectiveAuthorizationPermissions",{targetUid});
}
