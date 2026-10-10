import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const changedOnly=process.argv.includes("--changed-only");
const failures=[];
function run(label,args) {
  const r=spawnSync(process.execPath,args,{encoding:"utf8"});
  console.log(`\n[VERIFIER] ${label}: ${r.status===0?"PASS":"FAIL"}`);
  if(r.stdout) console.log(r.stdout.trim());
  if(r.stderr) console.error(r.stderr.trim());
  if(r.status!==0) failures.push(label);
}
run("Independent source readability/contrast audit",["scripts/check-production-readability.mjs",...(changedOnly?["--changed-only"]:[])]);
const dist=path.resolve("dist");
const html=path.join(dist,"index.html");
if(!fs.existsSync(html)||!fs.statSync(html).size) failures.push("Production HTML artifact");
else {
  const doc=fs.readFileSync(html,"utf8");
  if(!/<html\b/i.test(doc)) failures.push("Production HTML structure");
  const refs=[...doc.matchAll(/(?:src|href)=["']([^"']+\.(?:css|js)(?:\?[^"']*)?)["']/gi)].map(m=>m[1]);
  const assets=refs.map(ref=>path.resolve(dist,ref.replace(/^\//,"").split("?")[0])).filter(p=>p.startsWith(dist+path.sep));
  if(!assets.some(p=>p.endsWith(".css")&&fs.existsSync(p))) failures.push("Built CSS asset");
  if(!assets.some(p=>p.endsWith(".js")&&fs.existsSync(p))) failures.push("Built JavaScript asset");
  for(const asset of assets.filter(p=>fs.existsSync(p)&&p.endsWith(".css"))) {
    const css=fs.readFileSync(asset,"utf8");
    if(/(?:^|[;{\s])(?:color|-webkit-text-fill-color)\s*:\s*transparent\b/i.test(css)) failures.push("Built CSS contains transparent text: "+path.relative(dist,asset));
    if(!changedOnly && /font-size\s*:\s*[0-9]+(?:\.\d+)?(?:px|pt)\b/i.test(css)) {
      const small=[...css.matchAll(/font-size\s*:\s*([0-9]+(?:\.\d+)?)(px|pt)\b/ig)].filter(m=>Number(m[1])*(m[2].toLowerCase()==="pt"?4/3:1)<12);
      if(small.length) failures.push(`Built CSS contains ${small.length} font-size declaration(s) below 12px in ${path.relative(dist,asset)}`);
    }
  }
  console.log("[VERIFIER] Production HTML and emitted JS/CSS assets: "+(failures.length?"CHECK REQUIRED":"PASS"));
}
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/readability-verification-report.json",JSON.stringify({
  generatedAt:new Date().toISOString(),
  mode:changedOnly?"changed-files":"full-production",
  passed:failures.length===0,
  failures:[...new Set(failures)],
  productionHtmlPresent:fs.existsSync(html)&&fs.statSync(html).size>0
},null,2)+"\n");
if(failures.length) {
  console.error("\nPRODUCTION READABILITY VERIFICATION FAILED — RELEASE MUST NOT PROCEED.");
  for(const f of [...new Set(failures)]) console.error("- "+f);
  process.exit(1);
}
console.log("\nPRODUCTION READABILITY VERIFICATION PASSED.");
