const asArray = value => Array.isArray(value) ? value : [];
const clean = value => String(value ?? "").trim();
const includesCountry = (allowed, country) => !allowed.length || allowed.some(value =>
  /^(global|worldwide|all countries)$/i.test(clean(value)) || clean(value).toLowerCase() === clean(country).toLowerCase());

/**
 * Structured call fields: eligibleCountries, excludedCountries, applicantTypes,
 * requiredApplicantTypes, minimumYearsOperation, minimumBudget, maximumBudget,
 * requiredDocuments. Missing profile evidence produces CONDITIONAL, not a pass.
 */
export function checkEligibility(call = {}, profile = {}) {
  const sourceText = [call.sourceText, call.eligibilityText, call.eligibility, call.requirements].filter(Boolean).join("\n").trim();
  const reasons = [];
  const missing = [];
  const add = (criterion, status, reason, evidence = "") => reasons.push({ criterion, status, reason, sourceText: evidence || sourceText });

  const countries = asArray(profile.geography);
  const allowed = asArray(call.eligibleCountries);
  if (asArray(call.excludedCountries).some(v => clean(v).toLowerCase() === "tanzania")) {
    add("geography", "fail", "Tanzania is explicitly excluded.");
  } else if (allowed.length && !includesCountry(allowed, "Tanzania")) {
    add("geography", "fail", "Tanzania is not in the stated eligible-country list.");
  } else if (!countries.length) {
    missing.push("IRPA operating geography");
    add("geography", "unknown", "IRPA geography is not recorded.");
  } else add("geography", "pass", "Tanzania is within the call's stated geography.");

  const applicantTypes = asArray(call.applicantTypes).map(v => clean(v).toLowerCase());
  const requiredTypes = asArray(call.requiredApplicantTypes).map(v => clean(v).toLowerCase());
  if (requiredTypes.length && !applicantTypes.some(type => requiredTypes.includes(type))) {
    const registeredNgo = /registered/i.test(clean(profile.legalStatus?.status)) &&
      requiredTypes.some(type => /registered ngo|ngo|non.?governmental organisation|non.?profit/i.test(type));
    if (registeredNgo) add("applicantType", "pass", "IRPA's recorded registered status meets the stated NGO applicant type.");
    else {
      missing.push("Applicant-type confirmation for this call");
      add("applicantType", "unknown", "The call's applicant-type requirement cannot be confirmed from supplied fields.");
    }
  } else add("applicantType", "pass", "No conflicting applicant-type restriction is recorded.");

  const minYears = Number(call.minimumYearsOperation);
  if (Number.isFinite(minYears) && minYears > 0) {
    const years = Number(profile.yearsOfOperation);
    if (profile.yearsOfOperation == null || !Number.isFinite(years)) {
      missing.push("IRPA years of operation");
      add("yearsOperation", "unknown", "The call requires operating-history evidence; IRPA's years-of-operation field is empty.");
    } else if (years < minYears) add("yearsOperation", "fail", `Call requires at least ${minYears} years; profile records ${years}.`);
    else add("yearsOperation", "pass", `Recorded ${years} years meets the ${minYears}-year minimum.`);
  } else add("yearsOperation", "pass", "No minimum operating-history requirement is specified.");

  const capacity = profile.budgetCapacity || {};
  const minBudget = Number(call.minimumBudget);
  const maxBudget = Number(call.maximumBudget);
  if (Number.isFinite(minBudget) || Number.isFinite(maxBudget)) {
    if (capacity.minimum == null && capacity.maximum == null) {
      missing.push("IRPA budget capacity");
      add("budgetCapacity", "unknown", "IRPA budget capacity is not recorded.");
    } else if ((Number.isFinite(minBudget) && Number(capacity.maximum) < minBudget) ||
               (Number.isFinite(maxBudget) && Number(capacity.minimum) > maxBudget)) {
      add("budgetCapacity", "fail", "Recorded budget capacity does not overlap the call's funding range.");
    } else add("budgetCapacity", "pass", "Recorded budget capacity overlaps the call's funding range.");
  } else add("budgetCapacity", "pass", "No funding-size restriction is specified.");

  const requiredDocs = asArray(call.requiredDocuments);
  const availableDocs = asArray(profile.availableDocuments);
  const missingDocs = requiredDocs.filter(doc => !availableDocs.includes(doc));
  if (missingDocs.length) {
    missing.push(...missingDocs.map(doc => `Required document: ${doc}`));
    add("documents", "unknown", `Required documents not confirmed: ${missingDocs.join(", ")}.`);
  } else add("documents", "pass", "No unconfirmed required documents are recorded.");

  const failed = reasons.some(item => item.status === "fail");
  const unknown = reasons.some(item => item.status === "unknown");
  return { status: failed ? "NOT_ELIGIBLE" : unknown ? "CONDITIONAL" : "ELIGIBLE", reasons, sourceText, missing: [...new Set(missing)] };
}
export default checkEligibility;
