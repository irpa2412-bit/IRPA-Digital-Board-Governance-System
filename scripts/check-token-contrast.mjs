import fs from "node:fs";

const css=fs.readFileSync(new URL("../src/styles/tokens.css",import.meta.url),"utf8");
const surfaces=["surface-dark","surface-light","surface-white","surface-blue"];
const required=["--surface","--surface-raised","--text","--text-muted","--border","--border-strong","--focus","--placeholder","--error","--success"];
const textTokens=["--text","--text-muted","--placeholder","--error","--success"];
const uiTokens=["--border","--border-strong","--focus"];

function blockFor(selector){
  const re=/([^{}]+)\\{([^{}]*)\\}/g;
  for(const m of css.matchAll(re)){
    const selectors=m[1].split(",").map(v=>v.trim());
    if(selectors.includes("." + selector)) return m[2];
  }
  throw new Error("Missing token surface ." + selector);
}
function vars(block){
  const out={};
  for(const m of block.matchAll(/(--[a-z-]+)\\s*:\\s*(#[0-9a-fA-F]{3,8})/g)) out[m[1]]=m[2];
  return out;
}
function luminance(hex){
  let h=hex.slice(1);
  if(h.length===3) h=h.split("").map(c=>c+c).join("");
  if(h.length!==6) throw new Error(`Unsupported token color ${hex}`);
  const rgb=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
}
function contrast(a,b){
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
let failed=false;
const report=[];
for(const surface of surfaces){
  const v=vars(blockFor(surface));
  for(const key of required) if(!v[key]) throw new Error(`.${surface} is missing ${key}`);
  for(const key of textTokens){
    const ratio=contrast(v[key],v["--surface"]);
    report.push(`.${surface} ${key} vs --surface: ${ratio.toFixed(2)}:1`);
    if(ratio<4.5){failed=true;console.error(`FAIL ${report.at(-1)}`);}
  }
  for(const key of uiTokens){
    const ratio=contrast(v[key],v["--surface"]);
    report.push(`.${surface} ${key} vs --surface: ${ratio.toFixed(2)}:1`);
    if(ratio<3){failed=true;console.error(`FAIL ${report.at(-1)}`);}
  }
}
console.log(report.join("\n"));
if(failed) process.exit(1);
console.log("Token contrast check passed.");
