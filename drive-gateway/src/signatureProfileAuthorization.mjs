export function canProvisionSignatureProfileFolder({ authenticatedUid, requestedUid, isAdmin = false } = {}) {
  const actor = String(authenticatedUid || "").trim();
  const target = String(requestedUid || "").trim();
  if (!actor || !target) return false;
  return isAdmin === true || actor === target;
}
