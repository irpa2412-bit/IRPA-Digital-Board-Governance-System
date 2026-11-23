import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { HttpError, sha256Hex } from "./util.mjs";
import { fitSignatureImage } from "../../src/utils/signatureImageFit.mjs";
import { signatureFieldToPdfBox } from "../../src/utils/signatureFieldCoordinates.mjs";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 500;
const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));

export async function validatePdf(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new HttpError(400, "The uploaded file is empty.");
  if (bytes.length > MAX_PDF_BYTES) throw new HttpError(413, "Uploaded documents must not exceed 10 MB.");
  if (ascii(bytes, 0, 5) !== "%PDF-") throw new HttpError(400, "The uploaded file is not a valid PDF.");
  if (!ascii(bytes, Math.max(0, bytes.length - 1024), bytes.length).includes("%%EOF")) throw new HttpError(400, "The PDF is incomplete or truncated.");
  let document;
  try { document = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch { throw new HttpError(400, "The PDF is corrupted, encrypted, or unsupported."); }
  const pageCount = document.getPageCount();
  if (pageCount < 1 || pageCount > MAX_PAGES) throw new HttpError(400, "The PDF page count is not supported.");
  return { pageCount, hash: await sha256Hex(bytes) };
}

export function decodePngDataUrl(value) {
  const base64 = value.slice("data:image/png;base64,".length);
  const binary = atob(base64);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

export async function validateSignatureInput(signature) {
  if (signature?.type === "typed") {
    const value = typeof signature.value === "string" ? signature.value.trim() : "";
    if (value.length < 2 || value.length > 100 || /[\u0000-\u001f\u007f<>]/.test(value)) throw new HttpError(400, "Invalid typed signature.");
    return { type: "typed", value };
  }
  if (signature?.type === "drawn") {
    const value = signature.value;
    if (typeof value !== "string" || value.length > 140000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new HttpError(400, "Invalid drawn signature.");
    try {
      const bytes = decodePngDataUrl(value);
      if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) throw new Error("Invalid PNG signature.");
      const probe = await PDFDocument.create();
      await probe.embedPng(bytes);
    } catch { throw new HttpError(400, "Invalid drawn signature image."); }
    return { type: "drawn", value };
  }
  throw new HttpError(400, "A signature is required.");
}

function safeText(font, value, maxLength) {
  let output = "";
  for (const character of String(value ?? "").slice(0, maxLength)) {
    try { font.encodeText(character); output += character; }
    catch { output += "?"; }
  }
  return output;
}

/** Convert a field rectangle in the visible, rotated crop box into PDF user space. */
export function getPdfFieldBox(page, field, options = {}) {
  try { return signatureFieldToPdfBox(page, field, options); }
  catch (error) { throw new HttpError(400, error?.message || "The signature field is outside the visible PDF page."); }
}

export function getSignatureDrawGeometry(imageWidth, imageHeight, fieldBox) {
  const rotated = fieldBox.rotation === 90 || fieldBox.rotation === 270;
  const fit = fitSignatureImage(imageWidth, imageHeight, {
    x: 0,
    y: 0,
    width: rotated ? fieldBox.height : fieldBox.width,
    height: rotated ? fieldBox.width : fieldBox.height
  }, { allowUpscale: true, maxScale: 3 });
  const width = fit.width;
  const height = fit.height;
  return {
    x: fieldBox.x + (fieldBox.width - width) / 2,
    y: fieldBox.y + (fieldBox.height - height) / 2,
    width,
    height
  };
}

function drawFittedSignature(page, image, fieldBox) {
  const geometry = getSignatureDrawGeometry(image.width, image.height, fieldBox);
  page.drawImage(image, {
    ...geometry,
    ...(fieldBox.rotation ? { rotate: degrees(360 - fieldBox.rotation) } : {})
  });
  return geometry;
}

function wrapPdfText(font, value, size, maxWidth) {
  const lines = [];
  let line = "";
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const character of word) {
      const next = chunk + character;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) chunk = next;
      else {
        if (!chunk) throw new RangeError("A signer particular cannot fit inside its PDF field.");
        lines.push(chunk);
        chunk = character;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawTextInField(page, value, font, fieldBox, options = {}) {
  const rotation = fieldBox.rotation || 0;
  const rotated = rotation === 90 || rotation === 270;
  const textWidth = Math.max(1, rotated ? fieldBox.height : fieldBox.width);
  const textHeight = Math.max(1, rotated ? fieldBox.width : fieldBox.height);
  const padding = Math.min(2, Math.max(0.5, Math.min(textWidth, textHeight) * 0.05));
  const maxWidth = Math.max(1, textWidth - padding * 2);
  const maxHeight = Math.max(1, textHeight - padding * 2);
  const safeValue = safeText(font, String(value ?? ""), 2000);
  let layout = null;
  for (let size = Math.min(12, Math.max(4, maxHeight * 0.55)); size >= 4; size -= 0.25) {
    const lines = wrapPdfText(font, safeValue, size, maxWidth);
    const lineHeight = size * 1.16;
    if (lines.length * lineHeight <= maxHeight + 0.01) {
      layout = { lines, size, lineHeight };
      break;
    }
  }
  if (!layout) throw new HttpError(400, "Signer name, role or date does not fit inside its assigned PDF field. Enlarge the field and retry.");
  const rotate = rotation ? degrees((360 - rotation) % 360) : undefined;
  const color = options.color || rgb(0.05, 0.05, 0.08);
  layout.lines.forEach((line, index) => {
    let x, y;
    if (rotation === 90) {
      x = fieldBox.x + padding + index * layout.lineHeight;
      y = fieldBox.y + fieldBox.height - padding;
    } else if (rotation === 180) {
      x = fieldBox.x + fieldBox.width - padding;
      y = fieldBox.y + fieldBox.height - padding - index * layout.lineHeight;
    } else if (rotation === 270) {
      x = fieldBox.x + fieldBox.width - padding - index * layout.lineHeight;
      y = fieldBox.y + padding;
    } else {
      x = fieldBox.x + padding;
      y = fieldBox.y + padding + (layout.lines.length - 1 - index) * layout.lineHeight;
    }
    page.drawText(line, {
      x, y, size: layout.size, font, color,
      ...(rotate ? { rotate } : {}),
      maxWidth
    });
  });
  return layout;
}

function formatSigningTimestampEAT(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const eat = new Date(timestamp + 3 * 60 * 60 * 1000);
  const pad = part => String(part).padStart(2, "0");
  return `${eat.getUTCFullYear()}-${pad(eat.getUTCMonth() + 1)}-${pad(eat.getUTCDate())} ${pad(eat.getUTCHours())}:${pad(eat.getUTCMinutes())} EAT`;
}

export async function buildSignedPdf(originalBytes, info) {
  const document = await PDFDocument.load(originalBytes);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const italic = await document.embedFont(StandardFonts.HelveticaOblique);
  const pages = document.getPages();

  for (const field of info.fields || []) {
    const signer = field.signerId
      ? (info.signers || []).find(item => item.id === field.signerId)
      : (info.signers || []).find(item => item.uid && item.uid === field.signerUid);
    if (!signer) continue;
    const serverDateTime = formatSigningTimestampEAT(signer.signedAt);
    const value = field.type === "Date"
      ? serverDateTime
      : signer.fieldValues?.[field.fieldId];
    if (value == null || value === "") continue;
    const page = pages[Number(field.page || 1) - 1];
    if (!page) throw new HttpError(400, "A signing field references a missing PDF page.");
    const fieldBox = getPdfFieldBox(page, field);
    const { x, y, width, height } = fieldBox;

    if (field.type === "Signature" || field.type === "Initials") {
      if (typeof value === "string" && value.startsWith("data:image/png;base64,")) {
        const png = await document.embedPng(decodePngDataUrl(value));
        drawFittedSignature(page, png, fieldBox);
      } else {
        page.drawText(safeText(italic, value, 100), {
          x, y: y + Math.min(height * 0.25, 4),
          size: Math.max(7, Math.min(16, height * 0.6)),
          font: italic, maxWidth: width
        });
      }
    } else if (field.type === "Checkbox") {
      page.drawRectangle({ x, y, width: Math.min(width, height), height: Math.min(width, height), borderWidth: 1, borderColor: rgb(0.1, 0.1, 0.1) });
      if (value === "true") page.drawText("X", { x: x + 2, y: y + 1, size: Math.max(7, Math.min(12, height * 0.6)), font: regular, color: rgb(0, 0, 0) });
    } else {
      drawTextInField(page, value, regular, fieldBox);
    }
  }

  let certificatePage = document.addPage([595.28, 841.89]);
  let y = 800;
  const line = (value, options = {}) => {
    const font = options.font || regular, size = options.size || 9;
    certificatePage.drawText(safeText(font, value, 105), { x: 56, y, size, font, color: rgb(0.12, 0.12, 0.12) });
    y -= size + 5;
  };
  line("Electronic Signature Certificate", { font: bold, size: 16 });
  y -= 6;
  line(`Envelope: ${info.envelopeId}`);
  line(`Document: ${info.documentId} - ${info.title}`);
  line("Original document SHA-256:");
  line(info.originalHash, { size: 7.5 });
  line("Audit trail chain head (SHA-256):");
  line(info.chainHead, { size: 7.5 });
  line(`Completed: ${info.completedAt}`);
  y -= 10;

  for (const signer of info.signers) {
    if (y < 130) { certificatePage = document.addPage([595.28, 841.89]); y = 800; }
    const top = y;
    certificatePage.drawRectangle({ x: 50, y: top - 94, width: 495, height: 98, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.7 });
    certificatePage.drawText(safeText(bold, signer.name, 40), { x: 56, y: top - 12, size: 10, font: bold });
    certificatePage.drawText(safeText(regular, signer.email, 40), { x: 56, y: top - 25, size: 8.5, font: regular });
    certificatePage.drawText(safeText(regular, `Signed: ${signer.signedAt}`, 40), { x: 56, y: top - 37, size: 8.5, font: regular });
    certificatePage.drawText(safeText(regular, `IP: ${signer.ip || "n/a"}`, 40), { x: 56, y: top - 49, size: 8.5, font: regular });
    certificatePage.drawText(safeText(regular, `Method: ${signer.signatureType}`, 40), { x: 56, y: top - 61, size: 8.5, font: regular });
    certificatePage.drawText(safeText(regular, `Owner declared: ${signer.declarationDiscrepancy?.ownerDeclared?.name || signer.name || ""} | Occupation: ${signer.declarationDiscrepancy?.ownerDeclared?.occupation || "n/a"} | Capacity: ${signer.declarationDiscrepancy?.ownerDeclared?.capacity || "n/a"}`, 90), { x: 56, y: top - 73, size: 7, font: regular });
    certificatePage.drawText(safeText(regular, `Signer declared: ${signer.signerDeclarations?.name || signer.name || ""} | Occupation: ${signer.signerDeclarations?.occupation || "n/a"} | Capacity: ${signer.signerDeclarations?.capacity || "n/a"}`, 90), { x: 56, y: top - 84, size: 7, font: regular });
    const nameMatchLabel=signer.signerNameMatch?(signer.signerNameMatch.matched?"MATCHED":"VARIANCE RECORDED"):"NOT RECORDED";
    const declarationLabel=signer.declarationDiscrepancy?.detected?`DISCREPANCY NOTED: ${(signer.declarationDiscrepancy.fields||[]).join(", ")}`:"Declaration comparison: no discrepancy recorded";
    certificatePage.drawText(safeText(bold, `Name match: ${nameMatchLabel} | ${declarationLabel}`, 90), { x: 56, y: top - 94, size: 6.5, font: bold, color: signer.signerNameMatch?.matched===false||signer.declarationDiscrepancy?.detected ? rgb(0.65, 0.2, 0.1) : rgb(0.12, 0.12, 0.12) });
    const certificateSignatureValue=signer.certificateSignatureValue??signer.signatureValue;
    const certificateSignatureType=signer.certificateSignatureType??signer.signatureType;
    if (certificateSignatureType === "drawn" && typeof certificateSignatureValue === "string" && certificateSignatureValue.startsWith("data:image/png;base64,")) {
      const png = await document.embedPng(decodePngDataUrl(certificateSignatureValue));
      const fit = fitSignatureImage(png.width, png.height, { x: 340, y: top - 60, width: 170, height: 50 });
      certificatePage.drawImage(png, { x: fit.x, y: fit.y, width: fit.width, height: fit.height });
    } else {
      certificatePage.drawText(safeText(italic, certificateSignatureValue, 28), { x: 340, y: top - 40, size: 18, font: italic });
    }
    y -= 104;
  }

  if (Array.isArray(info.events) && info.events.length) {
    if (y < 150) { certificatePage = document.addPage([595.28, 841.89]); y = 800; }
    y -= 8;
    line("Transaction event chronology", { font: bold, size: 12 });
    for (const event of info.events) {
      if (y < 70) { certificatePage = document.addPage([595.28, 841.89]); y = 800; }
      const label = [event.at || "", event.type || "event", event.signerId ? `Signer ${event.signerId}` : "", event.deliveryStatus ? `Delivery ${event.deliveryStatus}` : ""].filter(Boolean).join(" | ");
      line(label, { size: 7.5 });
    }
  }
  return document.save();
}
