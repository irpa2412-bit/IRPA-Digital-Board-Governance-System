import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const css=fs.readFileSync(new URL("../src/styles/tokens.css",import.meta.url),"utf8");
function luminance(hex){
 let h=hex.replace("#","");
 if(h.length===3)h=h.split("").map(x=>x+x).join("");
 const c=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
 return .2126*c[0]+.7152*c[1]+.0722*c[2];
}
function ratio(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
test("light portal surfaces bind dark text tokens instead of inheriting dark-theme pale text",()=>{
 assert.match(css,/#root \.app-shell \.content-area:not\(\.dashboard-content-area\) \.page :where\(\.panel/);
 for(const [token,value] of [["--surface","#ffffff"],["--surface-raised","#f4f8f5"],["--text","#17372b"],["--text-muted","#405c50"]]){
  assert.match(css,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+":"+value,"i"));
 }
 assert.ok(ratio("#17372b","#ffffff")>=4.5);
 assert.ok(ratio("#405c50","#ffffff")>=4.5);
});
test("dark status banners own explicit high-contrast text and opacity tokens",()=>{
 assert.match(css,/\.auth-message\s*\{[^}]*--text:#f4f8f6/s);
 assert.match(css,/\.auth-message\s*\{[^}]*background-color:#0e251b/s);
 assert.match(css,/\.auth-message\s*\{[^}]*opacity:1/s);
 assert.ok(ratio("#f4f8f6","#0e251b")>=4.5);
});
