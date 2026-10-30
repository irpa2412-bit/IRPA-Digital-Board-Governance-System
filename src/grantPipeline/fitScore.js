const arr = value => Array.isArray(value) ? value : [];
const norm = value => String(value ?? "").trim().toLowerCase();
const overlap = (left, right) => arr(left).filter(item => arr(right).some(other => norm(item) === norm(other)));
const result = (score, max, reason, details = {}) => ({ score, max, reason, ...details });

/** Deterministic 0–100 fit score; unknown inputs receive partial, not full, credit. */
export function scoreFit(call = {}, profile = {}, options = {}) {
  const profilePillars = arr(profile.pillars).map(p => typeof p === "string" ? p : p.id);
  const callPillars = arr(call.pillars);
  const matched = overlap(callPillars, profilePillars);
  const primary = norm(call.primaryPillar);
  const primaryMatch = Boolean(primary && profilePillars.some(id => norm(id) === primary));
  const secondaryMatches = matched.filter(id => norm(id) !== primary);
  const pillarPoints = Math.min(35, (primaryMatch ? 25 : 0) + Math.min(10, secondaryMatches.length * 5));
  const pillarMatch = result(pillarPoints, 35, matched.length ? `Matched pillars: ${matched.join(", ")}.` : "No direct pillar match established.", { primaryMatch, secondaryMatches });

  const countries = arr(profile.geography);
  const allowed = arr(call.eligibleCountries);
  const geoMatch = !allowed.length || allowed.some(c => /global|worldwide|all countries/i.test(c) || countries.some(p => norm(p) === norm(c)));
  const geography = result(countries.length ? (geoMatch ? 15 : 0) : 7, 15,
    !countries.length ? "Profile geography unknown; partial score only." : geoMatch ? "Call geography includes IRPA's recorded geography." : "Call geography excludes the recorded geography.");

  const capacity = profile.budgetCapacity || {};
  const min = Number(call.minimumBudget), max = Number(call.maximumBudget);
  const sizeKnown = capacity.minimum != null || capacity.maximum != null;
  let sizePoints = 7, sizeReason = "Call size or IRPA capacity incomplete; partial score only.";
  if (sizeKnown && (Number.isFinite(min) || Number.isFinite(max))) {
    const fits = (!Number.isFinite(min) || Number(capacity.maximum) >= min) && (!Number.isFinite(max) || Number(capacity.minimum) <= max);
    sizePoints = fits ? 15 : 0; sizeReason = fits ? "Funding range overlaps recorded capacity." : "Funding range does not overlap recorded capacity.";
  } else if (!Number.isFinite(min) && !Number.isFinite(max)) { sizePoints = 10; sizeReason = "Call has no stated size restriction."; }
  const size = result(sizePoints, 15, sizeReason);

  const now = options.now ? new Date(options.now) : new Date();
  const deadline = call.deadline ? new Date(call.deadline) : null;
  let deadlinePoints = 5, deadlineReason = "Deadline missing or invalid; partial score only.";
  if (deadline && !Number.isNaN(deadline.getTime())) {
    const days = (deadline.getTime() - now.getTime()) / 86400000;
    deadlinePoints = days <= 0 ? 0 : days >= 21 ? 15 : days >= 7 ? 10 : 5;
    deadlineReason = days <= 0 ? "Deadline has passed." : `${Math.ceil(days)} days remain; score reflects preparation time.`;
  }
  const deadlineFeasibility = result(deadlinePoints, 15, deadlineReason);

  const criteria = arr(call.donorCriteria);
  const matches = overlap(criteria, arr(profile.donorCriteria));
  const donorCriteria = result(criteria.length ? Math.round(10 * matches.length / criteria.length) : 5, 10,
    criteria.length ? `${matches.length} of ${criteria.length} donor criteria matched.` : "Donor criteria not supplied; partial score only.");
  const risk = norm(call.competitionRisk);
  const competitionRisk = result(risk === "low" ? 10 : risk === "medium" ? 7 : risk === "high" ? 3 : 5, 10,
    risk ? `Competition risk recorded as ${risk}.` : "Competition risk unknown; partial score only.");

  const breakdown = { pillarMatch, geography, size, deadlineFeasibility, donorCriteria, competitionRisk };
  const score = Object.values(breakdown).reduce((sum, item) => sum + item.score, 0);
  return { score: Math.max(0, Math.min(100, score)), maximum: 100, breakdown };
}
export default scoreFit;
