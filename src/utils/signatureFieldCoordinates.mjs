export const SIGNATURE_FIELD_COORDINATE_SPACE = "visible-page-fraction-v1";

/**
 * Canonical field geometry is measured in fractions of the visible, rotated
 * PDF page box, with a top-left origin. Legacy records without a coordinate
 * marker used 0-100 percentage values and are converted only when read.
 */
export function normalizeSignatureField(field, { warn = null } = {}) {
  if (!field || typeof field !== "object") throw new TypeError("A signature field is required.");
  if (field.coordinateSpace === SIGNATURE_FIELD_COORDINATE_SPACE) {
    return { ...field, page: Number(field.page || 1), x: Number(field.x), y: Number(field.y), width: Number(field.width), height: Number(field.height), coordinateSpace: SIGNATURE_FIELD_COORDINATE_SPACE };
  }
  if (field.coordinateSpace != null && field.coordinateSpace !== "") throw new RangeError("The signature field coordinate space is not supported.");
  warn?.("LEGACY_SIGNATURE_FIELD_COORDINATES_CONVERTED", { fieldId: field.fieldId || null, coordinateSpace: "percent-0-100" });
  return {
    ...field,
    page: Number(field.page || 1),
    x: Number(field.x ?? 0) / 100,
    y: Number(field.y ?? 0) / 100,
    width: Number(field.width ?? 0) / 100,
    height: Number(field.height ?? 0) / 100,
    coordinateSpace: SIGNATURE_FIELD_COORDINATE_SPACE
  };
}

export function signatureFieldFromPercent(field) {
  const { coordinateSpace: _coordinateSpace, ...percentField } = field || {};
  return normalizeSignatureField(percentField);
}

export function signatureFieldToPercent(field, options) {
  const canonical = normalizeSignatureField(field, options);
  const { coordinateSpace: _coordinateSpace, ...percentField } = canonical;
  return { ...percentField, x: canonical.x * 100, y: canonical.y * 100, width: canonical.width * 100, height: canonical.height * 100 };
}

export function signatureFieldFromPointer(clientX, clientY, pageRect) {
  if (!pageRect || !(pageRect.width > 0) || !(pageRect.height > 0)) throw new RangeError("A measurable PDF page container is required.");
  return {
    x: Math.max(0, Math.min(1, (clientX - pageRect.left) / pageRect.width)),
    y: Math.max(0, Math.min(1, (clientY - pageRect.top) / pageRect.height))
  };
}

export function signatureFieldToPdfBox(page, field, { warn = null } = {}) {
  const canonical = normalizeSignatureField(field, { warn });
  const crop = page.getCropBox();
  const rotation = ((Number(page.getRotation?.()?.angle || 0) % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) throw new RangeError("The PDF page rotation is not supported for signature placement.");
  const swapped = rotation === 90 || rotation === 270;
  const visibleWidth = swapped ? crop.height : crop.width;
  const visibleHeight = swapped ? crop.width : crop.height;
  const left = canonical.x * visibleWidth;
  const top = canonical.y * visibleHeight;
  const width = canonical.width * visibleWidth;
  const height = canonical.height * visibleHeight;
  if (![left, top, width, height].every(Number.isFinite) || left < 0 || top < 0 || width <= 0 || height <= 0 || left + width > visibleWidth + 0.01 || top + height > visibleHeight + 0.01) {
    throw new RangeError("The signature field is outside the visible PDF page.");
  }
  if (rotation === 0) return { x: crop.x + left, y: crop.y + crop.height - top - height, width, height, rotation };
  if (rotation === 90) return { x: crop.x + top, y: crop.y + left, width: height, height: width, rotation };
  if (rotation === 180) return { x: crop.x + crop.width - left - width, y: crop.y + top, width, height, rotation };
  return { x: crop.x + crop.width - top - height, y: crop.y + crop.height - left - width, width: height, height: width, rotation };
}

export function signatureFieldCss(field, options) {
  const canonical = normalizeSignatureField(field, options);
  return {
    left: (canonical.x * 100) + "%",
    top: (canonical.y * 100) + "%",
    width: (canonical.width * 100) + "%",
    height: (canonical.height * 100) + "%"
  };
}
