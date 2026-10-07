import { HttpError, json } from "./util.mjs";

const mockState = new Map();
let mockReference = 0;

const LOCK_MS = 5 * 60 * 1000;
const FIRST_STAGE_LIMIT = 3;
const SECOND_STAGE_LIMIT = 3;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function sha256Hex(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function validEmail(email) {
  return Boolean(email && email.includes("@"));
}

async function doCall(env, operation, payload = {}) {
  const key = String(payload.key || operation);
  const r = await env.ESIGN_DO.get(env.ESIGN_DO.idFromName(key)).fetch("https://irpa-auth.internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, ...payload })
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || "Cloudflare authentication state operation failed.");
  return body;
}

async function getState(env, key) {
  if (env.DRIVE_MOCK === "true") return structuredClone(mockState.get(key) || {});
  return (await doCall(env, "auth-get", { key })).state || {};
}

async function setFailure(env, key) {
  if (env.DRIVE_MOCK === "true") {
    const current = mockState.get(key) || {};
    const now = Date.now();
    if (current.stage === "SUSPENDED") return { status: "SUSPENDED", resetRequired: true, remainingAttempts: 0 };
    if (current.stage === "LOCKED" && Number(current.lockUntilMs || 0) > now) {
      return { status: "LOCKED", retryAfterSeconds: Math.ceil((current.lockUntilMs - now) / 1000), remainingAttempts: 0, resetRequired: false };
    }
    const stage = String(current.stage || "FIRST");
    const limit = stage === "SECOND" ? SECOND_STAGE_LIMIT : FIRST_STAGE_LIMIT;
    const failedAttempts = Number(current.failedAttempts || 0) + 1;
    if (failedAttempts < limit) {
      mockState.set(key, { stage, failedAttempts, lockUntilMs: 0 });
      return { status: stage, remainingAttempts: limit - failedAttempts, resetRequired: false };
    }
    if (stage === "FIRST") {
      mockState.set(key, { stage: "LOCKED", failedAttempts: 0, lockUntilMs: now + LOCK_MS });
      return { status: "LOCKED", retryAfterSeconds: Math.ceil(LOCK_MS / 1000), remainingAttempts: 0, resetRequired: false };
    }
    mockState.set(key, { stage: "SUSPENDED", failedAttempts, lockUntilMs: 0 });
    return { status: "SUSPENDED", remainingAttempts: 0, resetRequired: true };
  }
  return doCall(env, "auth-record-failure", { key });
}

async function clearState(env, key) {
  if (env.DRIVE_MOCK === "true") {
    mockState.set(key, { stage: "FIRST", failedAttempts: 0, lockUntilMs: 0 });
    return { ok: true };
  }
  return doCall(env, "auth-clear", { key });
}

async function expireLockToSecondStage(env, key) {
  if (env.DRIVE_MOCK === "true") {
    mockState.set(key, { stage: "SECOND", failedAttempts: 0, lockUntilMs: 0 });
    return;
  }
  await doCall(env, "auth-expire-lock", { key });
}

const AUTHZ_ORGANISATION="Improvement of Rangeland in Pastoral Areas";
const DOCUMENT_PERMISSION="document.create";
const DOCUMENT_PERMISSION_CATALOG=new Set([
  "authorization.permission.view","authorization.permission.grant","authorization.permission.revoke",
  "administrator.create","administrator.remove","member.create","member.update","member.remove",
  "meeting.create","meeting.edit","meeting.view","resolution.view","resolution.approve",
  "document.create","document.edit","document.view","document.sign","voting.cast","voting.close",
  "signature.sign","signature.revoke","finance.view","finance.create","finance.approve",
  "reports.view","reports.create"
]);

function firestoreValue(value){
  if(value===null)return {nullValue:null};
  if(typeof value==="boolean")return {booleanValue:value};
  if(typeof value==="number"&&Number.isInteger(value))return {integerValue:String(value)};
  if(typeof value==="number")return {doubleValue:value};
  return {stringValue:String(value)};
}

function firestorePlain(document){
  if(!document?.fields)return null;
  const convert=field=>{
    if(!field)return null;
    if("stringValue" in field)return field.stringValue;
    if("booleanValue" in field)return field.booleanValue;
    if("integerValue" in field)return Number(field.integerValue);
    if("doubleValue" in field)return field.doubleValue;
    if("timestampValue" in field)return field.timestampValue;
    if("nullValue" in field)return null;
    if("arrayValue" in field)return (field.arrayValue.values||[]).map(convert);
    if("mapValue" in field)return Object.fromEntries(Object.entries(field.mapValue.fields||{}).map(([k,v])=>[k,convert(v)]));
    return null;
  };
  return Object.fromEntries(Object.entries(document.fields).map(([k,v])=>[k,convert(v)]));
}

function firestoreDatabase(env){
  return "projects/"+String(env.FIREBASE_PROJECT_ID||"irpa-digital-board-governance")+"/databases/(default)";
}

async function firestoreJson(env,token,path,options={}){
  const response=await fetch("https://firestore.googleapis.com/v1/"+path,{
    ...options,
    headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(options.headers||{})}
  });
  const text=await response.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  if(!response.ok){
    const error=new Error(data?.error?.message||"Unable to access the IRPA authorization or document-reference records.");
    error.status=response.status;
    throw error;
  }
  return data;
}

async function queryFirestore(env,token,collectionName,filters=[],limit=20){
  const whereFilters=filters.map(([fieldPath,value])=>({fieldFilter:{field:{fieldPath},op:"EQUAL",value:firestoreValue(value)}}));
  const where=whereFilters.length===1?whereFilters[0]:whereFilters.length>1?{compositeFilter:{op:"AND",filters:whereFilters}}:undefined;
  const structuredQuery={from:[{collectionId:collectionName}],limit};
  if(where)structuredQuery.where=where;
  const data=await firestoreJson(env,token,firestoreDatabase(env)+"/documents:runQuery",{
    method:"POST",
    body:JSON.stringify({structuredQuery})
  });
  return (Array.isArray(data)?data:data?.rows||[]).filter(row=>row.document).map(row=>row.document);
}

async function authorizeDocumentReferenceGeneration(env,claims){
  const uid=claims.user_id;
  const [admin,member,employee]=await Promise.all([
    getFirestoreDocument(env,"adminProfiles/"+uid,claims.token),
    getFirestoreDocument(env,"members/"+uid,claims.token),
    getFirestoreDocument(env,"employees/"+uid,claims.token)
  ]);
  let actor=null;
  if(admin?.fields?.active?.booleanValue===true){
    actor={uid,email:String(admin.fields?.email?.stringValue||claims.email||"").toLowerCase(),role:"Administrator",roles:[],active:true};
  }else{
    const memberData=firestorePlain(member)||{};
    const employeeData=firestorePlain(employee)||{};
    const memberRoles=[memberData.role,...(Array.isArray(memberData.roles)?memberData.roles:[])].map(String).filter(Boolean);
    const employeeRoles=[employeeData.role,...(Array.isArray(employeeData.roles)?employeeData.roles:[])].map(String).filter(Boolean);
    if(memberData.status==="Active") actor={uid,email:String(memberData.email||claims.email||"").toLowerCase(),role:String(memberData.role||memberRoles[0]||""),roles:memberRoles,active:true};
    else if(employeeData.status==="Active") actor={uid,email:String(employeeData.email||claims.email||"").toLowerCase(),role:String(employeeData.role||employeeRoles[0]||""),roles:employeeRoles,active:true};
  }
  if(!actor)throw new HttpError(403,"Permission denied for document reference generation.");
  const roles=[actor.role,...actor.roles].filter(Boolean);
  const roleDocs=await Promise.all(roles.map(role=>getFirestoreDocument(env,"authorizationRolePermissions/"+encodeURIComponent(role),claims.token)));
  const permissions=new Set();
  for(const snap of roleDocs){
    const data=firestorePlain(snap)||{};
    if(data.active!==false&&Array.isArray(data.permissions))for(const permission of data.permissions){
      if(DOCUMENT_PERMISSION_CATALOG.has(String(permission).trim()))permissions.add(String(permission).trim());
    }
  }
  const grants=await queryFirestore(env,claims.token,"authorizationGrants",[["targetUid",uid],["organisation",AUTHZ_ORGANISATION],["status","Active"]],100);
  for(const grant of grants){
    const data=firestorePlain(grant)||{};
    if(data.effect!=="Deny"&&data.status==="Active"&&DOCUMENT_PERMISSION_CATALOG.has(String(data.permission||"").trim()))permissions.add(String(data.permission).trim());
  }
  if(!permissions.has(DOCUMENT_PERMISSION))throw new HttpError(403,"Permission denied for document reference generation.");
  return {actor,permissions:[...permissions].sort()};
}

function parseBatchGet(text){
  return String(text||"").split(/\r?\n/).map(line=>line.trim()).filter(Boolean).flatMap(line=>{
    try{return [JSON.parse(line)];}catch{return [];}
  });
}

async function firestoreBatchGetInTransaction(env,token,documents,transaction){
  const response=await fetch("https://firestore.googleapis.com/v1/"+firestoreDatabase(env)+"/documents:batchGet",{
    method:"POST",
    headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify({documents,transaction})
  });
  const text=await response.text();
  if(!response.ok)throw new Error("Unable to read the document reference transaction state.");
  return parseBatchGet(text);
}

async function issueDocumentReferenceFromFirestore(env,claims){
  for(let attempt=1;attempt<=3;attempt+=1){
    let transaction=null;
    try{
      const begin=await firestoreJson(env,claims.token,firestoreDatabase(env)+"/documents:beginTransaction",{
        method:"POST",body:JSON.stringify({options:{readWrite:{}}})
      });
      transaction=begin.transaction;
      const counterName=firestoreDatabase(env)+"/documents/systemSettings/documentCounters";
      const first=await firestoreBatchGetInTransaction(env,claims.token,[counterName],transaction);
      const counter=first.find(row=>row.found)?.found||null;
      const current=counter?Number(counter.fields?.documentReference?.integerValue||0):0;
      if(!Number.isInteger(current)||current<0)throw new Error("The document reference counter is invalid.");
      const year=new Date().getUTCFullYear();
      const registryPrefix=firestoreDatabase(env)+"/documents/documentReferenceRegistry/IRPA-DOC-"+year+"-";
      const candidates=Array.from({length:25},(_,i)=>registryPrefix+String(current+i+1).padStart(5,"0"));
      const rows=await firestoreBatchGetInTransaction(env,claims.token,candidates,transaction);
      const existing=new Set(rows.filter(row=>row.found).map(row=>row.found.name));
      let nextNumber=current+1;
      while(existing.has(registryPrefix+String(nextNumber).padStart(5,"0"))&&nextNumber<current+25)nextNumber++;
      if(existing.has(registryPrefix+String(nextNumber).padStart(5,"0")))throw new Error("Document reference registry collision could not be resolved.");
      const reference="IRPA-DOC-"+year+"-"+String(nextNumber).padStart(5,"0");
      const nowField={fieldPath:"updatedAt",setToServerValue:"REQUEST_TIME"};
      const counterFields={documentReference:{integerValue:String(nextNumber)}};
      const registryFields={
        referenceNumber:{stringValue:reference},
        referenceYear:{integerValue:String(year)},
        sequenceNumber:{integerValue:String(nextNumber)},
        issuedByUid:{stringValue:claims.user_id},
        issuedByEmail:claims.email?{stringValue:String(claims.email).toLowerCase()}:{nullValue:null},
        issuedBy:{stringValue:"SYSTEM"},
        controlStatus:{stringValue:"Active"}
      };
      const counterWrite={
        update:{name:counterName,fields:counterFields},
        updateTransforms:[nowField],
        currentDocument:{exists:counter!==null}
      };
      const registryName=registryPrefix+String(nextNumber).padStart(5,"0");
      const registryWrite={
        update:{name:registryName,fields:registryFields},
        updateTransforms:[
          {fieldPath:"createdAt",setToServerValue:"REQUEST_TIME"},
          {fieldPath:"updatedAt",setToServerValue:"REQUEST_TIME"}
        ],
        currentDocument:{exists:false}
      };
      await firestoreJson(env,claims.token,firestoreDatabase(env)+"/documents:commit",{
        method:"POST",body:JSON.stringify({writes:[counterWrite,registryWrite],transaction})
      });
      return {reference,year,issuedBy:"SYSTEM",issuedByUid:claims.user_id,issuedByEmail:claims.email||null};
    }catch(error){
      const message=String(error?.message||"");
      if(attempt<3&&/ABORTED|transaction|conflict/i.test(message))continue;
      throw error;
    }
  }
  throw new Error("Document reference service failed. Please retry.");
}

export async function routeCloudflareAuth(request, env, authenticate) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (env.CLOUDFLARE_AUTH_FUNCTIONS_ENABLED !== "true") return null;

  const isMigratedAuthPath =
    pathname === "/api/auth/password-attempt-state" ||
    pathname === "/api/auth/password-failure" ||
    pathname === "/api/auth/password-attempt-clear" ||
    pathname === "/api/documents/next-reference";
  if (!isMigratedAuthPath) return null;
  if (request.method !== "POST") return json(405, { ok: false, error: "Method not allowed." });

  if (pathname === "/api/auth/password-attempt-state") {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) throw new HttpError(400, "A valid registered email address is required.");
    const key = "auth-state:" + await sha256Hex(email);
    let state = await getState(env, key);
    const now = Date.now();
    if (Number(state.lockUntilMs || 0) && Number(state.lockUntilMs) <= now && state.stage === "LOCKED") {
      await expireLockToSecondStage(env, key);
      state = { stage: "SECOND", failedAttempts: 0, lockUntilMs: 0 };
    }
    if (state.stage === "SUSPENDED") return json(200, { allowed: false, status: "SUSPENDED", remainingAttempts: 0, resetRequired: true });
    if (Number(state.lockUntilMs || 0) > now) {
      return json(200, { allowed: false, status: "LOCKED", remainingAttempts: 0, lockUntilMs: state.lockUntilMs, retryAfterSeconds: Math.ceil((state.lockUntilMs - now) / 1000), resetRequired: false });
    }
    const limit = state.stage === "SECOND" ? SECOND_STAGE_LIMIT : FIRST_STAGE_LIMIT;
    return json(200, { allowed: true, status: state.stage || "FIRST", remainingAttempts: Math.max(0, limit - Number(state.failedAttempts || 0)), resetRequired: false });
  }

  if (pathname === "/api/auth/password-failure") {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) throw new HttpError(400, "A valid registered email address is required.");
    return json(200, await setFailure(env, "auth-state:" + await sha256Hex(email)));
  }

  if (pathname === "/api/auth/password-attempt-clear") {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) throw new HttpError(400, "A valid registered email address is required.");
    return json(200, await clearState(env, "auth-state:" + await sha256Hex(email)));
  }

  if (pathname === "/api/documents/next-reference") {
    if (typeof authenticate !== "function") throw new HttpError(500, "Firebase authentication verifier was not provided.");
    let claims;
    try { claims = await authenticate(request); }
    catch (error) {
      const message = String(error?.message || error);
      if (message === "Firebase authentication is required." || message.startsWith("Invalid Firebase") || message === "Firebase token is expired." || message === "Firebase token signing key not found.") {
        throw new HttpError(401, "Authentication is required to generate a document reference.");
      }
      throw error;
    }
    const authorization = await authorizeDocumentReferenceGeneration(env, claims);
    const result = env.DRIVE_MOCK === "true"
      ? { reference: "IRPA-DOC-" + new Date().getUTCFullYear() + "-" + String(++mockReference).padStart(5, "0"), year: new Date().getUTCFullYear(), issuedBy: "SYSTEM", issuedByUid: claims.user_id, issuedByEmail: claims.email || null }
      : await issueDocumentReferenceFromFirestore(env, claims);
    return json(200, { ok: true, ...result, authorization: { action: DOCUMENT_PERMISSION, permissions: authorization.permissions } });
  }

  return null;
}
