export const SUPPORTED_SIGNATURE_ROUTING_MODES = Object.freeze(["Sequential", "Parallel"]);

export function requireSupportedSignatureRoutingMode(value) {
  const mode = String(value || "Sequential").trim();
  if (!SUPPORTED_SIGNATURE_ROUTING_MODES.includes(mode)) {
    throw new Error("This Signature Portal routing mode is not yet supported. Select Sequential or Parallel.");
  }
  return mode;
}
