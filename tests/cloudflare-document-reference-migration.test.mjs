import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("document references use the authenticated Cloudflare Worker, without Functions or client counter fallback", async () => {
  const source = await readFile(new URL("../src/firebase/data.js", import.meta.url), "utf8");
  const start = source.indexOf("export async function nextDocumentReference()");
  const end = source.indexOf("\nexport async function ", start + 1);
  assert.notEqual(start, -1, "document reference function exists");
  assert.notEqual(end, -1, "document reference function has a clear boundary");
  const fn = source.slice(start, end);
  assert.match(fn, /user\.getIdToken\(\)/);
  assert.match(fn, /\/api\/documents\/next-reference/);
  assert.match(fn, /Authorization.*Bearer/);
  assert.doesNotMatch(fn, /httpsCallable|getFunctions|runTransaction|documentReferenceRegistry|FIRESTORE_RULES_FALLBACK/);
  assert.match(fn, /No Firebase Cloud Function or client-side counter fallback was used/);
});
