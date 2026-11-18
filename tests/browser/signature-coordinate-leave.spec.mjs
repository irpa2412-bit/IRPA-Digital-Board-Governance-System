import { test, expect } from "@playwright/test";
import { signatureFieldFromPercent, signatureFieldCss } from "../../src/utils/signatureFieldCoordinates.mjs";

test("signature field overlay remains inside its assigned table cell at responsive widths and zoom", async ({ page }) => {
  await page.setContent("<main><h1>Signature field placement harness</h1></main>");
  const canonical = signatureFieldFromPercent({ fieldId: "row-four-signature", page: 1, x: 52.6315789, y: 30, width: 15.7894737, height: 3 });
  const fieldCss = signatureFieldCss(canonical);
  const results = await page.evaluate(({ fieldCss }) => {
    const pageBox = document.createElement("div");
    pageBox.id = "pdf-page";
    Object.assign(pageBox.style, { position: "relative", height: "1000px", width: "760px", background: "white" });
    document.body.append(pageBox);
    const cell = document.createElement("div");
    cell.id = "table-row-four-sahihi-cell";
    Object.assign(cell.style, { position: "absolute", left: "52.6315789%", top: "30%", width: "15.7894737%", height: "3%", border: "1px solid black", boxSizing: "border-box" });
    pageBox.append(cell);
    const overlay = document.createElement("div");
    overlay.id = "signature-field-overlay";
    Object.assign(overlay.style, { position: "absolute", boxSizing: "border-box", border: "2px solid green", ...fieldCss });
    pageBox.append(overlay);
    const output = [];
    for (const width of [360, 768, 1440]) {
      pageBox.style.width = width + "px";
      pageBox.style.height = (width * 1000 / 760) + "px";
      const a = cell.getBoundingClientRect(), b = overlay.getBoundingClientRect();
      output.push({ width, leftDelta: Math.abs(a.left-b.left), topDelta: Math.abs(a.top-b.top), widthDelta: Math.abs(a.width-b.width), heightDelta: Math.abs(a.height-b.height) });
    }
    pageBox.style.transform = "scale(1.5)";
    const a = cell.getBoundingClientRect(), b = overlay.getBoundingClientRect();
    output.push({ width: "zoom-150", leftDelta: Math.abs(a.left-b.left), topDelta: Math.abs(a.top-b.top), widthDelta: Math.abs(a.width-b.width), heightDelta: Math.abs(a.height-b.height) });
    return output;
  }, { fieldCss });
  for (const item of results) {
    expect(item.leftDelta, JSON.stringify(item)).toBeLessThanOrEqual(1);
    expect(item.topDelta, JSON.stringify(item)).toBeLessThanOrEqual(1);
    expect(item.widthDelta, JSON.stringify(item)).toBeLessThanOrEqual(1);
    expect(item.heightDelta, JSON.stringify(item)).toBeLessThanOrEqual(1);
  }
});
