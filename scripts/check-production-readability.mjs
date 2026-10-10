import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const changedOnly = process.argv.includes("--changed-only");
const extensions = new Set([".css",".scss",".html",".htm",".js",".jsx",".ts",".tsx",".vue",".svelte"]);
const ignored = new Set(["node_modules",".git","dist","build","coverage",".next"]);
const violations = [];
const notes = [];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function walk(dir, out=[]) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if (entry.isDirectory()) { if (!ignored.has(entry.name)) walk(path.join(dir,entry.name),out); }
    else if (extensions.has(path.extname(entry.name).toLowerCase())) out.push(path.join(dir,entry.name));
  }
  return out;
}
function changedFiles() {
  const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main";
  const r = spawnSync("git",["diff","--name-only",`${base}...HEAD`],{encoding:"utf8"});
  if (r.status !== 0) throw new Error("Cannot determine changed files for scoped audit: "+(r.stderr||"git diff failed"));
  return r.stdout.split(/\r?\n/).filter(Boolean).filter(f=>extensions.has(path.extname(f).toLowerCase()) && fs.existsSync(f));
}
function lum(hex) {
  let h=hex.slice(1); if(h.length===3) h=[...h].map(c=>c+c).join("");
  if(h.length!==6) return null;
  const rgb=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
}
function ratio(a,b) { const x=lum(a),y=lum(b); return x===null||y===null?null:(Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
function add(file,line,message) { violations.push({file,line,message}); }
function auditFile(file) {
  const source=fs.readFileSync(file,"utf8");
  const lines=source.split(/\r?\n/);
  lines.forEach((line,i)=>{
    if(/(?:^|[;,{\s])(?:color|-webkit-text-fill-color)\s*:\s*transparent\b/i.test(line)) add(file,i+1,"Text color is transparent.");
    if(/(?:^|[;,{\s])opacity\s*:\s*0(?:\.0+)?\s*(?:!important)?\s*(?:;|})/i.test(line) && /(text|label|title|heading|caption|content|button|nav|status|message)/i.test(line)) add(file,i+1,"Text-bearing rule has opacity:0.");
    if(/(?:font-size\s*:\s*(?:[0-9]+(?:\.[0-9]+)?)(?:px|pt))/i.test(line)) {
      for (const m of line.matchAll(/font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)(px|pt)/ig)) {
        const px=Number(m[1])*(m[2].toLowerCase()==="pt"?4/3:1);
        if(px<12) add(file,i+1,`Text size ${m[1]}${m[2]} is below the 12px readability floor.`);
      }
    }
    for (const m of line.matchAll(/fontSize\s*:\s*["']?([0-9]+(?:\.[0-9]+)?)(px|pt)["']?/ig)) {
      const px=Number(m[1])*(m[2].toLowerCase()==="pt"?4/3:1);
      if(px<12) add(file,i+1,`Inline text size ${m[1]}${m[2]} is below the 12px readability floor.`);
    }
  });
  if(path.extname(file).toLowerCase()===".css" || /\.scss$/i.test(file)) {
    // Conservative same-rule contrast check for explicit solid foreground/background colors.
    const blocks=/([^{}]+)\{([^{}]*)\}/g;
    for(const match of source.matchAll(blocks)) {
      const body=match[2];
      const fg=body.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,6})\b/i)?.[1];
      const bg=body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})\b/i)?.[1];
      if(fg&&bg&&HEX.test(fg)&&HEX.test(bg)) {
        const cr=ratio(fg,bg);
        if(cr!==null&&cr<4.5) add(file,source.slice(0,match.index).split("\n").length,`Explicit text/background contrast ${cr.toFixed(2)}:1 is below 4.5:1 (${fg} on ${bg}).`);
      }
    }
  }
}
const rootHtml=fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isFile() && extensions.has(path.extname(e.name).toLowerCase())).map(e=>path.join(root,e.name));
const files=changedOnly?changedFiles():[...walk(path.join(root,"src")),...walk(path.join(root,"public")),...rootHtml].filter(f=>fs.existsSync(f));
if(!files.length) notes.push(changedOnly?"No changed UI/source files matched the scoped audit.":"No UI/source files were found to audit.");
for(const file of [...new Set(files)]) auditFile(file);

// Run the existing policy and token contrast checks as part of the dedicated gate.
for(const script of ["check-readability-policy.mjs","check-token-contrast.mjs"]) {
  const p=path.join(root,"scripts",script);
  if(!fs.existsSync(p)) { add(p,1,"Required existing readability control is missing."); continue; }
  const run=spawnSync(process.execPath,[p],{encoding:"utf8"});
  if(run.status!==0) {
    add(p,1,`Existing check failed (exit ${run.status}). ${(run.stderr||run.stdout||"").trim().slice(0,900)}`);
  } else notes.push(`${script}: PASS`);
}
console.log(`IRPA-DBGS Readability & Contrast Checker — mode: ${changedOnly?"changed-files":"full-production"}`);
console.log(`Files audited: ${new Set(files).size}`);
for(const note of notes) console.log("INFO: "+note);
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/readability-check-report.json",JSON.stringify({
  generatedAt:new Date().toISOString(),
  mode:changedOnly?"changed-files":"full-production",
  filesAudited:new Set(files).size,
  notes,
  violationCount:violations.length,
  violations
},null,2)+"\n");
if(violations.length) {
  console.error(`FAIL: ${violations.length} readability/contrast violation(s) detected:`);
  for(const v of violations.slice(0,250)) console.error(`- ${v.file}:${v.line}: ${v.message}`);
  if(violations.length>250) console.error(`… plus ${violations.length-250} additional violation(s).`);
  process.exit(1);
}
console.log("PASS: no policy, low-text-size, transparent-text, or explicit solid-color contrast violations detected.");
