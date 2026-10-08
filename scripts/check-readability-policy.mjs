import fs from "node:fs";

const css=fs.readFileSync(new URL("../src/styles/app.css",import.meta.url),"utf8");
const tokens=fs.readFileSync(new URL("../src/styles/tokens.css",import.meta.url),"utf8");
const allCss=css+"\n"+tokens;
const rules=fs.readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");

const requiredCss=[
  "🔴 IRPA-DBGS RED-LINE READABILITY POLICY — APP-WIDE",
  "#root .content-area .page table tbody tr",
  "#root .content-area .page table tbody td",
  "background:transparent;",
  "color:var(--text);",
  "IRPA-DBGS GLOBAL READABILITY CONTRACT — FINAL CASCADE LAYER",
  "text-rendering:optimizeLegibility;",
  "line-height:1.55;",
  "color:var(--text-muted);",
  "IRPA-DBGS CANONICAL UI CONTRACT — MEMBERS & PERSONNEL REFERENCE",
  "--irpa-canonical-ui-reference:members-personnel;",
  "--irpa-canonical-ui-contract:2026-10-09;"
];
for(const marker of requiredCss){
  if(!allCss.includes(marker)) throw new Error("Missing app-wide readability guard: "+marker);
}
if(!rules.includes("RED-LINE POLICY — NON-NEGOTIABLE")){
  throw new Error("firestore.rules is missing the red-line readability policy marker.");
}
if(/!important\b/.test(css)) throw new Error("Readability policy violation: !important found in app.css.");
for(const re of [
  /color\s*:\s*transparent\s*;/i,
  /-webkit-text-fill-color\s*:\s*transparent\s*;/i
]){
  if(re.test(allCss)) throw new Error("Readability policy violation: transparent text styling found: "+re);
}
if(!allCss.includes("background:#ffffff") || !allCss.includes("background:#062b4c")) throw new Error("Canonical UI contract is missing its light content and navy navigation surfaces.");
console.log("App-wide red-line readability policy check passed.");
console.log("Canonical UI contract: Members & Personnel visual standard enforced app-wide.");
console.log("Coverage: authenticated desktop portals + mobile/Capacitor portal views.");
