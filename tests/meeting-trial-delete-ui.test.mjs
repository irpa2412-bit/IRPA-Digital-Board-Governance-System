import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/Meetings.jsx", import.meta.url), "utf8");

test("meeting deletion is visible only for exact TRIAL environment and REAL is protected", () => {
  assert.match(source, /m\.environment==="TRIAL"/);
  assert.match(source, /m\.environment!=="TRIAL"/);
  assert.match(source, /Protected — REAL/);
});

test("deletion requires a read-only preview, offers JSON export, and collects reason and exact title", () => {
  assert.ok(source.includes('/api/meeting-register/delete-preview'));
  assert.ok(source.includes('JSON.stringify(preview.exportData,null,2)'));
  assert.ok(source.includes("preview.externalArtifactsNotice"));
  assert.ok(source.includes('Enter the written reason for deleting this TRIAL meeting'));
  assert.ok(source.includes('Type the exact meeting title to confirm deletion'));
  assert.ok(source.includes('previewDigest:preview.previewDigest'));
  assert.ok(source.includes('confirmationTitle'));
  assert.ok(source.includes('result.deleted!==true'));
});

test("the UI serializes deletion to one meeting at a time", () => {
  assert.ok(source.includes('deleteInFlightRef.current||busy'));
  assert.ok(source.includes('deleteInFlightRef.current=true'));
  assert.ok(source.includes('disabled={busy} onClick={()=>remove(m)}'));
});
