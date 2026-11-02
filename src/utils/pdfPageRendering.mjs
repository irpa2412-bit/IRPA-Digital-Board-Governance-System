export async function renderPdfPageToCanvas(pdf, pageNumber, canvas, {
  zoom = 1,
  maxWidth = 760,
  maxPixels = 4000000,
  maxSide = 4096
} = {}) {
  if (!pdf || !canvas) throw new TypeError("A loaded PDF and canvas are required.");
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const cssScale = Math.max(0.35, Math.min(1.8, maxWidth / base.width)) * zoom;
  const viewport = page.getViewport({ scale: cssScale });
  const requestedDpr = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
  const areaScale = Math.sqrt(maxPixels / Math.max(1, viewport.width * viewport.height));
  const sideScale = Math.min(maxSide / viewport.width, maxSide / viewport.height);
  const outputScale = Math.max(0.5, Math.min(requestedDpr, areaScale, sideScale));
  const pixelWidth = Math.max(1, Math.floor(viewport.width * outputScale));
  const pixelHeight = Math.max(1, Math.floor(viewport.height * outputScale));

  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser could not allocate a 2D PDF canvas context.");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, pixelWidth, pixelHeight);

  const renderTask = page.render({
    canvasContext: context,
    viewport,
    transform: [outputScale, 0, 0, outputScale, 0, 0]
  });
  await renderTask.promise;

  const textContent = await page.getTextContent();
  const textCharacters = (textContent.items || []).reduce(
    (total, item) => total + String(item.str || "").length,
    0
  );
  const pixels = context.getImageData(0, 0, pixelWidth, pixelHeight).data;
  let nonWhitePixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250) nonWhitePixels += 1;
  }
  const totalPixels = pixelWidth * pixelHeight;
  const nonBlankPixelRatio = totalPixels ? nonWhitePixels / totalPixels : 0;
  if (textCharacters === 0 && nonWhitePixels === 0) {
    const error = new Error("Blank page: PDF.js rendered no non-white pixels and extracted no text items.");
    error.name = "BlankPageError";
    throw error;
  }
  return {
    pageNumber,
    width: viewport.width,
    height: viewport.height,
    pixelWidth,
    pixelHeight,
    outputScale,
    textCharacters,
    nonWhitePixels,
    nonBlankPixelRatio
  };
}

export function describePdfPageError(error) {
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || error || "Unknown PDF page rendering error.")
  };
}
