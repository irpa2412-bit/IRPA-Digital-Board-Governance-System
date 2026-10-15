import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
const portal=readFileSync(new URL("../src/pages/CommunicationMediaPortal.jsx",import.meta.url),"utf8");
const rules=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
const fn=readFileSync(new URL("../functions/communicationMedia.js",import.meta.url),"utf8");
const index=readFileSync(new URL("../functions/index.js",import.meta.url),"utf8");

test("communications portal is integrated into the existing shell and role-based navigation",()=>{
 assert.ok(app.includes('import CommunicationMediaPortal from "./pages/CommunicationMediaPortal"'));
 assert.ok(app.includes('COMMUNICATIONS:["Communication & Media"]'));
 assert.ok(app.includes('if(COMMUNICATIONS_ROLES.includes(selected))m.push("Communication & Media")'));
 assert.ok(app.includes('active==="Communication & Media"&&<CommunicationMediaPortal'));
 assert.ok(portal.includes('if(!authorized)return'));
});

test("communications workspace supports drafts, approval, library, calendar and website publishing",()=>{
 for(const term of ["Create communications item","Content library","Editorial Calendar","Publishing Setup","Pending Approval","Approved","Returned","Media Asset","Submit for approval","Publish to website"]) assert.ok(portal.includes(term),term);
 assert.ok(portal.includes('collection(db,"communicationMediaItems")'));
 assert.ok(portal.includes('window.confirm("Publish this approved item to the IRPA WordPress website now?'));
});

test("website publishing is server-side, role checked, secret-backed, HTTPS-only and approval-gated",()=>{
 for(const secret of ["WORDPRESS_BASE_URL","WORDPRESS_USERNAME","WORDPRESS_APPLICATION_PASSWORD"]) assert.ok(fn.includes(secret),secret);
 assert.ok(fn.includes('request.auth?.uid'));
 assert.ok(fn.includes('if(!access.reviewer)'));
 assert.ok(fn.includes('item.status!=="Approved"'));
 assert.ok(fn.includes('base.protocol!=="https:"'));
 assert.ok(fn.includes('status:"publish"'));
 assert.ok(fn.includes('escapeHtml(paragraph)'));
 assert.ok(index.includes('exports.publishCommunicationMediaItem = communicationMedia.publishCommunicationMediaItem'));
 assert.ok(!portal.includes("WORDPRESS_APPLICATION_PASSWORD.value"));
});

test("Firestore rules restrict records to authorised communications roles and prohibit deletion",()=>{
 assert.ok(rules.includes("function communicationMediaUser()"));
 assert.ok(rules.includes("function communicationMediaReviewer()"));
 assert.ok(rules.includes("match /communicationMediaItems/{id}"));
 assert.ok(rules.includes("allow delete:if false;"));
 assert.ok(rules.includes('request.resource.data.get("status","")=="Draft"'));
 assert.ok(rules.includes('request.resource.data.get("status","") in ["Approved","Returned"]'));
});
