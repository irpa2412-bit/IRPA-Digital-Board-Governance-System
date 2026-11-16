const BUILD_STAMP=String(import.meta.env.VITE_BUILD_STAMP||import.meta.env.VITE_GIT_COMMIT||import.meta.env.VITE_APP_VERSION||"not-injected").replace(/[^a-zA-Z0-9._-]/g,"").slice(0,80)||"not-injected";
function targetPath(target){
  if(typeof target==="string")return target;
  if(typeof target?.path==="string")return target.path;
  const path=target?._query?.path;
  if(path?.canonicalString)return path.canonicalString();
  if(Array.isArray(path?.segments))return path.segments.join("/");
  return "unknown";
}
function maskPath(value){
  const parts=String(value||"unknown").split("/");
  return parts.map((part,index)=>index%2===1?"[masked]":part).join("/");
}
function safeCode(error){
  const code=String(error?.code||error?.status||"unknown");
  return /^[a-zA-Z0-9._/-]{1,100}$/.test(code)?code:"unknown";
}
export async function runSignatureFirestore({operation,target,collectionPath,screen,userType},execute){
  try{return await execute();}
  catch(error){
    const report={
      operation:String(operation||"unknown").slice(0,40),
      collectionPath:maskPath(collectionPath||targetPath(target)),
      errorCode:safeCode(error),
      screen:String(screen||"Signature Portal").slice(0,80),
      userType:String(userType||"authenticated-user").slice(0,60),
      buildStamp:BUILD_STAMP
    };
    if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("irpa:signing-diagnostic",{detail:report}));
    throw error;
  }
}
export function wrapSignatureBatch(batch,{screen,userType,collectionPath}={}){
  return new Proxy(batch,{get(target,property,receiver){
    if(property==="commit")return(...args)=>runSignatureFirestore({operation:"writeBatch.commit",collectionPath:collectionPath||"signatureEnvelopes/[masked]+documents/[masked]",screen,userType},()=>target.commit(...args));
    const value=Reflect.get(target,property,receiver);
    return typeof value==="function"?value.bind(target):value;
  }});
}
