export function describeUploadFailure(error) {
  const message = String(error?.message || error || "Unknown upload failure");
  const stack = String(error?.stack || "").split("\n").slice(0, 5).join("\n");
  return { message, stack };
}
