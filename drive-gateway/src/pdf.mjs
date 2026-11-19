import { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from "pdf-lib";
import { decodePDFRawStream } from "pdf-lib/cjs/core/streams/decode.js";
import { normalizeSignatureField } from "../../src/utils/signatureFieldCoordinates.mjs";
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
    ...(fieldBox.rotation ? { rotate: degrees(fieldBox.rotation) } : {})
  });
  return geometry;
}

const IDENTITY_PDF_MATRIX = [1, 0, 0, 1, 0, 0];
const PDF_NUMBER_TOKEN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/;

function multiplyPdfMatrices(left, right) {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f
  ];
}

function invertPdfMatrix(matrix) {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) {
    throw new HttpError(400, "The PDF page content transform is not invertible; signer fields cannot be placed safely.");
  }
  return [
    d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant
  ];
}

function transformPdfPoint(matrix, x, y) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5]
  };
}

function skipPdfLiteralString(source, index) {
  let depth = 1;
  for (let i = index + 1; i < source.length; i += 1) {
    const character = source[i];
    if (character === "\\") { i += 1; continue; }
    if (character === "(") depth += 1;
    else if (character === ")" && --depth === 0) return i + 1;
  }
  return source.length;
}

function skipPdfComposite(source, index, open, close) {
  let depth = 1;
  for (let i = index + 1; i < source.length; i += 1) {
    const character = source[i];
    if (character === "(") { i = skipPdfLiteralString(source, i) - 1; continue; }
    if (character === "<" && source[i + 1] === "<") { i = skipPdfComposite(source, i + 1, "<", ">") - 1; continue; }
    if (character === "[" && open !== "[") { i = skipPdfComposite(source, i, "[", "]") - 1; continue; }
    if (character === open) depth += 1;
    else if (character === close && --depth === 0) return i + 1;
  }
  return source.length;
}

function skipPdfInlineImage(source, index) {
  let i = index;
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i])) i += 1;
    const start = i;
    while (i < source.length && !/[\s()[\]<>/%]/.test(source[i])) i += 1;
    const token = source.slice(start, i);
    if (token === "ID") {
      for (let j = i; j < source.length - 2; j += 1) {
        if (/\s/.test(source[j]) && source[j + 1] === "E" && source[j + 2] === "I" &&
          (j + 3 === source.length || /[\s()[\]<>/%]/.test(source[j + 3]))) return j + 3;
      }
      return source.length;
    }
    if (!token) i += 1;
  }
  return source.length;
}

function parsePdfContentStream(bytes, state) {
  const source = new TextDecoder("latin1").decode(bytes);
  const operands = [];
  let i = 0;
  while (i < source.length) {
    const character = source[i];
    if (/\s/.test(character)) { i += 1; continue; }
    if (character === "%") {
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i += 1;
      continue;
    }
    if (character === "(") { i = skipPdfLiteralString(source, i); continue; }
    if (character === "<") {
      if (source[i + 1] === "<") i = skipPdfComposite(source, i + 1, "<", ">");
      else {
        i += 1;
        while (i < source.length && source[i] !== ">") i += 1;
        i += 1;
      }
      continue;
    }
    if (character === "[") { i = skipPdfComposite(source, i, "[", "]"); continue; }
    if (character === "/") {
      i += 1;
      while (i < source.length && !/[\s()[\]<>/%]/.test(source[i])) i += 1;
      continue;
    }
    const start = i;
    while (i < source.length && !/[\s()[\]<>/%]/.test(source[i])) i += 1;
    const token = source.slice(start, i);
    if (!token) { i += 1; continue; }
    if (PDF_NUMBER_TOKEN.test(token)) {
      operands.push(Number(token));
      if (operands.length > 12) operands.splice(0, operands.length - 12);
      continue;
    }
    if (token === "BI") {
      operands.length = 0;
      i = skipPdfInlineImage(source, i);
      continue;
    }
    if (token === "q") {
      state.stack.push([...state.matrix]);
    } else if (token === "Q") {
      if (state.stack.length) state.matrix = state.stack.pop();
    } else if (token === "cm" && operands.length >= 6) {
      state.matrix = multiplyPdfMatrices(state.matrix, operands.slice(-6));
    } else if (token === "BT") {
      state.textMatrices.push([...state.matrix]);
    }
    operands.length = 0;
  }
}

function medianNumber(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function validatePageContentMatrix(matrix) {
  const [a, b, c, d] = matrix;
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  const dot = a * c + b * d;
  const determinant = a * d - b * c;
  const tolerance = Math.max(scaleX, scaleY, 1) * 1e-4;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX < 1e-6 || scaleY < 1e-6 ||
      determinant <= 0 || Math.abs(dot) > scaleX * scaleY * 1e-4 ||
      Math.abs(scaleX - scaleY) > tolerance) {
    throw new HttpError(400, "The PDF page has a skewed, mirrored or non-uniform content transform; signer particulars cannot be oriented safely.");
  }
  return matrix;
}

async function getPageContentTransform(page) {
  const state = { matrix: [...IDENTITY_PDF_MATRIX], stack: [], textMatrices: [] };
  const contents = page.node.Contents();
  if (contents) {
    const streams = typeof contents.size === "function" && typeof contents.lookup === "function"
      ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index))
      : [contents];
    for (const stream of streams) {
      if (!stream) continue;
      const bytes = typeof stream.getUnencodedContents === "function"
        ? stream.getUnencodedContents()
        : decodePDFRawStream(stream).decode();
      parsePdfContentStream(bytes, state);
    }
  }
  const candidates = state.textMatrices.length ? state.textMatrices : [state.matrix];
  const buckets = new Map();
  for (const candidate of candidates) {
    const key = candidate.slice(0, 4).map(value => Math.round(value * 10000) / 10000).join(",");
    const bucket = buckets.get(key) || [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }
  const dominant = [...buckets.values()].sort((a, b) => b.length - a.length)[0] || [state.matrix];
  const matrix = [
    ...dominant[0].slice(0, 4),
    medianNumber(dominant.map(item => item[4])),
    medianNumber(dominant.map(item => item[5]))
  ];
  return validatePageContentMatrix(matrix);
}

function pageToVisibleMatrix(crop, rotation) {
  if (rotation === 0) return [1, 0, 0, -1, -crop.x, crop.y + crop.height];
  if (rotation === 90) return [0, 1, 1, 0, -crop.y, -crop.x];
  if (rotation === 180) return [-1, 0, 0, 1, crop.x + crop.width, -crop.y];
  return [0, -1, -1, 0, crop.y + crop.height, crop.x + crop.width];
}

function getEffectivePdfFieldBox(page, field, contentMatrix) {
  try {
    const canonical = normalizeSignatureField(field);
    const crop = page.getCropBox();
    const pageRotation = ((Number(page.getRotation?.()?.angle || 0) % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(pageRotation)) throw new RangeError("The PDF page rotation is not supported.");
    const visibleWidth = pageRotation === 90 || pageRotation === 270 ? crop.height : crop.width;
    const visibleHeight = pageRotation === 90 || pageRotation === 270 ? crop.width : crop.height;
    const left = canonical.x * visibleWidth;
    const top = canonical.y * visibleHeight;
    const width = canonical.width * visibleWidth;
    const height = canonical.height * visibleHeight;
    if (![left, top, width, height].every(Number.isFinite) || left < 0 || top < 0 || width <= 0 || height <= 0 ||
        left + width > visibleWidth + 0.01 || top + height > visibleHeight + 0.01) {
      throw new RangeError("The signature field is outside the visible PDF page.");
    }
    const visibleMatrix = multiplyPdfMatrices(pageToVisibleMatrix(crop, pageRotation), contentMatrix);
    const inverse = invertPdfMatrix(visibleMatrix);
    const points = [
      transformPdfPoint(inverse, left, top),
      transformPdfPoint(inverse, left + width, top),
      transformPdfPoint(inverse, left, top + height),
      transformPdfPoint(inverse, left + width, top + height)
    ];
    const x = Math.min(...points.map(point => point.x));
    const y = Math.min(...points.map(point => point.y));
    const right = Math.max(...points.map(point => point.x));
    const bottom = Math.max(...points.map(point => point.y));
    const angle = ((Math.round(Math.atan2(visibleMatrix[1], visibleMatrix[0]) * 180 / Math.PI / 90) * 90) % 360 + 360) % 360;
    if (Math.abs(Math.atan2(visibleMatrix[1], visibleMatrix[0]) * 180 / Math.PI - angle) > 0.5) {
      throw new RangeError("The PDF page content is not aligned to a supported right angle.");
    }
    return { x, y, width: right - x, height: bottom - y, rotation: angle };
  } catch (error) {
    throw new HttpError(400, error?.message || "The signature field is outside the visible PDF page.");
  }
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
  const rotate = rotation ? degrees(rotation) : undefined;
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
  const pageContentTransforms = new Map();

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
    const orientationSensitive = ["Signature", "Initials", "Name", "Title", "Role", "Date"].includes(field.type);
    let fieldBox;
    if (orientationSensitive) {
      let contentMatrix = pageContentTransforms.get(page);
      if (!contentMatrix) {
        contentMatrix = await getPageContentTransform(page);
        page.node.normalize();
        pageContentTransforms.set(page, contentMatrix);
      }
      fieldBox = getEffectivePdfFieldBox(page, field, contentMatrix);
      if (contentMatrix.some((value, index) => Math.abs(value - IDENTITY_PDF_MATRIX[index]) > 1e-8)) {
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...contentMatrix));
        // The matching Q is emitted immediately after this field's stamp below.
      }
    } else {
      fieldBox = getPdfFieldBox(page, field);
    }
    const { x, y, width, height } = fieldBox;

    if (field.type === "Signature" || field.type === "Initials") {
      if (typeof value === "string" && value.startsWith("data:image/png;base64,")) {
        const png = await document.embedPng(decodePngDataUrl(value));
        drawFittedSignature(page, png, fieldBox);
      } else {
        drawTextInField(page, safeText(italic, value, 100), italic, fieldBox);
      }
    } else if (field.type === "Checkbox") {
      page.drawRectangle({ x, y, width: Math.min(width, height), height: Math.min(width, height), borderWidth: 1, borderColor: rgb(0.1, 0.1, 0.1) });
      if (value === "true") page.drawText("X", { x: x + 2, y: y + 1, size: Math.max(7, Math.min(12, height * 0.6)), font: regular, color: rgb(0, 0, 0) });
    } else {
      drawTextInField(page, value, regular, fieldBox);
    }
    if (orientationSensitive && pageContentTransforms.get(page)?.some((item, index) => Math.abs(item - IDENTITY_PDF_MATRIX[index]) > 1e-8)) {
      page.pushOperators(popGraphicsState());
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
    certificatePage.drawText(safeText(bold, signer.declarationDiscrepancy?.detected ? `DISCREPANCY NOTED: ${(signer.declarationDiscrepancy.fields || []).join(", ")}` : "Declaration comparison: no discrepancy recorded", 90), { x: 56, y: top - 94, size: 6.5, font: bold, color: signer.declarationDiscrepancy?.detected ? rgb(0.65, 0.2, 0.1) : rgb(0.12, 0.12, 0.12) });
    if (signer.signatureType === "drawn" && typeof signer.signatureValue === "string" && signer.signatureValue.startsWith("data:image/png;base64,")) {
      const png = await document.embedPng(decodePngDataUrl(signer.signatureValue));
      const fit = fitSignatureImage(png.width, png.height, { x: 340, y: top - 60, width: 170, height: 50 });
      certificatePage.drawImage(png, { x: fit.x, y: fit.y, width: fit.width, height: fit.height });
    } else {
      certificatePage.drawText(safeText(italic, signer.signatureValue, 28), { x: 340, y: top - 40, size: 18, font: italic });
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
