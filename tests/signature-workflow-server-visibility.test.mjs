import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../drive-gateway/src/index.js", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../src/firebase/signaturePlatform.js", import.meta.url), "utf8");
const palette = fs.readFileSync(new URL("../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");

test("envelope view and list are served through authenticated Worker routes and server-side filtering", () => {
  assert.match(worker, /pathname === "\/api\/signature-workflow\/view" && request\.method === "GET"/);
  assert.match(worker, /pathname === "\/api\/signature-workflow\/list" && request\.method === "GET"/);
  assert.match(worker, /filterSignatureEnvelopeForCaller\(envelope/);
  assert.match(client, /\/api\/signature-workflow\/view\?envelopeId=/);
  assert.match(client, /\/api\/signature-workflow\/list/);
  assert.doesNotMatch(client.slice(client.indexOf("export async function getSignatureEnvelope("), client.indexOf("export async function getMySignedDocuments(")), /getDoc\(doc\(db,ENVELOPE_COLLECTION/);
});

test("preparation palette renders placeholders and does not render saved signature or initials images", () => {
  const fieldBox = palette.slice(palette.indexOf("function FieldBox"), palette.indexOf("function PDFDesigner"));
  const preparation = palette.slice(palette.indexOf('tab==="Prepare Envelope"'), palette.indexOf('tab==="Sign Document"'));
  assert.doesNotMatch(fieldBox, /signatureSrc\?\s*<img|initialsSrc\?\s*<img/);
  assert.doesNotMatch(preparation, /alt="Saved signature"|alt="Saved initials"/);
  assert.match(fieldBox, /TYPE_LABELS\[field\.type\]/);
  assert.match(fieldBox, /recipients\.find\(r=>r\.uid===field\.signerUid\)\?\.role/);
});
