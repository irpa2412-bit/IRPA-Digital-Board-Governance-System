const clean = value => String(value ?? "").trim().toLowerCase();
const millis = value => {
  if (value == null || value === "") return NaN;
  return (value instanceof Date ? value : new Date(value)).getTime();
};
const identity = call => clean(call.applicationUrl || call.url) || clean(call.id) || `${clean(call.donor || call.funder)}|${clean(call.title)}`;

export function filterValidCalls(calls = [], options = {}) {
  const now = options.now ? millis(options.now) : Date.now();
  const seen = new Set(), kept = [], closed = [], duplicates = [];
  for (const call of calls) {
    const deadline = millis(call.deadline ?? call.deadlineAt ?? call.deadline_at);
    const explicitlyClosed = ["closed", "expired", "cancelled", "canceled"].includes(clean(call.status));
    if (explicitlyClosed || (Number.isFinite(deadline) && deadline <= now)) {
      closed.push({ ...call, status: "CLOSED", closedReason: explicitlyClosed ? "Source marks call closed." : "Deadline has passed." });
      continue;
    }
    if (!["open", "upcoming"].includes(clean(call.status))) continue;
    const key = identity(call);
    if (!key || seen.has(key)) { duplicates.push({ ...call, duplicateOf: key || null }); continue; }
    seen.add(key); kept.push(call);
  }
  return { calls: kept, closed, duplicates };
}
export default filterValidCalls;
