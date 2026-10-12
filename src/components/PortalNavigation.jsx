import React from "react";

function sortItems(items, displayModuleName) {
  return [...new Set(items)].filter(Boolean).sort((a, b) => {
    const labelA = displayModuleName(a) || a;
    const labelB = displayModuleName(b) || b;
    return labelA.localeCompare(labelB, "en", { sensitivity: "base", numeric: true }) ||
      a.localeCompare(b, "en", { sensitivity: "base" });
  });
}

function getPortalGroupForModule(module, portalRollerGroups) {
  return portalRollerGroups.find(([parent, children]) =>
    module === parent || children.includes(module)
  ) || null;
}

function portalNavigationLabel(module, portalRollerGroups, portalLabels, displayModuleName) {
  const label = portalLabels[module] || displayModuleName(module);
  if (portalRollerGroups.some(([, children]) => children.includes(module))) {
    return "SUB-PORTAL · " + label;
  }
  return getPortalGroupForModule(module, portalRollerGroups) ? "PARENT PORTAL · " + label : label;
}

function getPortalContentItems(active, modules, portalRollerGroups, displayModuleName) {
  const group = getPortalGroupForModule(active, portalRollerGroups);
  if (group) {
    const [parent, children] = group;
    return [parent, ...sortItems(children, displayModuleName)].filter(item => modules.includes(item));
  }
  return modules.includes(active) ? [active] : [];
}

function getPageNavigationItems(active, modules, portalChildrenSet, displayModuleName) {
  // The whole-web-app Back/Next navigator lists parent portals only.
  return sortItems(modules.filter(module => !portalChildrenSet.has(module)), displayModuleName);
}

export function PageBackNextNavigation({
  active, modules, onNavigate, portalRollerGroups, portalChildrenSet, portalLabels, displayModuleName
}) {
  const items = getPageNavigationItems(active, modules, portalChildrenSet, displayModuleName);
  if (!items.length) return null;
  const activeGroup = getPortalGroupForModule(active, portalRollerGroups);
  const navigationActive = items.includes(active)
    ? active
    : (activeGroup && items.includes(activeGroup[0]) ? activeGroup[0] : active);
  const index = Math.max(0, items.indexOf(navigationActive));
  const previous = index > 0 ? items[index - 1] : null;
  const next = index < items.length - 1 ? items[index + 1] : null;
  const label = portalLabels[active] || displayModuleName(active);

  return <nav className="page-back-next-navigation" aria-label="Page Back and Next navigation">
    <button
      type="button"
      className="page-back-next-button"
      disabled={!previous}
      onClick={() => previous && onNavigate(previous)}
      aria-label={previous ? "Back to " + (portalLabels[previous] || displayModuleName(previous)) : "Back unavailable"}
    >
      <span aria-hidden="true">←</span><span>Back</span>
    </button>
    <div className="page-back-next-status" aria-live="polite">
      <span>PAGE NAVIGATION</span><strong>{label}</strong><small>{index + 1} of {items.length}</small>
    </div>
    <button
      type="button"
      className="page-back-next-button"
      disabled={!next}
      onClick={() => next && onNavigate(next)}
      aria-label={next ? "Next to " + (portalLabels[next] || displayModuleName(next)) : "Next unavailable"}
    >
      <span>Next</span><span aria-hidden="true">→</span>
    </button>
  </nav>;
}

export function WebAppNavigationRoller({
  active, modules, onNavigate, liveDay, liveDate, liveTime, mobileTimeFormat,
  onToggleTimeFormat, portalRollerGroups, portalLabels, displayModuleName
}) {
  const items = getPortalContentItems(active, modules, portalRollerGroups, displayModuleName);
  if (!items.length) return null;
  const label = portalNavigationLabel(active, portalRollerGroups, portalLabels, displayModuleName);

  return <div className="desktop-webapp-navigation-roller" aria-label="In-portal sub-portal navigation">
    <div className="webapp-navigation-live-clock" aria-label="Live date and time">
      <strong>{liveDay}</strong><span>{liveDate}</span><b>{liveTime}</b>
      <button
        type="button"
        onClick={onToggleTimeFormat}
        aria-label={"Change time format. Current format: " + mobileTimeFormat}
      >
        {mobileTimeFormat === "24h" ? "24H" : "12H"}
      </button>
    </div>
    <span className="webapp-navigation-roller-kicker">IN-PORTAL NAVIGATION</span>
    <strong>{label}</strong>
    <select
      aria-label="Navigate to a sub-portal within the current portal"
      value={active}
      onChange={event => onNavigate(event.target.value)}
    >
      {items.map((item, index) => (
        <option key={item} value={item}>
          {index === 0 ? portalNavigationLabel(item, portalRollerGroups, portalLabels, displayModuleName) : "　↳ " + portalNavigationLabel(item, portalRollerGroups, portalLabels, displayModuleName)}
        </option>
      ))}
    </select>
    <span className="webapp-navigation-roller-chevron" aria-hidden="true">⌄</span>
  </div>;
}
