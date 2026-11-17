import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root,"src/firebase/signaturePlatform.js");
const source = fs.readFileSync(sourcePath,"utf8");
const forbidden = new Set(["setDoc","updateDoc","addDoc","deleteDoc","writeBatch","runTransaction","arrayUnion","firestoreSetDoc","firestoreUpdateDoc","firestoreWriteBatch","firestoreRunTransaction","firestoreArrayUnion"]);
const entrypoints = [
  "createSignatureEnvelope","saveSignatureWorkflowDraft","finalizeSignatureWorkflowDraft",
  "startSignatureWorkflow","sendSignatureInvitation","signEnvelope","signEnvelopeThroughGateway",
  "syncGatewaySigningMirror","recordEnvelopeEvent","recordSignatureAdoption",
  "attachGatewayEmailLinkEnvelope","getMySignedDocuments","releaseNextSigner"
];
function functionBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const patterns = [
    new RegExp("^(?:export\\s+)?(?:async\\s+)?function\\s+"+escaped+"\\s*\\([^\\n]*?\\)\\s*\\{","m"),
    new RegExp("^(?:export\\s+)?const\\s+"+escaped+"\\s*=\\s*(?:async\\s*)?\\([^\\n]*?\\)\\s*=>\\s*\\{","m")
  ];
  let match=null;
  for (const pattern of patterns) { match=pattern.exec(source); if(match)break; }
  if(!match)return null;
  const open=match.index+match[0].lastIndexOf("{");
  let depth=0,quote=null,escape=false,lineComment=false,blockComment=false;
  for(let i=open;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(lineComment){if(ch==="\n")lineComment=false;continue;}
    if(blockComment){if(ch==="*"&&next==="/"){blockComment=false;i++;}continue;}
    if(quote){if(escape){escape=false;continue;}if(ch==="\\"){escape=true;continue;}if(ch===quote)quote=null;continue;}
    if(ch==="/"&&next==="/"){lineComment=true;i++;continue;}
    if(ch==="/"&&next==="*"){blockComment=true;i++;continue;}
    if(ch==="'"||ch==="\""||ch==="`"){quote=ch;continue;}
    if(ch==="{")depth++;
    else if(ch==="}"&&--depth===0)return source.slice(open+1,i);
  }
  throw new Error("Unbalanced function body: "+name);
}
const definitions = new Map();
for(const match of source.matchAll(/^(?:export\\s+)?(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)\\s*\\(/gm))definitions.set(match[1],true);
for(const match of source.matchAll(/^(?:export\\s+)?const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?\\([^\\n]*?\\)\\s*=>\\s*\\{/gm))definitions.set(match[1],true);
const visited=new Set(),queue=[...entrypoints],failures=[];
while(queue.length){
  const name=queue.shift();
  if(visited.has(name))continue;
  visited.add(name);
  const body=functionBody(name);
  if(body===null)continue;
  for(const match of body.matchAll(/\\b([A-Za-z_$][\\w$]*)\\s*\\(/g)){
    const called=match[1];
    if(forbidden.has(called))failures.push({function:name,operation:called});
    if(definitions.has(called)&&!visited.has(called))queue.push(called);
  }
}
for(const file of ["src/pages/SignaturePlatform.jsx","src/pages/GatewaySigningPortal.jsx"]){
  const text=fs.readFileSync(path.join(root,file),"utf8");
  if(/from\\s*["']firebase\\/firestore["']/.test(text))failures.push({file,operation:"direct Firestore SDK import"});
  for(const op of forbidden)if(new RegExp("\\b"+op+"\\s*\\(").test(text))failures.push({file,operation:op});
}
if(failures.length){
  console.error("FAIL: direct Firestore write SDK call is reachable from the signing flow.");
  for(const failure of failures)console.error(JSON.stringify(failure));
  process.exit(1);
}
console.log("PASS: no direct Firestore write SDK call is reachable from the signature workflow entrypoints.");
console.log("Audited entrypoints: "+entrypoints.join(", "));
