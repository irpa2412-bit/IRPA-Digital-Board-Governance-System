export function parseOwnerRenewalCommand(body, portalNames) {
  const text = String(body ?? "").trim();
  const approve = text.match(/^APPROVE\s+#?(\d+)\s+(.+)$/);
  if (approve) return { kind: "approve", prNumber: Number(approve[1]), reason: approve[2].trim() };
  const names = [...portalNames].sort((a, b) => b.length - a.length);
  for (const portal of names) {
    const prefix = `RENEW ${portal} `;
    if (text.startsWith(prefix)) {
      const reason = text.slice(prefix.length).trim();
      if (reason) return { kind: "renew", portal, reason };
    }
  }
  return null;
}

export function resolveOnePortalForFiles(changedFiles, registry) {
  const affected = new Set();
  for (const file of changedFiles) {
    for (const [portal, entry] of Object.entries(registry.portals)) {
      if ((entry.paths ?? []).some(path => file === path || (path.endsWith("/") && file.startsWith(path)))) affected.add(portal);
    }
    for (const shared of registry.shared ?? []) {
      if (file === shared.path || (shared.path.endsWith("/") && file.startsWith(shared.path))) {
        for (const portal of shared.portals) affected.add(portal);
      }
    }
    const record = file.match(/^docs\/portal-protection\/(?:records|windows)\/([a-z0-9-]+)\.json$/);
    if (record) {
      const match = Object.keys(registry.portals).find(name => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === record[1]);
      if (match) affected.add(match);
    }
  }
  return affected.size === 1 ? [...affected][0] : null;
}
