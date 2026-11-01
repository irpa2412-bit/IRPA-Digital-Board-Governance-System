import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const app=read("../src/App.jsx");
const portal=read("../src/pages/CommunicationMediaPortal.jsx");
const studio=read("../src/pages/CommunicationMediaStudio.jsx");
const websiteStudio=read("../src/pages/CommunicationsWebsiteStudio.jsx");
const operations=read("../src/pages/CommunicationMediaOperations.jsx");
const social=read("../src/pages/SocialMediaAccounts.jsx");
const metaOAuth=read("../drive-gateway/src/metaOAuth.mjs");
const stagingWorkflow=read("../.github/workflows/staging-gateway-e2e.yml");
const rules=read("../firestore.rules");
const gateway=read("../drive-gateway/src/index.js");
const wrangler=read("../drive-gateway/wrangler.toml");
const site=read("../drive-gateway/src/communicationsSite.mjs");
const functionsIndex=read("../functions/index.js");
const docs=read("../docs/COMMUNICATION_MEDIA_PORTAL.md");
const readability=read("../src/styles/readability-harmony.css");

test("communications portal stays integrated in the existing app with role-based navigation",()=>{
 assert.ok(app.includes('import CommunicationMediaPortal from "./pages/CommunicationMediaPortal"'));
 assert.ok(app.includes('COMMUNICATIONS:["Communication & Media"]'));
 assert.ok(app.includes('if(COMMUNICATIONS_ROLES.includes(selected))m.push("Communication & Media")'));
 assert.ok(app.includes('active==="Communication & Media"&&<CommunicationMediaPortal'));
 assert.ok(portal.includes("if(!authorized)return"));
});

test("communications authoring, approvals, library, calendar and exports remain available",()=>{
 for(const term of ["Create communications item","Content library","Editorial Calendar","Publishing Setup","Pending Approval","Approved","Returned","Media Asset","Submit for approval","Publish to website",'exportDraft("txt")','exportDraft("md")','exportDraft("html")','exportDraft("pdf")']) assert.ok(portal.includes(term),term);
 assert.ok(portal.includes('/api/communications/records?collection=communicationMediaItems'));
 assert.ok(portal.includes("await refreshItems();setNotice(selected?\"Draft updated through the Worker.\":\"Draft saved through the Worker.\");reset();setTab(\"Library\")'),"saved drafts must refresh and open the library");
 assert.ok(portal.includes("Refresh library"),"the library must have a manual refresh control");
 assert.ok(portal.includes("WordPress connection status is checked in Publishing Setup."),"WordPress status guidance must not falsely imply secrets are missing");
 assert.ok(!portal.includes("<span>Publishing requires server-side WordPress secrets.</span>"));
 assert.ok(portal.includes('window.confirm("Publish this approved item to the live IRPA website now?'));
});

test("publishing, website content edits and cPanel file edits route through Cloudflare",()=>{
 for(const route of ["/api/communications/site/status","/api/communications/website/publish","/api/communications/website/content","/api/communications/website/revisions","/api/communications/website/restore","/api/communications/cpanel/files"]) assert.ok(site.includes(route),route);
 assert.ok(site.includes("singleContentMatch"));
 assert.ok(site.includes("saveWebsiteSnapshot"));
 assert.ok(site.includes("currentRevisionId"));
 assert.ok(site.includes("COMMUNICATION_WEBSITE_REVISION_RESTORED"));
 assert.ok(gateway.includes('import { createCommunicationsSiteRouter } from "./communicationsSite.mjs"'));
 assert.ok(gateway.includes('pathname.startsWith("/api/communications/")'));
 assert.ok(portal.includes('fetch(GATEWAY+path'));
 assert.ok(portal.includes('gatewayRequest("/api/communications/website/publish"'));
 assert.ok(!portal.includes("firebase/functions"));
 assert.ok(!functionsIndex.includes("publishCommunicationMediaItem"));
 assert.ok(!existsSync(new URL("../functions/communicationMedia.js",import.meta.url)));
});

test("Website Studio creates draft-only posts and securely uploads multiple WordPress article images",()=>{
 assert.ok(site.includes('path === "/api/communications/website/posts" && request.method === "POST"'));
 assert.ok(site.includes('path === "/api/communications/website/media" && request.method === "POST"'));
 assert.ok(site.includes("validateWebsiteMedia"));
 assert.ok(site.includes("5 * 1024 * 1024"));
 assert.ok(site.includes("sanitizeWebsiteSvg"));
 assert.ok(site.includes("websiteMediaSha256"));
 assert.ok(site.includes("COMMUNICATION_WEBSITE_MEDIA_UPLOADED"),"media upload audit action must match the gateway's actual audit event");
 assert.ok(site.includes("COMMUNICATION_WEBSITE_POST_DRAFT_CREATED"));
 assert.ok(site.includes('status: "draft"'));
 assert.ok(site.includes("publication status is controlled by the server"));
 assert.ok(site.includes('path === "/api/communications/website/taxonomies" && request.method === "GET"'));
 assert.ok(websiteStudio.includes('call("/api/communications/website/posts","POST"'));
 assert.ok(websiteStudio.includes('call("/api/communications/website/media","POST"'));
 assert.ok(websiteStudio.includes('multiple accept="image/jpeg,image/png,image/webp"'));
 assert.ok(websiteStudio.includes("Required descriptive alt text"));
 assert.ok(websiteStudio.includes("Optional image caption"));
 assert.ok(websiteStudio.includes("Phone preview"));
 assert.ok(websiteStudio.includes("uploadProgress.map"));
 assert.ok(websiteStudio.includes("Rejected · empty file"));
 assert.ok(site.includes("WORDPRESS_MEDIA_MAX_BYTES"));
 assert.ok(site.includes("20 * 1024 * 1024"));
 assert.ok(websiteStudio.includes("Image batch complete:"));
 assert.ok(websiteStudio.includes("Uploaded"));
 assert.ok(websiteStudio.includes("Create WordPress draft"));
});

test("WordPress and cPanel status badges automatically check and fail visibly without stale neutral status",()=>{
 assert.ok(portal.includes('if(tab==="Publishing Setup"&&websiteEditor&&!siteBusy)'));
 assert.ok(portal.includes('void checkWebsiteConnections()'));
 assert.ok(portal.includes('setWebsiteStatus({website:"check_failed",cpanel:"check_failed"'));
 assert.ok(portal.includes('setConnectionCheckedAt(checkedAt)'));
 assert.ok(portal.includes('const connections=data?.connections'));
 assert.ok(portal.includes('["connected","ok","healthy","available","success"].includes(value)'));
 assert.ok(portal.includes('aria-live="polite"'));
 assert.ok(portal.includes('Check staging website connection'));
});

test("website publishing enforces Firebase authentication, registered reviewer role, approval and HTTPS",()=>{
 assert.ok(site.includes("authenticateFirebaseRequest"));
 assert.ok(site.includes('getFirestoreDocument(env, "adminProfiles/" + claims.user_id, claims.token)'));
 assert.ok(site.includes("const activeAdmin = adminProfile?.active === true"));
 assert.ok(site.includes("await authorised(request, env, true)"));
 assert.ok(site.includes('item.status !== "Approved"'));
 assert.ok(site.includes('base.protocol !== "https:"'));
 assert.ok(site.includes('status: "publish"'));
 assert.ok(site.includes("COMMUNICATION_MEDIA_PUBLISHED"));
 assert.ok(site.includes("WORDPRESS_APPLICATION_PASSWORD"));
 assert.ok(!portal.includes("WORDPRESS_APPLICATION_PASSWORD"));
 assert.ok(!portal.includes("process.env.CPANEL_API_TOKEN"));
 assert.ok(!/CPANEL_API_TOKEN\s*[:=]\s*["'][^"']+["']/.test(portal));
 assert.ok(portal.includes("configured securely by an authorised administrator"));
});

test("cPanel access is secret-backed and static-file editor denies executable or traversal paths",()=>{
 for(const secret of ["CPANEL_BASE_URL","CPANEL_USERNAME","CPANEL_API_TOKEN"]) assert.ok(site.includes(secret),secret);
 assert.ok(site.includes('new Set([".html", ".htm", ".css", ".txt", ".json"])'));
 assert.ok(site.includes('p === ".."'));
 assert.ok(site.includes("safeCpanelDirectory"));
 assert.ok(site.includes("Fileman/list_files"));
 assert.ok(site.includes('url.searchParams.get("path")'));
 assert.ok(site.includes("The selected website file could not be read."));
 assert.ok(site.includes("Fileman/get_file_content"));
 assert.ok(site.includes("Fileman/save_file_content"));
 assert.ok(site.includes("/api/communications/cpanel/rollback"));
 assert.ok(site.includes("rollbackBackupId"));
 assert.ok(site.includes("expirationTtl: 604800"));
 assert.ok(site.includes("CPANEL_STATIC_FILE_EDITED"));
 assert.ok(site.includes("MAX_EDIT_BYTES = 512 * 1024"));
 assert.ok(site.includes("function sanitizeWordPressContent(value)"));
 assert.ok(site.includes("const allowedTags = new Set"));
 assert.ok(site.includes("const allowedUrl = /^https:\\/\\//.test(decoded)"));
 assert.ok(site.includes("noopener noreferrer"));
 assert.ok(site.includes('base.port !== "2083"'));
 assert.ok(site.includes('environment === "production" ? ["public_html", "home/" + username + "/public_html", "/home/" + username + "/public_html"]'));
 assert.ok(!site.includes("Fileman/delete_file"));
});

test("Firestore communications records remain role-scoped and protected from deletion",()=>{
 assert.ok(rules.includes("function communicationMediaUser()"));
 assert.ok(rules.includes("function communicationMediaReviewer()"));
 assert.ok(rules.includes("match /communicationMediaItems/{id}"));
 assert.ok(rules.includes("allow delete:if false;"));
 assert.ok(rules.includes('request.resource.data.get("status","")==="Draft"'));
 assert.ok(rules.includes('request.resource.data.get("status","") in ["Approved","Returned"]'));
});

test("media studio keeps uploads on authenticated Google Drive gateway, not Firebase Storage",()=>{
 assert.ok(portal.includes('import CommunicationMediaStudio from "./CommunicationMediaStudio"'));
 assert.ok(portal.includes('{tab==="Media Studio"&&<CommunicationMediaStudio/>}'));
 for(const term of ['type="file"','uploadBytes','purpose:"Communication Media"','collection(db,"communicationMediaAssets")','downloadDriveBytes','brightness','contrast','saturation','canvas.toBlob','Export edited image','Download original']) assert.ok(studio.includes(term),term);
 assert.ok(studio.includes("MAX_BYTES=25*1024*1024"));
 assert.ok(studio.includes('storageProvider:"Google Drive"'));
 assert.ok(rules.includes('request.resource.data.get("storageProvider","")==="Google Drive"'));
});

test("deployment docs require isolated staging and never commit credentials",()=>{
 assert.ok(docs.includes("Cloudflare Worker secrets"));
 assert.ok(docs.includes("CPANEL_API_TOKEN"));
 assert.ok(docs.includes("Staging acceptance is a pre-release safety check, not the operational destination."));
 assert.ok(docs.includes("Production is the intended operational WordPress destination."));
 assert.ok(docs.includes("Firebase Storage remains deny-by-default"));
});

test("website editor provides a sandboxed live preview without bypassing live-write controls",()=>{
 assert.ok(portal.includes("websitePreview"));
 assert.ok(portal.includes('title="IRPA staging website content preview"'));
 assert.ok(portal.includes('sandbox=""'));
 assert.ok(portal.includes('referrerPolicy="no-referrer"'));
 assert.ok(portal.includes("Save draft"));
 assert.ok(portal.includes("Publish"));
 assert.ok(portal.includes("websiteRevisions"));
 assert.ok(portal.includes("Restore"));
 assert.ok(docs.includes("Supported document and media upload formats"));
 assert.ok(docs.includes("current browser route"));
 assert.ok(docs.includes("does not edit PHP"));
});

test("website page editing is host-restricted for staging and production, Communication & Media scoped, revision-backed and secret-safe",()=>{
 assert.ok(site.includes('environment === "staging" && host !== "staging.irpa.or.tz"'));
 assert.ok(site.includes('environment === "production" && !["irpa.or.tz", "www.irpa.or.tz"].includes(host)'));
 assert.ok(site.includes('Production publishing requires the approved communication-media workflow'));
 assert.ok(site.includes('WORDPRESS_BASE_URL", "WORDPRESS_USERNAME", "WORDPRESS_APPLICATION_PASSWORD'));
 assert.ok(site.includes('redirect: "manual"'));
 assert.ok(site.includes("WEBSITE_EDITOR_ROLES"));
 assert.ok(site.includes("COMMUNICATION_WEBSITE_EDIT_SNAPSHOT_SAVED"));
 assert.ok(site.includes("COMMUNICATION_WEBSITE_CONTENT_UPDATED"));
 assert.ok(site.includes("snapshotId"));
 assert.ok(site.includes("featured_media"));
});
