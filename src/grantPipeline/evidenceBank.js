/** Verified IRPA statements only; add items only when supported by source records. */
export const evidenceBank = Object.freeze([
  { id: "irpa-name", claim: "IRPA's registered name is Improvement of Rangeland in Pastoral Areas (IRPA).", value: "Improvement of Rangeland in Pastoral Areas (IRPA)", source: "IRPA organisational details supplied by the organisation", verified: true },
  { id: "irpa-registration", claim: "IRPA was registered on 11 December 2023 under registration number 00NGO/R/5491.", value: "Registered 11 December 2023; registration number 00NGO/R/5491", source: "IRPA registration details supplied by the organisation", verified: true },
  { id: "irpa-geography", claim: "IRPA is based in Tanzania.", value: "Tanzania", source: "IRPA organisational profile supplied by the organisation", verified: true },
  { id: "irpa-address", claim: "IRPA's address is Sokoine Road, House No. 1, Longido, Arusha, Tanzania.", value: "Sokoine Road, House No. 1, Longido, Arusha, Tanzania", source: "IRPA contact details supplied by the organisation", verified: true },
  { id: "irpa-pillars", claim: "IRPA's programme pillars include sustainable rangeland management, livestock development and market development.", value: "Sustainable Rangeland Management; Livestock Development; Market Development", source: "IRPA strategic programme information supplied by the organisation", verified: true },
  { id: "irpa-no-project-track-record", claim: "IRPA has not yet implemented projects.", value: "No implemented projects reported", source: "Latest organisational status supplied by the organisation", verified: true }
]);
const normalize = value => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
export function substantiateClaims(claims = [], bank = evidenceBank) {
  return claims.map(item => {
    const claim = typeof item === "string" ? item : item.claim;
    const ids = typeof item === "string" ? [] : (item.evidenceIds || []);
    const evidence = bank.filter(entry => entry.verified && ids.includes(entry.id));
    const supported = evidence.some(entry => normalize(claim) === normalize(entry.claim) || normalize(claim) === normalize(entry.value));
    return { claim, evidence: supported ? evidence : [], supported, text: supported ? claim : `[EVIDENCE NEEDED] ${claim}` };
  });
}
export default evidenceBank;
