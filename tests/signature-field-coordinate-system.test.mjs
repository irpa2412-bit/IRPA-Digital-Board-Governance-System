import test from "node:test";
import assert from "node:assert/strict";
import {
  SIGNATURE_FIELD_COORDINATE_SPACE,
  normalizeSignatureField,
  signatureFieldFromPercent,
  signatureFieldToPercent,
  signatureFieldsToPercent,
  signatureFieldFromPointer,
  signatureFieldToPdfBox,
  signatureFieldCss
} from "../src/utils/signatureFieldCoordinates.mjs";

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const page = (crop, rotation = 0) => ({ getCropBox: () => crop, getRotation: () => ({ angle: rotation }) });

test("regression: a field in the fourth table row remains in its assigned cell instead of drifting to rows seven/eight", () => {
  const field = signatureFieldFromPercent({ fieldId: "regression-row-4", page: 1, x: 42.25, y: 38.5, width: 12.5, height: 3.2 });
  const css = signatureFieldCss(field);
  assert.equal(field.coordinateSpace, SIGNATURE_FIELD_COORDINATE_SPACE);
  close(parseFloat(css.left), 42.25);
  close(parseFloat(css.top), 38.5);
  close(parseFloat(css.width), 12.5);
  close(parseFloat(css.height), 3.2);
  for (const renderedWidth of [320, 760, 1440]) {
    const left = renderedWidth * field.x;
    const width = renderedWidth * field.width;
    assert.ok(left >= 0 && left + width <= renderedWidth + 1);
    close(left / renderedWidth, field.x);
  }
});

test("placement pointer coordinates are canonical fractions of the visible page from top-left", () => {
  const result = signatureFieldFromPointer(250, 175, { left: 50, top: 25, width: 400, height: 600 });
  close(result.x, 0.5);
  close(result.y, 0.25);
});

test("legacy 0-100 records convert at read time and remain unchanged at source", () => {
  const legacy = { fieldId: "legacy", page: 1, x: 42.25, y: 38.5, width: 12.5, height: 3.2 };
  const converted = normalizeSignatureField(legacy);
  close(converted.x, 0.4225);
  close(converted.y, 0.385);
  close(converted.width, 0.125);
  close(converted.height, 0.032);
  assert.equal(legacy.x, 42.25);
  assert.deepEqual(signatureFieldToPercent(converted).x, 42.25);
});

test("round trip from canonical placement to PDF points and back stays within one rendered pixel", () => {
  const crop = { x: 17, y: 23, width: 612, height: 792 };
  const field = { fieldId: "round-trip", coordinateSpace: SIGNATURE_FIELD_COORDINATE_SPACE, page: 1, x: 0.414, y: 0.386, width: 0.125, height: 0.032 };
  const box = signatureFieldToPdfBox(page(crop), field);
  const recovered = {
    x: (box.x - crop.x) / crop.width,
    y: (crop.y + crop.height - box.y - box.height) / crop.height,
    width: box.width / crop.width,
    height: box.height / crop.height
  };
  const renderedWidth = 760, renderedHeight = renderedWidth * crop.height / crop.width;
  for (const key of ["x", "y", "width", "height"]) {
    const pixels = Math.abs(recovered[key] - field[key]) * (key === "x" || key === "width" ? renderedWidth : renderedHeight);
    assert.ok(pixels <= 1, `${key} round trip exceeded one pixel: ${pixels}`);
  }
});

test("PDF CropBox, not MediaBox, determines field geometry", () => {
  const media = { x: 0, y: 0, width: 800, height: 1000 };
  const crop = { x: 40, y: 60, width: 600, height: 780 };
  const field = { fieldId: "crop", coordinateSpace: SIGNATURE_FIELD_COORDINATE_SPACE, page: 1, x: 0.5, y: 0.25, width: 0.1, height: 0.05 };
  const box = signatureFieldToPdfBox(page(crop), field);
  close(box.x, crop.x + crop.width * 0.5);
  close(box.y, crop.y + crop.height - crop.height * 0.25 - crop.height * 0.05);
  assert.notEqual(box.x, media.width * 0.5);
});

test("rotated visible CropBox uses the same top-left visible-page coordinate system", () => {
  const crop = { x: 20, y: 30, width: 600, height: 800 };
  const field = { fieldId: "rotated", coordinateSpace: SIGNATURE_FIELD_COORDINATE_SPACE, page: 1, x: 0.2, y: 0.3, width: 0.1, height: 0.05 };
  const box = signatureFieldToPdfBox(page(crop, 90), field);
  close(box.x, crop.x + crop.width * 0.3);
  close(box.y, crop.y + crop.height * 0.2);
  close(box.width, crop.width * 0.05);
  close(box.height, crop.height * 0.1);
});

test("zoom changes rendered pixels but not canonical field location", () => {
  const field = { fieldId: "zoom", coordinateSpace: SIGNATURE_FIELD_COORDINATE_SPACE, page: 1, x: 0.41, y: 0.38, width: 0.12, height: 0.03 };
  const base = signatureFieldCss(field);
  for (const scale of [0.6, 1, 1.8]) {
    const width = 760 * scale;
    close((width * field.x) / width, 0.41);
    assert.equal(signatureFieldCss(field).left, base.left);
  }
});


test("180-degree rotated CropBox maps the visible top-left rectangle back into PDF user space", () => {
  const crop = { x: 20, y: 30, width: 600, height: 800 };
  const field = { fieldId: "rotated-180", coordinateSpace: SIGNATURE_FIELD_COORDINATE_SPACE, page: 1, x: 0.2, y: 0.3, width: 0.1, height: 0.05 };
  const box = signatureFieldToPdfBox(page(crop, 180), field);
  close(box.x, crop.x + crop.width - crop.width * 0.2 - crop.width * 0.1);
  close(box.y, crop.y + crop.height * 0.3);
  close(box.width, crop.width * 0.1);
  close(box.height, crop.height * 0.05);
});

test("270-degree rotated CropBox maps the visible top-left rectangle back into PDF user space", () => {
  const crop = { x: 20, y: 30, width: 600, height: 800 };
  const field = { fieldId: "rotated-270", coordinateSpace: SIGNATURE_FIELD_COORDINATE_SPACE, page: 1, x: 0.2, y: 0.3, width: 0.1, height: 0.05 };
  const box = signatureFieldToPdfBox(page(crop, 270), field);
  close(box.x, crop.x + crop.width - crop.width * 0.3 - crop.width * 0.05);
  close(box.y, crop.y + crop.height - crop.height * 0.2 - crop.height * 0.1);
  close(box.width, crop.width * 0.05);
  close(box.height, crop.height * 0.1);
});


test("unknown coordinate-space markers fail closed instead of being misread as legacy percentages", () => {
  assert.throws(
    () => normalizeSignatureField({ fieldId: "unknown-space", page: 1, x: 0.2, y: 0.3, width: 0.1, height: 0.05, coordinateSpace: "future-coordinate-v2" }),
    /coordinate space is not supported/
  );
});


test("saved draft fields round-trip to editor percentages without losing signer or responsibility metadata", () => {
  const persisted = [{
    fieldId: "draft-field-1", type: "Signature", page: 3,
    x: 0.4225, y: 0.385, width: 0.125, height: 0.032,
    coordinateSpace: SIGNATURE_FIELD_COORDINATE_SPACE,
    signerUid: "assigned-signer-uid", responsibility: "Signature",
    roleAssignmentIndex: 1, required: true
  }];
  const restored = signatureFieldsToPercent(persisted);
  assert.equal(restored.length, 1);
  assert.deepEqual(
    { fieldId: restored[0].fieldId, type: restored[0].type, page: restored[0].page,
      signerUid: restored[0].signerUid, responsibility: restored[0].responsibility,
      roleAssignmentIndex: restored[0].roleAssignmentIndex, required: restored[0].required },
    { fieldId: "draft-field-1", type: "Signature", page: 3,
      signerUid: "assigned-signer-uid", responsibility: "Signature",
      roleAssignmentIndex: 1, required: true }
  );
  close(restored[0].x, 42.25);
  close(restored[0].y, 38.5);
  close(restored[0].width, 12.5);
  close(restored[0].height, 3.2);
  assert.equal("coordinateSpace" in restored[0], false);
});
