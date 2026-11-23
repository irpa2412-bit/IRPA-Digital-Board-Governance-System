export function normalizeCertificateWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function chainValues(events, signers = []) {
  const names = new Set(signers.map(s => s?.name).filter(v => typeof v === "string" && v.trim()).map(normalizeCertificateWhitespace));
  const timestamps = new Set();
  const hashes = new Set();
  for (const event of events || []) {
    if (typeof event?.at === "string" && event.at.trim()) timestamps.add(normalizeCertificateWhitespace(event.at));
    for (const key of ["name", "signerName"]) {
      if (typeof event?.[key] === "string" && event[key].trim()) names.add(normalizeCertificateWhitespace(event[key]));
    }
    if (typeof event?.hash === "string" && /^[a-f0-9]{64}$/i.test(event.hash)) hashes.add(event.hash.toLowerCase());
  }
  return { names, timestamps, hashes };
}

export function verifyCertificateInput(info, verifiedEvents, verifiedSigners = []) {
  const expected = chainValues(verifiedEvents, verifiedSigners);
  const actualNames = new Set((info?.signers || []).map(s => normalizeCertificateWhitespace(s?.name)).filter(Boolean));
  const actualTimestamps = new Set((info?.events || []).map(e => normalizeCertificateWhitespace(e?.at)).filter(Boolean));
  const actualHashes = new Set((info?.events || []).map(e => String(e?.hash || "").toLowerCase()).filter(Boolean));
  const failures = [];
  for (const value of expected.names) if (!actualNames.has(value)) failures.push("INPUT_SIGNER_MISSING");
  for (const value of expected.timestamps) if (!actualTimestamps.has(value) && normalizeCertificateWhitespace(info?.completedAt) !== value) failures.push("INPUT_TIMESTAMP_MISSING");
  for (const value of expected.hashes) if (!actualHashes.has(value) && normalizeCertificateWhitespace(info?.chainHead).toLowerCase() !== value) failures.push("INPUT_EVENT_HASH_MISSING");
  for (const value of actualNames) if (!expected.names.has(value)) failures.push("INPUT_SIGNER_EXTRA");
  for (const value of actualTimestamps) if (!expected.timestamps.has(value)) failures.push("INPUT_TIMESTAMP_EXTRA");
  for (const value of actualHashes) if (!expected.hashes.has(value)) failures.push("INPUT_EVENT_HASH_EXTRA");
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

export async function extractPdfText(pdfBytes) {
  // Certificate evidence may span multiple continuation pages; verify the full PDF text.
  const { extractText } = await import("unpdf");
  const { text } = await extractText(pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes));
  if (Array.isArray(text)) return text.join("\n");
  return String(text || "").replace(/\f/g, "\n");
}

export async function extractLastPdfPageText(pdfBytes) {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes));
  if (Array.isArray(text)) return text.at(-1) || "";
  const pages = String(text || "").split("\f");
  return pages.at(-1) || pages[0] || "";
}

export function verifyCertificatePageText(pageText, verifiedEvents, verifiedSigners = []) {
  const normalized = normalizeCertificateWhitespace(pageText);
  const expected = chainValues(verifiedEvents, verifiedSigners);
  const failures = [];
  for (const value of expected.names) if (!normalized.includes(value)) failures.push("CERTIFICATE_SIGNER_MISSING");
  for (const value of expected.timestamps) if (!normalized.includes(value)) failures.push("CERTIFICATE_TIMESTAMP_MISSING");
  for (const value of expected.hashes) if (!normalized.toLowerCase().includes(value)) failures.push("CERTIFICATE_EVENT_HASH_MISSING");
  const pageTimestamps = normalized.match(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g) || [];
  const pageHashes = normalized.match(/\b[a-f0-9]{64}\b/gi) || [];
  for (const value of pageTimestamps) if (!expected.timestamps.has(normalizeCertificateWhitespace(value))) failures.push("CERTIFICATE_TIMESTAMP_EXTRA");
  for (const value of pageHashes) if (!expected.hashes.has(value.toLowerCase())) failures.push("CERTIFICATE_EVENT_HASH_EXTRA");
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}
