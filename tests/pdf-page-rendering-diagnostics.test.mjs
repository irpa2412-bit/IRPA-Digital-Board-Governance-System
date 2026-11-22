import test from "node:test";
import assert from "node:assert/strict";
import { describePdfPageError, renderPdfPageToCanvas } from "../src/utils/pdfPageRendering.mjs";

test("PDF page errors retain both the error name and message for inline diagnostics", () => {
  const result = describePdfPageError(Object.assign(new Error("canvas allocation failed"), { name: "RenderingError" }));
  assert.deepEqual(result, { name: "RenderingError", message: "canvas allocation failed" });
});

test("PDF page diagnostics never silently erase an unknown error", () => {
  assert.deepEqual(describePdfPageError(null), {
    name: "Error",
    message: "Unknown PDF page rendering error."
  });
});

function fakeCanvas({ dark = true } = {}) {
  const canvas = { width: 0, height: 0 };
  const context = {
    drawn: false,
    setTransform() {},
    fillRect() {},
    getImageData(_x, _y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = dark && i === 0 ? 0 : 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
      }
      return { data };
    }
  };
  canvas.getContext = () => context;
  return { canvas, context };
}

function fakePdf({ text = "last page", dark = true } = {}) {
  return {
    async getPage(number) {
      assert.equal(number, 3);
      return {
        getViewport({ scale }) { return { width: 800 * scale, height: 1000 * scale }; },
        render({ canvasContext }) { return { promise: Promise.resolve().then(() => { canvasContext.drawn = true; }) }; },
        async getTextContent() { return { items: text ? [{ str: text }] : [] }; }
      };
    }
  };
}

test("last-page renderer caps backing canvas allocation and reports per-page text and ink", async () => {
  const { canvas } = fakeCanvas();
  const result = await renderPdfPageToCanvas(fakePdf(), 3, canvas, { maxWidth: 800, maxPixels: 10000 });
  assert.equal(result.pageNumber, 3);
  assert.ok(result.pixelWidth * result.pixelHeight <= 10000);
  assert.ok(result.textCharacters > 0);
  assert.ok(result.nonBlankPixelRatio > 0);
});

test("last-page renderer rejects a truly blank page with a named diagnostic", async () => {
  const { canvas } = fakeCanvas({ dark: false });
  await assert.rejects(
    renderPdfPageToCanvas(fakePdf({ text: "", dark: false }), 3, canvas, { maxWidth: 800, maxPixels: 10000 }),
    error => error.name === "BlankPageError" && /no non-white pixels and extracted no text items/.test(error.message)
  );
});
