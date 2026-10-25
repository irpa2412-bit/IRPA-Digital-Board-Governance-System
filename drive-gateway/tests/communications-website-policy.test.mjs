import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_WORDPRESS_MEDIA_BYTES, assertAllowedWebsiteMutation, assertStagingWebsiteHost,
  auditEntry, editorialWordPressStatus, mayPublish, redactSecrets, validateMediaUpload
} from "../src/communicationsWebsitePolicy.mjs";

test("workflow maps Draft and Review to draft and allows publish state only explicitly", () => {
  assert.equal(editorialWordPressStatus("Draft"), "draft");
  assert.equal(editorialWordPressStatus("Review"), "pending");
  assert.equal(editorialWordPressStatus("Publish"), "publish");
  assert.throws(() => editorialWordPressStatus("Delete"));
});
test("only active Communication & Media Chair or active administrator can publish", () => {
  assert.equal(mayPublish({ active: true, roles: ["Communication & Media Chair"] }), true);
  assert.equal(mayPublish({ active: true, roles: ["Communications Officer"] }), false);
  assert.equal(mayPublish({ active: false, roles: ["Communication & Media Chair"] }), false);
  assert.equal(mayPublish({ admin: true }), true);
});
test("media upload enforces extension, MIME and 10 MiB size limits", () => {
  assert.equal(validateMediaUpload({ filename: "news.jpg", contentType: "image/jpeg", size: 20 }).filename, "news.jpg");
  assert.throws(() => validateMediaUpload({ filename: "news.php", contentType: "image/jpeg", size: 20 }));
  assert.throws(() => validateMediaUpload({ filename: "news.jpg", contentType: "text/html", size: 20 }));
  assert.throws(() => validateMediaUpload({ filename: "news.jpg", contentType: "image/jpeg", size: MAX_WORDPRESS_MEDIA_BYTES + 1 }));
});
test("acceptance hostname permits only HTTPS staging root and refuses production", () => {
  assert.equal(assertStagingWebsiteHost("https://staging.irpa.or.tz/").hostname, "staging.irpa.or.tz");
  for (const url of ["https://irpa.or.tz/", "https://www.irpa.or.tz/", "https://irpa.or.tz/staging", "http://staging.irpa.or.tz/"]) {
    assert.throws(() => assertStagingWebsiteHost(url), /staging-only/);
  }
});
test("website mutation allowlist blocks plugin, theme, user and settings changes", () => {
  assert.equal(assertAllowedWebsiteMutation({ type: "pages", id: 3, title: "News", seoTitle: "News SEO" }), true);
  for (const key of ["plugin", "theme", "user", "settings"]) assert.throws(() => assertAllowedWebsiteMutation({ [key]: "change" }));
});
test("audit captures actor, action, timestamp and only approved changed field names", () => {
  const entry = auditEntry({ actorUid: "uid-1", actorEmail: "editor@example.test", action: "save_draft", objectType: "pages", objectId: "7", changedFields: ["title", "password", "seoTitle"], at: "2026-10-25T10:00:00Z" });
  assert.deepEqual(entry.changedFields, ["title", "seoTitle"]);
  assert.equal(entry.actorUid, "uid-1");
  assert.equal(entry.at, "2026-10-25T10:00:00.000Z");
});
test("secrets are redacted from diagnostic/audit strings", () => {
  const out = redactSecrets("Bearer bearer-secret WORDPRESS_APPLICATION_PASSWORD=wp-secret cPanelToken=cp-secret", ["wp-secret", "cp-secret"]);
  assert.doesNotMatch(out, /bearer-secret|wp-secret|cp-secret/);
  assert.match(out, /REDACTED/);
});

test("SEO title and meta description are allowed fields", () => { assert.equal(assertAllowedWebsiteMutation({type:"pages",id:5,title:"Title",seoTitle:"SEO",seoDescription:"Description"}),true); });
test("Review is a pending WordPress status", () => { assert.equal(editorialWordPressStatus("Review"),"pending"); });
