/**
 * Canonical, editable IRPA profile used by grant screening.
 * Empty values are intentional: do not infer organisational capacity or history.
 */
export const IRPA_PILLARS = Object.freeze([
  { id: "rangeland", name: "Sustainable Rangeland Management and Climate Resilience" },
  { id: "livestock", name: "Livestock Development" },
  { id: "market", name: "Market Development" },
  { id: "crossCutting", name: "Cross-Cutting Themes" },
  { id: "institutional", name: "Institutional Development" }
]);

export const irpaProfile = {
  organisationName: "Improvement of Rangeland in Pastoral Areas (IRPA)",
  legalStatus: {
    status: "Registered",
    registrationDate: "2023-12-11",
    registrationNumber: "00NGO/R/5491",
    registeringMinistry: "Ministry of Community Development, Gender, Women and Special Groups"
  },
  yearsOfOperation: null,
  geography: ["Tanzania"],
  budgetCapacity: { minimum: null, maximum: null, currency: "TZS", notes: "" },
  partners: [],
  trackRecord: [],
  pillars: IRPA_PILLARS.map(pillar => ({ ...pillar, evidence: "" }))
};

export default irpaProfile;
