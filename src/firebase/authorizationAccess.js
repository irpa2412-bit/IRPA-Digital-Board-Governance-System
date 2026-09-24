// Browser-safe projection of the central Authorization policy.
// This is a dashboard/navigation projection only. It is NOT a security boundary;
// Firestore rules and the trusted backend remain authoritative.
const ROLE_PERMISSIONS = Object.freeze({
  "Director Internal Oversight":["authorization.permission.view","authorization.permission.grant","authorization.permission.revoke","resolution.view","reports.view"],
  "Internal Oversight Officer":["authorization.permission.view","resolution.view","reports.view"],
  "Director Human Resources":["member.create","member.update","member.remove","reports.view"],
  "HR Manager":["member.create","member.update","reports.view"],
  "Director Finance & Administration":["finance.view","finance.create","finance.approve","reports.view","document.view"],
  "Finance Manager":["finance.view","finance.create","reports.view","document.view"],
  "Programme/Technical Officer":["meeting.create","meeting.edit","meeting.view","document.create","document.edit","document.view","reports.create","reports.view"],
  "Operations Manager":["meeting.create","meeting.edit","meeting.view","document.view","reports.create","reports.view"],
  "Executive Director":["authorization.permission.view","meeting.view","resolution.view","resolution.approve","document.view","document.sign","signature.sign","finance.view","finance.approve","reports.view","reports.create"],
  "Director Livestock":["document.create","document.edit","document.view","meeting.view","reports.create","reports.view"],
  "Director Environment":["document.create","document.edit","document.view","meeting.view","reports.create","reports.view"],
  "Director Outreach":["meeting.view","document.create","document.edit","document.view","reports.create","reports.view"],
  "Director Community Development":["meeting.view","document.create","document.edit","document.view","reports.create","reports.view"],
  "Field Department":["meeting.view","document.view","reports.create","reports.view"]
});

const MODULE_PERMISSIONS = Object.freeze({
  "Meetings":["meeting.view","meeting.create","meeting.edit"],
  "Meeting Room":["meeting.view","meeting.create","meeting.edit"],
  "Participants":["meeting.view"],
  "Resolutions":["resolution.view","resolution.approve"],
  "Voting":["voting.cast","voting.close"],
  "Actions":["meeting.view"],
  "Documents":["document.view","document.create","document.edit","document.sign"],
  "Signature Platform":["signature.sign","signature.revoke"],
  "Authorization & Approvals":["authorization.permission.view","authorization.permission.grant","authorization.permission.revoke"],
  "Finance Portfolio":["finance.view","finance.create","finance.approve"],
  "Reports":["reports.view","reports.create"],
  "Members & Personnel":["member.create","member.update","member.remove"],
  "Board Members Registration":["member.create","member.update"],
  "Risk Register":["reports.view"],
  "Employee Payments":["finance.view"],
  "Procurement":["finance.view","finance.create"]
});

function roleValues(value){
  if(Array.isArray(value)) return value.flatMap(roleValues);
  return String(value||"").split(",").map(x=>x.trim()).filter(Boolean);
}

export function getProjectedPermissions(profile={},employee={},admin=false){
  if(admin) return ["*"];
  const roles=[...new Set([
    ...roleValues(profile?.roles),...roleValues(profile?.role),
    ...roleValues(employee?.roles),...roleValues(employee?.role)
  ])];
  const set=new Set();
  for(const role of roles) for(const permission of ROLE_PERMISSIONS[role]||[]) set.add(permission);
  return [...set].sort();
}

export function moduleHasProjectedAccess(module,permissions=[]){
  if(permissions.includes("*")) return true;
  const required=MODULE_PERMISSIONS[module]||[];
  return required.length===0 || required.some(permission=>permissions.includes(permission));
}

export function getProjectedAccessSummary(permissions=[]){
  return Object.entries(MODULE_PERMISSIONS)
    .filter(([module])=>moduleHasProjectedAccess(module,permissions))
    .map(([module])=>module);
}
