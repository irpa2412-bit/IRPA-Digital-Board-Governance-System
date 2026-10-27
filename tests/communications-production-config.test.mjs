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
test("cPanel production root is public_html and missing secrets are named",()=>{
 assert.match(source,/environment === "production" \? "public_html" : "public_html\/staging"/);
 assert.match(source,/CPANEL_BASE_URL, CPANEL_USERNAME, CPANEL_API_TOKEN/);
 assert.match(source,/CPANEL_DOCUMENT_ROOT/);
});
