import fs from "node:fs";

const css=fs.readFileSync(new URL("../src/styles/app.css",import.meta.url),"utf8");
const rules=fs.readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");

const requiredCss=[
  "🔴 IRPA-DBGS RED-LINE READABILITY POLICY — APP-WIDE",
  "#root .content-area .page table tbody tr",
  "#root .content-area .page table tbody td",
  "background:transparent;",
  "color:var(--text);"
];
for(const marker of requiredCss){
  if(!css.includes(marker)) throw new Error("Missing app-wide readability guard: "+marker);
}
if(!rules.includes("RED-LINE POLICY — NON-NEGOTIABLE")){
  throw new Error("firestore.rules is missing the red-line readability policy marker.");
}
if(/!important\b/.test(css)) throw new Error("Readability policy violation: !important found in app.css.");
for(const re of [
  /color\s*:\s*transparent\s*;/i,
  /-webkit-text-fill-color\s*:\s*transparent\s*;/i
]){
  if(re.test(css)) throw new Error("Readability policy violation: transparent text styling found: "+re);
}
console.log("App-wide red-line readability policy check passed.");
console.log("Coverage: authenticated desktop portals + mobile/Capacitor portal views.");
