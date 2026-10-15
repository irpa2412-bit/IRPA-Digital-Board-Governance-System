import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
const portal=readFileSync(new URL("../src/pages/CommunicationMediaPortal.jsx",import.meta.url),"utf8");
const studio=readFileSync(new URL("../src/pages/CommunicationMediaStudio.jsx",import.meta.url),"utf8");
const rules=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
const fn=readFileSync(new URL("../functions/communicationMedia.js",import.meta.url),"utf8");
const index=readFileSync(new URL("../functions/index.js",import.meta.url),"utf8");
const gateway=readFileSync(new URL("../drive-gateway/src/index.js",import.meta.url),"utf8");

test("communications portal is integrated into the existing shell and role-based navigation",()=>{
 assert.ok(app.includes('import CommunicationMediaPortal from "./pages/CommunicationMediaPortal"'));
 assert.ok(app.includes('COMMUNICATIONS:["Communication & Media"]'));
 assert.ok(app.includes('if(COMMUNICATIONS_ROLES.includes(selected))m.push("Communication & Media")'));
 assert.ok(app.includes('active==="Communication & Media"&&<CommunicationMediaPortal'));
 assert.ok(portal.includes('if(!authorized)return'));
});

test("communications workspace supports drafts, approval, library, calendar and website publishing",()=>{
 for(const term of ["Create communications item","Content library","Editorial Calendar","Publishing Setup","Pending Approval","Approved","Returned","Media Asset","Submit for approval","Publish to website","exportDraft(\"txt\")","exportDraft(\"md\")","exportDraft(\"html\")","exportDraft(\"pdf\")"]) assert.ok(portal.includes(term),term);
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

test("media studio preserves multi-format upload, secure Drive storage, image editing and export",()=>{
 assert.ok(portal.includes('import CommunicationMediaStudio from "./CommunicationMediaStudio"'));
 assert.ok(portal.includes('{tab==="Media Studio"&&<CommunicationMediaStudio/>}'));
 for(const term of ['type="file"','uploadBytes','purpose:"Communication Media"','collection(db,"communicationMediaAssets")','downloadDriveBytes','brightness','contrast','saturation','canvas.toBlob','Export edited image','Download original']) assert.ok(studio.includes(term),term);
 assert.ok(studio.includes('MAX_BYTES=25*1024*1024'));
 assert.ok(studio.includes('status:"Available"'));
 assert.ok(studio.includes('storageProvider:"Google Drive"'));
});

test("media asset register is authenticated, size-limited, immutable and deny-by-default for edits/deletion",()=>{
 assert.ok(rules.includes('match /communicationMediaAssets/{id}'));
 assert.ok(rules.includes('request.resource.data.get("uploadedByUid","")==request.auth.uid'));
 assert.ok(rules.includes('request.resource.data.get("fileSize",0)<=26214400'));
 assert.ok(rules.includes('request.resource.data.get("storageProvider","")=="Google Drive"'));
 assert.ok(rules.includes('allow update,delete:if false;'));
});

test("media upload and download both enforce registered communications roles at the gateway",()=>{
 assert.ok(gateway.includes("async function authorizeCommunicationMediaDownload(env,claims)"));
 assert.ok(gateway.includes('purpose === "Communication Media" && !(await authorizeCommunicationMediaDownload(env, claims))'));
 assert.ok(gateway.includes('if (purpose === "Communication Media" && !(await authorizeCommunicationMediaDownload(env, claims)))'));
 assert.ok(gateway.includes("Your registered IRPA role does not permit communications media uploads."));
 assert.ok(gateway.includes("Your registered IRPA role does not permit access to the communications media archive."));
});

const readability=readFileSync(new URL("../src/styles/readability-harmony.css",import.meta.url),"utf8");

test("communication portal light cards and secondary controls retain readable foreground contrast",()=>{
 assert.match(readability,/\.communication-media-portal > section:first-child > div:nth-child\(2\) > button span[\s\S]*?color:#17372b!important/);
 assert.match(readability,/\.communication-media-portal button:not\(\[style\*="#1d4ed8"\]\)[\s\S]*?color:#17372b!important/);
 assert.match(readability,/\.communication-media-portal button\[style\*="#1d4ed8"\][\s\S]*?color:#ffffff!important/);
 assert.match(readability,/\.communication-media-portal input,[\s\S]*?color:#172033!important/);
 assert.match(readability,/\.communication-media-portal input::placeholder,[\s\S]*?color:#526176!important/);
});
