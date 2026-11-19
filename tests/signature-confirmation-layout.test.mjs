import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../src/components/SignatureFieldConfirmationPad.jsx",import.meta.url),"utf8");

test("signature confirmation actions are outside the independently scrolling content",()=>{
  const contentStart=source.indexOf('className="signature-confirmation-content"');
  const footerStart=source.indexOf('<footer className="signature-confirmation-actions"');
  const footerEnd=source.indexOf("</footer>",footerStart);
  assert.ok(contentStart>=0&&footerStart>contentStart&&footerEnd>footerStart);
  assert.ok(source.slice(contentStart,footerStart).includes('overflowY:"auto"'));
  assert.ok(source.slice(footerStart,footerEnd).includes('position:"sticky"'));
  assert.ok(source.slice(footerStart,footerEnd).includes('bottom:0'));
  assert.ok(source.slice(footerStart,footerEnd).includes("Use this signature"));
  assert.ok(source.slice(footerStart,footerEnd).includes("onCancel"));
});

test("confirmation dock fits the dynamic viewport and respects phone safe areas",()=>{
  assert.ok(source.includes('maxHeight:"calc(100dvh - 12px)"'));
  assert.ok(source.includes('paddingBottom:"env(safe-area-inset-bottom, 0px)"'));
  assert.ok(source.includes("calc(10px + env(safe-area-inset-bottom, 0px))"));
  assert.ok(source.includes('overflow:"hidden"'));
  assert.ok(source.includes("minHeight:44"));
});

test("saved, drawn and typed signature methods share the always-visible action footer",()=>{
  assert.ok(source.includes('"Draw"'));
  assert.ok(source.includes('"Use my saved signature"'));
  assert.ok(source.includes('"Type"'));
  assert.ok(source.includes('mode==="Use my saved signature"?"Use this signature"'));
  assert.ok(source.includes('mode==="Type"?"Confirm "+(field?.type||"Signature")'));
});
