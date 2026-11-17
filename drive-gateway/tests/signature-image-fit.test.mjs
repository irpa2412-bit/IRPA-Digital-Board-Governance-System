import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName } from "pdf-lib";
import { fitSignatureImage } from "../../src/utils/signatureImageFit.mjs";
import { findSignatureInkBounds, requireSignatureInkBounds } from "../../src/utils/signatureImageCanvas.mjs";
import { buildSignedPdf, getPdfFieldBox, getSignatureDrawGeometry } from "../src/pdf.mjs";

function close(actual, expected, epsilon = 0.01) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test("fit preserves a tall signature in a wide box", () => {
  const fit = fitSignatureImage(100, 300, { x: 0, y: 0, width: 400, height: 100 });
  close(fit.width, 100 / 3);
  close(fit.height, 100);
  close(fit.width / fit.height, 1 / 3);
});

test("fit preserves a wide signature in a tall box", () => {
  const fit = fitSignatureImage(300, 100, { x: 0, y: 0, width: 100, height: 400 });
  close(fit.width, 100);
  close(fit.height, 100 / 3);
  close(fit.width / fit.height, 3);
});

test("fit handles a tiny field without upscaling", () => {
  const fit = fitSignatureImage(300, 100, { x: 4, y: 8, width: 5, height: 2 });
  close(fit.width, 5);
  close(fit.height, 5 / 3);
  assert.ok(fit.scale < 1);
});

test("fit handles an exact-size field", () => {
  const fit = fitSignatureImage(300, 100, { x: 10, y: 20, width: 300, height: 100 });
  assert.deepEqual(fit, { x: 10, y: 20, width: 300, height: 100, scale: 1 });
});

test("fit refuses zero or invalid dimensions", () => {
  assert.throws(() => fitSignatureImage(0, 100, { x: 0, y: 0, width: 200, height: 200 }), RangeError);
  assert.throws(() => fitSignatureImage(300, 100, { x: 0, y: 0, width: 0, height: 200 }), RangeError);
});

test("ink trimming finds the tight bounds and adds fixed padding", () => {
  const width = 10, height = 8;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba[index * 4] = 255; rgba[index * 4 + 1] = 255; rgba[index * 4 + 2] = 255; rgba[index * 4 + 3] = 255;
  }
  for (let y = 2; y <= 4; y += 1) for (let x = 4; x <= 5; x += 1) {
    const index = (y * width + x) * 4;
    rgba[index] = 10; rgba[index + 1] = 20; rgba[index + 2] = 30; rgba[index + 3] = 255;
  }
  assert.deepEqual(findSignatureInkBounds(rgba, width, height, 2), { x: 2, y: 0, width: 6, height: 7 });
});

test("ink trimming refuses an empty or white-only pad", () => {
  const rgba = new Uint8ClampedArray(10 * 8 * 4);
  for (let index = 0; index < 80; index += 1) {
    rgba[index * 4] = 255; rgba[index * 4 + 1] = 255; rgba[index * 4 + 2] = 255; rgba[index * 4 + 3] = 255;
  }
  assert.equal(findSignatureInkBounds(rgba, 10, 8, 4), null);
  assert.throws(() => requireSignatureInkBounds(rgba, 10, 8, 4), /pad is empty/);
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function createPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      rows[offset] = 20; rows[offset + 1] = 30; rows[offset + 2] = 40; rows[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}
function makeField(fieldId, type, x, y, width, height) {
  return { fieldId, type, page: 1, x, y, width, height, signerId: "S1", signerUid: "user-1" };
}

test("PDF finalizer embeds 300x100 signatures and initials without distortion in wide and tall boxes", async () => {
  const source = await PDFDocument.create();
  source.addPage([1200, 1000]);
  const sourceBytes = await source.save();
  const pngBytes = createPng(300, 100);
  const dataUrl = "data:image/png;base64," + pngBytes.toString("base64");
  const fields = [
    makeField("signature-square", "Signature", 0, 0, 100 / 6, 20),
    makeField("signature-wide", "Signature", 50, 0, 100 / 3, 4),
    makeField("initials-square", "Initials", 0, 30, 100 / 6, 20),
    makeField("initials-wide", "Initials", 50, 30, 100 / 3, 4)
  ];
  const fieldValues = Object.fromEntries(fields.map(field => [field.fieldId, dataUrl]));
  const result = await buildSignedPdf(sourceBytes, {
    envelopeId: "envelope-1", documentId: "document-1", title: "Test",
    originalHash: "original", chainHead: "chain", completedAt: new Date(0).toISOString(),
    fields,
    signers: [{ id: "S1", uid: "user-1", name: "Signer", email: "signer@example.test", signedAt: new Date(0).toISOString(), signatureType: "drawn", signatureValue: dataUrl, fieldValues }]
  });
  const completed = await PDFDocument.load(result);
  assert.equal(completed.getPageCount(), 2);
  const page = completed.getPages()[0];
  const xObjects = page.node.Resources().lookup(PDFName.of("XObject"));
  assert.ok(xObjects, "PDF page must contain embedded signature image resources");
  const imageObjects = xObjects.entries().map(([, ref]) => completed.context.lookup(ref)).filter(object => {
    const subtype = object?.dict?.lookup?.(PDFName.of("Subtype"));
    return subtype?.toString?.() === "/Image";
  });
  assert.ok(imageObjects.some(object => object.dict.lookup(PDFName.of("Width")).asNumber() === 300 &&
    object.dict.lookup(PDFName.of("Height")).asNumber() === 100), "the original 300x100 PNG must remain embedded at its natural pixel dimensions");

  for (const field of fields) {
    const box = getPdfFieldBox(page, field);
    const drawn = getSignatureDrawGeometry(300, 100, box);
    close(drawn.width / drawn.height, 3);
    assert.ok(drawn.x >= box.x - 0.01 && drawn.y >= box.y - 0.01);
    assert.ok(drawn.x + drawn.width <= box.x + box.width + 0.01);
    assert.ok(drawn.y + drawn.height <= box.y + box.height + 0.01);
  }
});

test("PDF field geometry respects a non-zero crop box and 90-degree page rotation", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([1200, 1000]);
  page.setCropBox(20, 30, 1000, 800);
  page.setRotation({ angle: 90 });
  const box = getPdfFieldBox(page, { x: 10, y: 20, width: 30, height: 10 });
  assert.ok(box.x >= 20 && box.y >= 30);
  assert.ok(box.x + box.width <= 1020);
  assert.ok(box.y + box.height <= 830);
  const geometry = getSignatureDrawGeometry(300, 100, box);
  close(geometry.width / geometry.height, 1 / 3);
});
