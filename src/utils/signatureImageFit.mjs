/**
 * Pure signature-image geometry shared by browser previews and the PDF finalizer.
 * Coordinates use the same unit as the supplied field rectangle (CSS px or PDF points).
 */
export function fitSignatureImage(imageWidth, imageHeight, box, options = {}) {
  const suppliedW = Number(imageWidth);
  const suppliedH = Number(imageHeight);
  const boxX = Number(box?.x ?? 0);
  const boxY = Number(box?.y ?? 0);
  const boxW = Number(box?.width);
  const boxH = Number(box?.height);
  if (![boxX, boxY, boxW, boxH].every(Number.isFinite) || boxW <= 0 || boxH <= 0) {
    throw new RangeError("Signature field dimensions must be positive finite numbers.");
  }
  // Some image elements report dimensions before decode (or omit them in
  // legacy saved specimens). Use the field rectangle as a neutral fallback;
  // valid specimen dimensions continue through the aspect-ratio fit below.
  const hasImageSize = Number.isFinite(suppliedW) && Number.isFinite(suppliedH) && suppliedW > 0 && suppliedH > 0;
  const imgW = hasImageSize ? suppliedW : boxW;
  const imgH = hasImageSize ? suppliedH : boxH;
  const maxScale = options.allowUpscale === true ? Number(options.maxScale ?? Infinity) : 1;
  if (!(maxScale > 0)) throw new RangeError("Signature image maximum scale must be positive.");
  const scale = Math.min(boxW / imgW, boxH / imgH, maxScale);
  const width = imgW * scale;
  const height = imgH * scale;
  return {
    x: boxX + (boxW - width) / 2,
    y: boxY + (boxH - height) / 2,
    width,
    height,
    scale
  };
}
