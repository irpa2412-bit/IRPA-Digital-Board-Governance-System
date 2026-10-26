import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const app=read("../src/App.jsx");
const portal=read("../src/pages/CommunicationMediaPortal.jsx");
const studio=read("../src/pages/CommunicationMediaStudio.jsx");
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
 for(const term of ["Create communications item","Content library","Editorial Calendar","Publishing Setup","Pending Approval","Approved","Returned","Media Asset","Submit for approval","Publish to website","exportDraft(\"txt\")","exportDraft(\"md\")","exportDraft(\"html\")","exportDraft(\"pdf\")"]) assert.ok(portal.includes(term),term);
 assert.ok(portal.includes('/api/communications/records?collection=communicationMediaItems'));
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
 assert.ok(site.includes("base.port !== \"2083\""));
 assert.ok(!site.includes("Fileman/delete_file"));
});

test("Firestore communications records remain role-scoped and protected from deletion",()=>{
 assert.ok(rules.includes("function communicationMediaUser()"));
 assert.ok(rules.includes("function communicationMediaReviewer()"));
 assert.ok(rules.includes("match /communicationMediaItems/{id}"));
 assert.ok(rules.includes("allow delete:if false;"));
 assert.ok(rules.includes('request.resource.data.get("status","")=="Draft"'));
 assert.ok(rules.includes('request.resource.data.get("status","") in ["Approved","Returned"]'));
});

test("media studio keeps uploads on authenticated Google Drive gateway, not Firebase Storage",()=>{
 assert.ok(portal.includes('import CommunicationMediaStudio from "./CommunicationMediaStudio"'));
 assert.ok(portal.includes('{tab==="Media Studio"&&<CommunicationMediaStudio/>}'));
 for(const term of ['type="file"','uploadBytes','purpose:"Communication Media"','collection(db,"communicationMediaAssets")','downloadDriveBytes','brightness','contrast','saturation','canvas.toBlob','Export edited image','Download original']) assert.ok(studio.includes(term),term);
 assert.ok(studio.includes("MAX_BYTES=25*1024*1024"));
 assert.ok(studio.includes('storageProvider:"Google Drive"'));
 assert.ok(rules.includes('request.resource.data.get("storageProvider","")=="Google Drive"'));
});

test("deployment docs require isolated staging and never commit credentials",()=>{
 assert.ok(docs.includes("Cloudflare Worker secrets"));
 assert.ok(docs.includes("CPANEL_API_TOKEN"));
 assert.ok(docs.includes("deploy and live-verify only after staging acceptance"));
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

test("website page editing is staging-host-only, Communication & Media scoped, revision-backed and secret-safe",()=>{
 assert.ok(site.includes('String(env.IRPA_ENVIRONMENT || "").toLowerCase() !== "staging"'));
 assert.ok(site.includes('base.hostname.toLowerCase() !== "staging.irpa.or.tz"'));
 assert.ok(site.includes('redirect: "manual"'));
 assert.ok(site.includes("WEBSITE_EDITOR_ROLES"));
 assert.ok(site.includes("COMMUNICATION_WEBSITE_EDIT_SNAPSHOT_SAVED"));
 assert.ok(site.includes("COMMUNICATION_WEBSITE_CONTENT_UPDATED"));
 assert.ok(site.includes("snapshotId"));
 assert.ok(site.includes("featured_media"));
 assert.ok(site.includes('["draft", "publish"]'));
 assert.ok(!site.includes("console.log(WORDPRESS_APPLICATION_PASSWORD"));
 assert.ok(!portal.includes("WORDPRESS_APPLICATION_PASSWORD"));
 assert.ok(!portal.includes("process.env.CPANEL_API_TOKEN"));
 assert.ok(!/CPANEL_API_TOKEN\s*[:=]\s*["'][^"']+["']/.test(portal));
});


test("communications operations registers provide campaigns, media contacts, brand resources, crisis plans and coverage logs",()=>{
 for(const term of ['Campaign','Media Contact','Brand Asset','Crisis Plan','Coverage Log','startDate','contactName','rights','holdingStatement','sourceUrl','observedDate']) assert.ok(operations.includes(term),term);
 assert.ok(portal.includes('import CommunicationMediaOperations from "./CommunicationMediaOperations"'));
 assert.ok(portal.includes('tab==="Communications Operations"&&<CommunicationMediaOperations'));
 assert.ok(operations.includes('writeBatch(db)'));
 assert.ok(operations.includes('collection(db,"communicationOperationsAudit")'));
 assert.ok(operations.includes('limit(50)'));
 assert.ok(operations.includes("Communications audit history"));
 assert.ok(operations.includes('No records are deleted'));
 assert.ok(rules.includes('match /communicationOperations/{id}'));
 assert.ok(rules.includes('match /communicationOperationsAudit/{id}'));
 assert.ok(rules.includes('allow delete:if false;'));
 assert.ok(rules.includes('allow update,delete:if false;'));
 assert.ok(rules.includes('"Crisis Plan"'));
 assert.ok(rules.includes('request.resource.data.get("actorUid","")==request.auth.uid'));
 assert.ok(rules.includes('existsAfter(/databases/$(database)/documents/communicationOperations/$(request.resource.data.recordId))'));
 assert.ok(rules.includes('request.resource.data.get("actorEmail","")==request.auth.token.get("email","")'));
 assert.ok(rules.includes('function communicationMediaUser(){return admin()||anyInstitutionalRole(["Communication & Media"'));
 assert.ok(rules.includes('resource.data.get("status","")=="Draft"&&request.resource.data.get("status","") in ["Under Review","Approved","Archived"]'));
 assert.ok(rules.includes('resource.data.get("status","")=="Completed"&&request.resource.data.get("status","")=="Archived"'));
});


test("social account enrolment is integrated, metadata-only, role-scoped and audited",()=>{
 assert.ok(portal.includes('import SocialMediaAccounts from "./SocialMediaAccounts"'));
 assert.ok(portal.includes('"Social Accounts"'));
 assert.ok(portal.includes('tab==="Social Accounts"&&<SocialMediaAccounts'));
 for(const term of ['Facebook','Instagram','LinkedIn','YouTube','TikTok','Pending Verification','authorizationReference','custodian','reviewDate','writeBatch(db)','socialMediaAccountsAudit','noopener noreferrer','does not publish posts']) assert.ok(social.includes(term),term);
 assert.ok(!social.includes('accessToken'));
 assert.ok(!social.includes('clientSecret'));
 assert.ok(!/\bpassword\s*[:=]/i.test(social));
 assert.ok(rules.includes('match /socialMediaAccounts/{id}'));
 assert.ok(rules.includes('match /socialMediaAccountsAudit/{id}'));
 assert.ok(rules.includes('data.keys().hasOnly(["platform","accountName","handle","profileUrl"'));
 assert.ok(rules.includes('allow update,delete:if false;'));
 assert.ok(rules.includes('getAfter(/databases/$(database)/documents/socialMediaAccounts/$(request.resource.data.recordId))'));
 assert.ok(rules.includes('"Pending Verification","Active","Suspended","Disconnected","Archived"'));
});


test("social-account enrolment always displays accessible success and failure feedback, including custom required-field validation",()=>{
 assert.ok(social.includes('onSubmit={save} noValidate'));
 assert.ok(social.includes('role="alert" aria-live="assertive"'));
 assert.ok(social.includes('role="status" aria-live="polite"'));
 assert.ok(social.includes("Enter the account or page name."));
 assert.ok(social.includes("Assign a responsible officer."));
 assert.ok(social.includes("Social-media account enrolled and audit recorded."));
 assert.ok(social.includes("Unable to save the account record."));
});

test("Meta API uses the existing staging-only OAuth router, minimal read permissions, encrypted tokens and no publishing",()=>{
 assert.ok(social.includes("metaStagingEnabled"));
 assert.ok(social.includes("/api/communications/meta/connect"));
 assert.ok(social.includes("/api/communications/meta/status"));
 assert.ok(social.includes("/api/communications/meta/disconnect"));
 assert.ok(social.includes("Posting enabled: No"));
 assert.ok(metaOAuth.includes('env?.IRPA_ENVIRONMENT !== "staging"'));
 assert.ok(metaOAuth.includes('FIREBASE_PROJECT_ID !== STAGING_PROJECT'));
 assert.ok(metaOAuth.includes('IRPA_PRODUCTION_CUTOVER !== "false"'));
 assert.ok(metaOAuth.includes('META_TOKEN_ENCRYPTION_KEY'));
 assert.ok(metaOAuth.includes('meta:readonly:oauth-state:'));
 assert.ok(metaOAuth.includes('await env.DRIVE_KV.delete(stateKey)'));
 assert.ok(metaOAuth.includes('"pages_show_list", "pages_read_engagement", "instagram_basic"'));
 assert.ok(metaOAuth.includes('postingEnabled: false'));
 assert.ok(!metaOAuth.includes('instagram_content_publish'));
 assert.ok(!metaOAuth.includes('pages_manage_posts'));
 assert.ok(metaOAuth.includes('/api/communications/meta/disconnect'));
 assert.ok(gateway.includes('import { createMetaOAuthRouter } from "./metaOAuth.mjs"'));
 assert.ok(gateway.includes('const metaOAuthRouter = createMetaOAuthRouter'));
 assert.ok(gateway.includes('const metaResponse = await metaOAuthRouter(request, env)'));
 assert.ok(docs.includes("Meta (Facebook and Instagram) API — staging-only connection and access verification"));
 assert.ok(stagingWorkflow.includes("STAGING_META_APP_ID"));
 assert.ok(stagingWorkflow.includes("STAGING_META_APP_SECRET"));
 assert.ok(stagingWorkflow.includes("STAGING_META_TOKEN_ENCRYPTION_KEY"));
 assert.ok(stagingWorkflow.includes("META_OAUTH_CONFIGURATION_SHAPE=VALID"));
 assert.ok(stagingWorkflow.includes('IRPA_PRODUCTION_CUTOVER:"false"'));
 assert.ok(stagingWorkflow.includes("STAGING_COMMUNICATION_MEDIA_ARCHIVE_PROVISION=PASS"));
 assert.ok(stagingWorkflow.includes("STAGING_CONTROLLED_PDF_UPLOAD=PASS"));
 assert.ok(stagingWorkflow.includes("firestore-rules-approved"));
 assert.ok(stagingWorkflow.includes("refusing to configure Worker secrets"));
});

test("communication portal light cards and secondary controls retain readable foreground contrast",()=>{
 assert.match(readability,/\.communication-media-portal > section:first-child > div:nth-child\(2\) > button span[\s\S]*?color:#17372b!important/);
 assert.match(readability,/\.communication-media-portal button:not\(\[style\*="#1d4ed8"\]\)[\s\S]*?color:#17372b!important/);
 assert.match(readability,/\.communication-media-portal button\[style\*="#1d4ed8"\][\s\S]*?color:#ffffff!important/);
 assert.match(readability,/\.communication-media-portal input,[\s\S]*?color:#172033!important/);
 assert.match(readability,/\.communication-media-portal input::placeholder,[\s\S]*?color:#526176!important/);
});

test("media studio upload size matches the gateway enforced maximum and labels staging records correctly",()=>{
 assert.ok(studio.includes("MAX_BYTES=25*1024*1024"));
 assert.ok(gateway.includes('purpose === "Communication Media" ? 25 * 1024 * 1024'));
 assert.ok(studio.includes('recordOrigin:auth.app?.options?.projectId === "irpa-dbg-staging-a73ec" ? "STAGING" : "PRODUCTION"'));
});

test("media asset register is authenticated, size-limited, immutable and deny-by-default for edits/deletion",()=>{
 assert.ok(rules.includes('match /communicationMediaAssets/{id}'));
 assert.ok(rules.includes('request.resource.data.get("uploadedByUid","")==request.auth.uid'));
 assert.ok(rules.includes('request.resource.data.get("fileSize",0)<=26214400'));
 assert.ok(rules.includes('request.resource.data.get("storageProvider","")=="Google Drive"'));
 assert.ok(rules.includes('allow update,delete:if false;'));
});

test("media asset and item record origins are restricted to the authenticated Firebase project",()=>{
 assert.ok(rules.includes('function communicationMediaRecordOriginMatches(data)'));
 assert.ok(rules.includes('request.auth.token.get("aud","")=="irpa-dbg-staging-a73ec"'));
 assert.equal(rules.split("communicationMediaRecordOriginMatches(request.resource.data)").length-1,2);
});

test("staging gateway is isolated from production Firebase, app URL and Drive archive root",()=>{
 const staging=wrangler.slice(wrangler.indexOf("[env.staging.vars]"));
 assert.ok(staging.includes('FIREBASE_PROJECT_ID = "irpa-dbg-staging-a73ec"'));
 assert.ok(staging.includes('IRPA_APP_URL = "https://irpa-dbg-staging-a73ec.web.app"'));
 assert.ok(staging.includes('DRIVE_ROOT_FOLDER_NAME = "IRPA Governance System - STAGING"'));
 assert.ok(gateway.includes("function getDriveRootFolderName(env)"));
 assert.ok(gateway.includes('env?.IRPA_ENVIRONMENT === "staging" ? "IRPA Governance System - STAGING"'));
});

test("Communication and Media Archive is provisioned and verified before media upload",()=>{
 assert.ok(studio.includes("provisionCommunicationMediaArchive"));
 assert.ok(studio.includes("folderId:archive.folderId"));
 assert.ok(studio.includes("archive.archivePath"));
 assert.ok(gateway.includes('pathname === "/api/communication-media-archive/provision"'));
 assert.ok(gateway.includes('"Communication and Media Archive"'));
 assert.ok(gateway.includes('irpaCommunicationMediaArchive:true'));
 assert.ok(gateway.includes('folderDescription.irpaCommunicationMediaArchive !== true'));
 assert.ok(gateway.includes('purpose === "Communication Media" && !requestedFolderId'));
 assert.ok(gateway.includes('code:"GOOGLE_DRIVE_NOT_AUTHORIZED"'));
 assert.ok(gateway.includes('https://irpa-dbg-staging-a73ec.web.app'));
 assert.ok(gateway.includes('https://irpa-dbg-staging-a73ec.firebaseapp.com'));
 assert.ok(gateway.includes('},503,corsHeaders(request))'));
});

test("media upload and download both enforce registered communications roles at the gateway",()=>{
 assert.ok(gateway.includes("async function authorizeCommunicationMediaDownload(env,claims)"));
 assert.ok(gateway.includes('purpose === "Communication Media" && !(await authorizeCommunicationMediaDownload(env, claims))'));
 assert.ok(gateway.includes('if (purpose === "Communication Media" && !(await authorizeCommunicationMediaDownload(env, claims)))'));
 assert.ok(gateway.includes("Your registered IRPA role does not permit communications media uploads."));
 assert.ok(gateway.includes("Your registered IRPA role does not permit access to the communications media archive."));
});

test("communication media asset registration uses an authenticated Worker write instead of direct browser Firestore writes",()=>{
 assert.ok(site.includes('path === "/api/communications/records" && request.method === "POST"'));
 assert.ok(site.includes('action === "register-media-asset"'));
 assert.ok(site.includes('collectionName === "communicationMediaAssets"'));
 assert.ok(studio.includes('"/api/communications/records"'));
 assert.ok(!studio.includes('addDoc(collection(db,"communicationMediaAssets")'));
 assert.ok(gateway.includes('collectionName="documents"'));
 assert.ok(gateway.includes('"communicationMediaAssets"'));
});

test("communications draft and approval writes are Worker-routed and approval is independent",()=>{
 assert.ok(portal.includes('collection:"communicationMediaItems",action:selected?"update":"create"'));
 assert.ok(portal.includes('action:"submit"'));
 assert.ok(portal.includes('action:status==="Approved"?"approve":"return"'));
 assert.ok(site.includes('existing.createdByUid === claims.user_id'));
 assert.ok(site.includes('Only items awaiting approval can be approved or returned.'));
 assert.ok(site.includes('The author cannot approve their own public item.'));
 assert.ok(site.includes('commitDocumentAndAudit(env, id, claims.token'));
});

test("social media studio provides a manual export fallback and funding view without claiming live API publishing",()=>{
 for(const term of ["Social Media Studio","Facebook","Instagram","LinkedIn","YouTube","WhatsApp Channel","exportSocialPost","Export ready-to-paste TXT","Use funder update template","Use donor thank-you template","Use project story template","Funding View","Platform reach and engagement are unavailable","Not connected in production"]) assert.ok(portal.includes(term),term);
 assert.ok(portal.includes('collection:"communicationMediaItems",action:"create"'));
});


test("website studio supports bilingual page drafts, approval-gated publishing, and portal route self-test",()=>{
 for(const term of ["Website Studio","English","Kiswahili","Home","About","Programmes","Projects","Impact","Partners","Funding and Reports","News","Contact","MOBILE PREVIEW","Portal Self-Test","Run Portal Self-Test"]) assert.ok(portal.includes(term),term);
 assert.ok(site.includes('["Website Article", "Press Release", "Website Page"].includes(item.type)'));
 assert.ok(site.includes('const endpoint = wp.root + "/wp-json/wp/v2/" + (isPage ? "pages" : "posts")'));
 assert.ok(site.includes('item.status !== "Approved"'));
});

test("production Worker deployments stamp and verify the exact deployed commit",()=>{
 const gatewayDeploy=read("../.github/workflows/cloudflare-gateway-deploy.yml");
 const dispatchDeploy=read("../.github/workflows/cloudflare-production-gateway.yml");
 assert.ok(gatewayDeploy.includes("--var GIT_SHA:${{ github.sha }}"));
 assert.ok(gatewayDeploy.includes("h.commit!==process.env.GITHUB_SHA"));
 assert.ok(dispatchDeploy.includes('--var "GIT_SHA:${GIT_SHA}"'));
 assert.ok(dispatchDeploy.includes("health.commit !== process.env.GIT_SHA"));
});

test("public HTML and Settings show the exact web and Worker build stamps",()=>{
 const html=read("../index.html");
 const settings=read("../src/pages/Settings.jsx");
 const firebaseDeploy=read("../.github/workflows/firebase-cli-deploy.yml");
 const pagesDeploy=read("../.github/workflows/cloudflare-pages-deploy.yml");
 assert.ok(html.includes('content="%VITE_BUILD_COMMIT%"'));
 assert.ok(html.includes('content="%VITE_BUILD_TIME%"'));
 assert.ok(settings.includes('String(import.meta.env.VITE_BUILD_COMMIT || "unavailable")'));
 assert.ok(settings.includes('String(workerHealth?.commit || workerHealth?.version || "unavailable")'));
 assert.ok(firebaseDeploy.includes("VITE_BUILD_COMMIT: ${{ github.sha }}"));
 assert.ok(pagesDeploy.includes('grep -Fq "content=\\"$GITHUB_SHA\\"" dist/index.html'));
});
