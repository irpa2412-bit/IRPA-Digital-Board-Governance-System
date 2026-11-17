/**
 * Locate non-white, non-transparent pixels in an RGBA buffer and return a padded crop.
 * The returned bounds are in source pixels and are safe for transparent PNG export.
 */
export function findSignatureInkBounds(data, width, height, padding = 4) {
  const w = Number(width), h = Number(height), pad = Number(padding);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 ||
      !Number.isFinite(pad) || pad < 0 || !data || data.length < w * h * 4) {
    throw new RangeError("A valid RGBA image and non-negative padding are required.");
  }
  let left = w, top = h, right = -1, bottom = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const alpha = data[i + 3];
      const isInk = alpha > 0 && (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250);
      if (!isInk) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return null;
  const x = Math.max(0, left - pad);
  const y = Math.max(0, top - pad);
  const endX = Math.min(w, right + pad + 1);
  const endY = Math.min(h, bottom + pad + 1);
  return { x, y, width: endX - x, height: endY - y };
}

export function requireSignatureInkBounds(data, width, height, padding = 4) {
  const bounds = findSignatureInkBounds(data, width, height, padding);
  if (!bounds) throw new Error("The signature pad is empty. Add visible ink before saving.");
  return bounds;
}

/**
 * Crop a canvas/image to its ink bounds, retaining transparent pixels and
 * preserving the source's device-pixel dimensions.
 */
export function trimSignatureCanvas(source, { padding = 4, devicePixelRatio = 1 } = {}) {
  if (!source) throw new Error("A signature canvas is required.");
  const width = Number(source.width || source.naturalWidth);
  const height = Number(source.height || source.naturalHeight);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("The signature image has no drawable pixels.");
  }
  const probe = document.createElement("canvas");
  probe.width = width;
  probe.height = height;
  const probeContext = probe.getContext("2d", { willReadFrequently: true });
  if (!probeContext) throw new Error("Signature image processing is unavailable.");
  probeContext.drawImage(source, 0, 0, width, height);
  const image = probeContext.getImageData(0, 0, width, height);
  const bounds = requireSignatureInkBounds(image.data, width, height, Math.max(0, Math.round(Number(padding) * Number(devicePixelRatio || 1))));
  const output = document.createElement("canvas");
  output.width = bounds.width;
  output.height = bounds.height;
  const context = output.getContext("2d");
  if (!context) throw new Error("Signature image processing is unavailable.");
  context.clearRect(0, 0, output.width, output.height);
  context.drawImage(probe, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return { dataUrl: output.toDataURL("image/png"), width: output.width, height: output.height, canvas: output };
}
