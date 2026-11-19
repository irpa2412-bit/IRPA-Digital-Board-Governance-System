import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFPage, degrees } from "pdf-lib";
import { fitSignatureImage } from "../../src/utils/signatureImageFit.mjs";
import { findSignatureInkBounds, requireSignatureInkBounds, removeWhitePixels } from "../../src/utils/signatureImageCanvas.mjs";
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
  assert.throws(() => fitSignatureImage(300, 100, { x: 0, y: 0, width: 0, height: 200 }), RangeError);
  assert.throws(() => fitSignatureImage(300, 100, { x: 0, y: 0, width: 200, height: 0 }), RangeError);
  assert.throws(() => fitSignatureImage(300, 100, { x: 0, y: 0, width: 0, height: 200 }), RangeError);
});


test("short flat strokes, a single dot, and tall vertical strokes retain minimum nonzero crops and proportional fits", () => {
  const cases = [
    { name: "short flat horizontal stroke", points: [[30, 20], [34, 20]], expectedRatio: 5 },
    { name: "single dot", points: [[32, 20]], expectedRatio: 1 },
    { name: "tall vertical stroke", points: [[32, 8], [32, 35]], expectedRatio: 1 / 5 }
  ];
  for (const specimen of cases) {
    const width = 64, height = 48;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (const [px, py] of specimen.points) {
      for (let y = py - 2; y <= py + 2; y += 1) for (let x = px - 2; x <= px + 2; x += 1) {
        const i = (y * width + x) * 4;
        rgba[i] = 17; rgba[i + 1] = 24; rgba[i + 2] = 39; rgba[i + 3] = 255;
      }
    }
    const bounds = findSignatureInkBounds(rgba, width, height, 0);
    assert.ok(bounds && bounds.width >= 8 && bounds.height >= 8, specimen.name + " must retain a minimum nonzero crop");
    const fitted = fitSignatureImage(bounds.width, bounds.height, { x: 0, y: 0, width: 120, height: 60 });
    assert.ok(fitted.width > 0 && fitted.height > 0, specimen.name + " must produce a nonzero fitted size");
    assert.ok(fitted.width <= 120 && fitted.height <= 60, specimen.name + " must fit inside its field");
    close(fitted.width / fitted.height, bounds.width / bounds.height);
  }
});

test("fit falls back to the field box when saved specimen pixel dimensions are missing", () => {
  const fitted = fitSignatureImage(undefined, 0, { x: 4, y: 8, width: 120, height: 40 });
  assert.deepEqual(fitted, { x: 4, y: 8, width: 120, height: 40, scale: 1 });
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
  const bounds = findSignatureInkBounds(rgba, width, height, 2);
  assert.deepEqual(bounds, { x: 1, y: 0, width: 8, height: 8 });
  assert.ok(bounds.x <= 2 && bounds.y <= 0, "the padded crop must include the top-left padding");
  assert.ok(bounds.x + bounds.width >= 8 && bounds.y + bounds.height >= 7, "the padded crop must include the bottom-right padding");
});

test("trim export removes white pixels while retaining ink transparency", () => {
  const rgba = new Uint8ClampedArray([255,255,255,255, 17,24,39,255, 245,245,245,255, 17,24,39,80]);
  removeWhitePixels(rgba);
  assert.equal(rgba[3], 0);
  assert.equal(rgba[7], 255);
  assert.equal(rgba[11], 255);
  assert.equal(rgba[15], 80);
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

test("PDF finalizer draws 300x100 signatures and initials proportionally inside 200x200 and 400x40 boxes", async () => {
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
  const actualDraws = [];
  const originalDrawImage = PDFPage.prototype.drawImage;
  PDFPage.prototype.drawImage = function(image, options) {
    if (image.width === 300 && image.height === 100) actualDraws.push({ ...options });
    return originalDrawImage.call(this, image, options);
  };
  let result;
  try {
    result = await buildSignedPdf(sourceBytes, {
      envelopeId: "envelope-1", documentId: "document-1", title: "Test",
      originalHash: "original", chainHead: "chain", completedAt: new Date(0).toISOString(),
      fields,
      signers: [{ id: "S1", uid: "user-1", name: "Signer", email: "signer@example.test", signedAt: new Date(0).toISOString(), signatureType: "drawn", signatureValue: dataUrl, fieldValues }]
    });
  } finally {
    PDFPage.prototype.drawImage = originalDrawImage;
  }

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

  assert.equal(actualDraws.length, 5, "four assigned field stamps plus one certificate stamp must be drawn");
  const sourcePage = (await PDFDocument.load(sourceBytes)).getPages()[0];
  fields.forEach((field, index) => {
    const box = getPdfFieldBox(sourcePage, field);
    const drawn = actualDraws[index];
    close(drawn.width / drawn.height, 3, 0.01);
    assert.ok(drawn.x >= box.x - 0.01 && drawn.y >= box.y - 0.01, field.fieldId + " must start inside its box");
    assert.ok(drawn.x + drawn.width <= box.x + box.width + 0.01, field.fieldId + " must fit horizontally");
    assert.ok(drawn.y + drawn.height <= box.y + box.height + 0.01, field.fieldId + " must fit vertically");
    if (field.fieldId.endsWith("square")) {
      close(box.width, 200);
      close(box.height, 200);
    } else {
      close(box.width, 400);
      close(box.height, 40);
    }
  });
});
test("PDF field geometry respects a non-zero crop box and 90-degree page rotation", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([1200, 1000]);
  page.setCropBox(20, 30, 1000, 800);
  page.setRotation(degrees(90));
  const box = getPdfFieldBox(page, { x: 10, y: 20, width: 30, height: 10 });
  assert.ok(box.x >= 20 && box.y >= 30);
  assert.ok(box.x + box.width <= 1020);
  assert.ok(box.y + box.height <= 830);
  const geometry = getSignatureDrawGeometry(300, 100, box);
  close(geometry.width / geometry.height, 3);
  const rotatedBounds = { x: box.x + (box.width - geometry.height) / 2, y: box.y + (box.height - geometry.width) / 2, width: geometry.height, height: geometry.width };
  assert.ok(rotatedBounds.x >= box.x - 0.01 && rotatedBounds.y >= box.y - 0.01);
  assert.ok(rotatedBounds.x + rotatedBounds.width <= box.x + box.width + 0.01);
  assert.ok(rotatedBounds.y + rotatedBounds.height <= box.y + box.height + 0.01);
});

test("PDF finalizer binds a field to its exact signer ID when multiple signer records share the owner's UID", async () => {
  const source = await PDFDocument.create();
  source.addPage([1200, 1000]);
  const sourceBytes = await source.save();
  const pngBytes = createPng(300, 100);
  const dataUrl = "data:image/png;base64," + pngBytes.toString("base64");
  const field = { ...makeField("owner-signature", "Signature", 10, 20, 30, 10), signerId: "S4", signerUid: "owner-uid" };
  const draws = [];
  const originalDrawImage = PDFPage.prototype.drawImage;
  PDFPage.prototype.drawImage = function(image, options) {
    if (image.width === 300 && image.height === 100) draws.push({ ...options });
    return originalDrawImage.call(this, image, options);
  };
  try {
    await buildSignedPdf(sourceBytes, {
      envelopeId: "envelope-owner-duplicate", documentId: "document-owner-duplicate", title: "Owner signer mapping",
      originalHash: "original", chainHead: "chain", completedAt: new Date(0).toISOString(),
      fields: [field],
      signers: [
        { id: "S7", uid: "owner-uid", name: "Owner duplicate role", email: "owner@example.test", signedAt: new Date(0).toISOString(), signatureType: "typed", signatureValue: "OTHER ROLE", fieldValues: {} },
        { id: "S4", uid: "owner-uid", name: "Daniel Estomihi Mollel", email: "owner@example.test", signedAt: new Date(0).toISOString(), signatureType: "typed", signatureValue: "DANIEL", fieldValues: { "owner-signature": dataUrl } }
      ]
    });
  } finally {
    PDFPage.prototype.drawImage = originalDrawImage;
  }
  assert.equal(draws.length, 1, "the assigned signer S4 must stamp the field even when another signer record with the same UID appears first");
  const sourcePage = (await PDFDocument.load(sourceBytes)).getPages()[0];
  const expected = getPdfFieldBox(sourcePage, field);
  close(draws[0].x + draws[0].width / 2, expected.x + expected.width / 2);
  close(draws[0].y + draws[0].height / 2, expected.y + expected.height / 2);
});

test("signature and initials assignment defaults fit within a single assignee row", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../../src/pages/SignaturePlatform.jsx", import.meta.url), "utf8");
  assert.match(source, /Signature:\{width:18,height:3\.5\}/);
  assert.match(source, /Initials:\{width:10,height:3\}/);
  assert.doesNotMatch(source, /Signature:\{width:28,height:10\}/);
});


test("PDF finalizer stamps canonical visible-page fractions inside a non-zero CropBox", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([1200, 1000]);
  page.setCropBox(40, 60, 900, 760);
  const sourceBytes = await source.save();
  const pngBytes = createPng(300, 100);
  const dataUrl = "data:image/png;base64," + pngBytes.toString("base64");
  const field = {
    fieldId: "canonical-row-four",
    type: "Signature",
    page: 1,
    x: 0.42,
    y: 0.385,
    width: 0.125,
    height: 0.032,
    coordinateSpace: "visible-page-fraction-v1",
    signerId: "S1",
    signerUid: "user-1"
  };
  const draws = [];
  const originalDrawImage = PDFPage.prototype.drawImage;
  PDFPage.prototype.drawImage = function(image, options) {
    if (image.width === 300 && image.height === 100) draws.push({ ...options });
    return originalDrawImage.call(this, image, options);
  };
  try {
    await buildSignedPdf(sourceBytes, {
      envelopeId: "canonical-envelope",
      documentId: "canonical-document",
      title: "Canonical field",
      originalHash: "original",
      chainHead: "chain",
      completedAt: new Date(0).toISOString(),
      fields: [field],
      signers: [{
        id: "S1",
        uid: "user-1",
        name: "Signer",
        signedAt: new Date(0).toISOString(),
        signatureType: "typed",
        signatureValue: "Signer",
        fieldValues: { [field.fieldId]: dataUrl }
      }]
    });
  } finally {
    PDFPage.prototype.drawImage = originalDrawImage;
  }
  assert.equal(draws.length, 1);
  const cropPage = (await PDFDocument.load(sourceBytes)).getPages()[0];
  const expected = getPdfFieldBox(cropPage, field);
  const actual = draws[0];
  assert.ok(actual.x >= expected.x - 0.01 && actual.y >= expected.y - 0.01);
  assert.ok(actual.x + actual.width <= expected.x + expected.width + 0.01);
  assert.ok(actual.y + actual.height <= expected.y + expected.height + 0.01);
  close(expected.x, 40 + 900 * 0.42);
  close(expected.y, 60 + 760 - 760 * 0.385 - 760 * 0.032);
});

test("signer-count regression: 1, 2, 4, 10 and 20 signers retain independent PDF field coordinates", async () => {
  const source = await PDFDocument.create();
  source.addPage([1200, 2400]);
  const sourceBytes = await source.save();
  const pngBytes = createPng(300, 100);
  const dataUrl = "data:image/png;base64," + pngBytes.toString("base64");
  for (const count of [1, 2, 4, 10, 20, 100, 101]) {
    const signers = Array.from({ length: count }, (_, i) => ({ id: `S${i+1}`, uid: "shared-account-uid", name: `Signer ${i+1}`, email: `s${i+1}@example.test`, signedAt: new Date(0).toISOString(), signatureType: "typed", signatureValue: `Signer ${i+1}`, fieldValues: { [`field-${i+1}`]: dataUrl } }));
    const fieldCount = Math.min(count, 100);
    const fields = Array.from({ length: fieldCount }, (_, i) => ({ fieldId: `field-${i+1}`, type: "Signature", page: 1, x: 0.08 + (i % 4) * 0.21, y: 0.025 + Math.floor(i / 4) * 0.038, width: 0.14, height: 0.025, coordinateSpace: "visible-page-fraction-v1", signerId: `S${i+1}`, signerUid: "shared-account-uid" }));
    const orderedFields = [...fields].reverse(), orderedSigners = [...signers].reverse(), draws = [];
    const originalDrawImage = PDFPage.prototype.drawImage;
    PDFPage.prototype.drawImage = function(image, options) { if (image.width === 300 && image.height === 100) draws.push({ ...options }); return originalDrawImage.call(this, image, options); };
    try { await buildSignedPdf(sourceBytes, { envelopeId: `count-${count}`, documentId: "signer-count-regression", title: "Signer count regression", originalHash: "original", chainHead: "chain", completedAt: new Date(0).toISOString(), fields: orderedFields, signers: orderedSigners }); }
    finally { PDFPage.prototype.drawImage = originalDrawImage; }
    assert.equal(draws.length, fieldCount, `${count} signers must produce one stamp per assigned field (up to the 100-field assignment limit)`);
    const sourcePage = (await PDFDocument.load(sourceBytes)).getPages()[0];
    orderedFields.forEach((field, index) => {
      const expected = getPdfFieldBox(sourcePage, field), actual = draws[index];
      assert.ok(actual.x >= expected.x - 0.01 && actual.y >= expected.y - 0.01);
      assert.ok(actual.x + actual.width <= expected.x + expected.width + 0.01);
      assert.ok(actual.y + actual.height <= expected.y + expected.height + 0.01);
      close(actual.x + actual.width / 2, expected.x + expected.width / 2, 0.01);
      close(actual.y + actual.height / 2, expected.y + expected.height / 2, 0.01);
    });
  }
});

test("PDF finalizer keeps signer name, long role and full date upright and inside rotated portrait/landscape pages", async () => {
  const role = "Executive Director, Board Secretary";
  const name = "Daniel Estomihi Mollel";
  const date = "2026-11-19";
  const png = createPng(64, 24);
  const dataUrl = "data:image/png;base64," + png.toString("base64");

  for (const [orientation, dimensions] of [["portrait", [600, 800]], ["landscape", [800, 600]]]) {
    for (const rotation of [0, 90, 180, 270]) {
      const source = await PDFDocument.create();
      const page = source.addPage(dimensions);
      if (rotation) page.setRotation(degrees(rotation));
      const sourceBytes = await source.save();
      const fields = [
        { ...makeField("sig", "Signature", 0.08, 0.08, 0.24, 0.10), coordinateSpace: "visible-page-fraction-v1" },
        { ...makeField("name", "Name", 0.08, 0.23, 0.84, 0.06), coordinateSpace: "visible-page-fraction-v1" },
        { ...makeField("role", "Title", 0.08, 0.31, 0.20, 0.10), coordinateSpace: "visible-page-fraction-v1" },
        { ...makeField("date", "Date", 0.08, 0.42, 0.84, 0.06), coordinateSpace: "visible-page-fraction-v1" }
      ];
      const textDraws = [], imageDraws = [];
      const originalDrawText = PDFPage.prototype.drawText;
      const originalDrawImage = PDFPage.prototype.drawImage;
      PDFPage.prototype.drawText = function(text, options) {
        if (this === page) textDraws.push({ text: String(text), options: { ...options } });
        return originalDrawText.call(this, text, options);
      };
      PDFPage.prototype.drawImage = function(image, options) {
        if (this === page && image.width === 64 && image.height === 24) imageDraws.push({ ...options });
        return originalDrawImage.call(this, image, options);
      };
      try {
        await buildSignedPdf(sourceBytes, {
          envelopeId: "rotation-test", documentId: "rotation-test", title: orientation,
          originalHash: "original", chainHead: "chain", completedAt: date,
          fields,
          signers: [{
            id: "S1", uid: "user-1", name, email: "signer@example.test",
            signedAt: "2026-11-19T08:30:00.000Z", signatureType: "drawn",
            signatureValue: dataUrl,
            fieldValues: { name, role, sig: dataUrl }
          }]
        });
      } finally {
        PDFPage.prototype.drawText = originalDrawText;
        PDFPage.prototype.drawImage = originalDrawImage;
      }

      const combinedText = textDraws.map(item => item.text).join(" ");
      assert.ok(combinedText.includes(name), orientation + " /Rotate " + rotation + " must retain the full signer name");
      assert.ok(combinedText.includes("Executive") && combinedText.includes("Director") && combinedText.includes("Board") && combinedText.includes("Secretary"),
        orientation + " /Rotate " + rotation + " must retain the complete wrapped role");
      assert.ok(combinedText.includes(date), orientation + " /Rotate " + rotation + " must retain the full ISO date");
      assert.ok(textDraws.length >= 3, "name, wrapped role and date must be drawn on the signed page");
      const expectedAngle = rotation ? (360 - rotation) % 360 : 0;
      for (const draw of textDraws) {
        const angle = Number(draw.options.rotate?.angle ?? 0);
        assert.equal(angle, expectedAngle, orientation + " /Rotate " + rotation + " text must counter-rotate upright");
      }
      assert.equal(imageDraws.length, 1, "the signature image must be stamped on the signed page");
      assert.ok(Math.max(imageDraws[0].width, imageDraws[0].height) >= 30,
        orientation + " /Rotate " + rotation + " signature image must render at a readable page-relative size");

      const sourcePage = (await PDFDocument.load(sourceBytes)).getPages()[0];
      for (const draw of textDraws) {
        const text = draw.text;
        const field = text === name ? fields[1]
          : text === date ? fields[3]
          : fields[2];
        const box = getPdfFieldBox(sourcePage, field);
        const width = draw.options.font.widthOfTextAtSize(text, draw.options.size);
        const height = draw.options.size;
        const angle = Number(draw.options.rotate?.angle ?? 0) * Math.PI / 180;
        const corners = [[0,0],[width,0],[0,height],[width,height]].map(([dx,dy]) => ({
          x: draw.options.x + dx * Math.cos(angle) - dy * Math.sin(angle),
          y: draw.options.y + dx * Math.sin(angle) + dy * Math.cos(angle)
        }));
        const minX = Math.min(...corners.map(point => point.x));
        const maxX = Math.max(...corners.map(point => point.x));
        const minY = Math.min(...corners.map(point => point.y));
        const maxY = Math.max(...corners.map(point => point.y));
        assert.ok(minX >= box.x - 0.1 && minY >= box.y - 0.1 &&
          maxX <= box.x + box.width + 0.1 && maxY <= box.y + box.height + 0.1,
        orientation + " /Rotate " + rotation + " text must stay within its assigned page field");
      }
    }
  }
});

