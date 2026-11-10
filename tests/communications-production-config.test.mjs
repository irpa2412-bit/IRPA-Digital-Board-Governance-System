import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../drive-gateway/src/communicationsSite.mjs",import.meta.url),"utf8");
test("WordPress production is host-restricted and missing configuration returns named 503 secrets",()=>{
 assert.match(source,/environment === "production" && !\["irpa\.or\.tz", "www\.irpa\.or\.tz"\]\.includes\(host\)/);
 assert.match(source,/\["WORDPRESS_BASE_URL", "WORDPRESS_USERNAME", "WORDPRESS_APPLICATION_PASSWORD"\]/);
 assert.match(source,/status: 503/);
 assert.match(source,/function isAllowedWordPressLink\(value, wp\)/);
});
test("production publishing remains approval-gated and WordPress URLs cannot escape configured host",()=>{
 assert.match(source,/Production publishing requires the approved communication-media workflow/);
 assert.match(source,/target\.hostname\.toLowerCase\(\) !== wp\.hostname/);
});
test("cPanel production root requires the explicit live-root variable and fails closed when unset",()=>{
 assert.match(source,/environment === "production" \? env\.CPANEL_LIVE_DOCUMENT_ROOT \|\| ""/);
 assert.match(source,/cpanel_live_document_root_missing/);
 assert.match(source,/Live root not configured/);
 assert.match(source,/\["public_html", "home\/" \+ username \+ "\/public_html", "\/home\/" \+ username \+ "\/public_html"\]/);
 assert.match(source,/CPANEL_BASE_URL, CPANEL_USERNAME, CPANEL_API_TOKEN/);
 assert.match(source,/CPANEL_DOCUMENT_ROOT/);
 assert.match(source,/CPANEL_LIVE_DOCUMENT_ROOT/);
});
