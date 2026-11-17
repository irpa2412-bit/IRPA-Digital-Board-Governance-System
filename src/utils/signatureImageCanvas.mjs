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
  // Keep very flat strokes and single-point initials drawable after trimming.
  // Expand around the ink centre while respecting the source image boundaries.
  const minWidth = Math.min(w, 8);
  const minHeight = Math.min(h, 8);
  let endX = Math.min(w, right + pad + 1);
  let endY = Math.min(h, bottom + pad + 1);
  let cropX = x;
  let cropY = y;
  if (endX - cropX < minWidth) {
    const extra = minWidth - (endX - cropX);
    cropX = Math.max(0, cropX - Math.ceil(extra / 2));
    endX = Math.min(w, cropX + minWidth);
    cropX = Math.max(0, endX - minWidth);
  }
  if (endY - cropY < minHeight) {
    const extra = minHeight - (endY - cropY);
    cropY = Math.max(0, cropY - Math.ceil(extra / 2));
    endY = Math.min(h, cropY + minHeight);
    cropY = Math.max(0, endY - minHeight);
  }
  return { x: cropX, y: cropY, width: endX - cropX, height: endY - cropY };
}

export function removeWhitePixels(data) {
  if (!data || data.length % 4 !== 0) throw new RangeError("A valid RGBA pixel buffer is required.");
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] > 0 && data[index] >= 250 && data[index + 1] >= 250 && data[index + 2] >= 250) data[index + 3] = 0;
  }
  return data;
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
  const width = Number(source.naturalWidth || source.width);
  const height = Number(source.naturalHeight || source.height);
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
  const cropped = context.getImageData(0, 0, output.width, output.height);
  removeWhitePixels(cropped.data);
  context.putImageData(cropped, 0, 0);
  return { dataUrl: output.toDataURL("image/png"), width: output.width, height: output.height, canvas: output };
}
