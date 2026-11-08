const INACTIVE_STATUSES = new Set(["inactive", "disabled", "suspended", "expired", "revoked"]);

function normalized(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function splitRoles(values) {
  return values.flatMap(value => String(value || "").split(",").map(item => item.trim()).filter(Boolean));
}

function recordId(document) {
  return String(document?.name || "").split("/").pop() || "";
}

function pathwayFor(role, record) {
  const normalizedRole = normalized(role);
  const department = normalized(record?.department);
  if (normalizedRole === "administrator" || normalizedRole === "executive director") return "Executive Office Department";
  if (normalizedRole.includes("internal oversight")) return "Internal Oversight Department";
  if (normalizedRole.includes("finance")) return "Finance & Administration Department";
  if (normalizedRole.includes("human resources") || normalizedRole.startsWith("hr ")) return "Human Resources Department";
  if (normalizedRole.includes("livestock")) return "Livestock Department";
  if (normalizedRole.includes("environment") || normalizedRole.includes("rangeland")) return "Environment & Rangeland Department";
  if (normalizedRole.includes("outreach") || normalizedRole.includes("community development")) return "Outreach & Community Development Department";
  if (normalizedRole.includes("field")) return "Field Operations Department";
  if (normalizedRole.includes("procurement")) return "Finance & Administration Department · Procurement Unit";
  if (normalizedRole === "it" || normalizedRole.includes("information technology")) return "Information Technology Department";
  if (department) return String(record?.department || "").trim() + " Department";
  return "Institutional Governance Workspace";
}

function configuredPathwayFor(role) {
  const normalizedRole = normalized(role);
  if (normalizedRole === "administrator" || normalizedRole === "executive director") return "Executive Office Department";
  if (normalizedRole.includes("internal oversight")) return "Internal Oversight Department";
  if (normalizedRole.includes("finance")) return "Finance & Administration Department";
  if (normalizedRole.includes("human resources") || normalizedRole.startsWith("hr ")) return "Human Resources Department";
  if (normalizedRole.includes("livestock")) return "Livestock Department";
  if (normalizedRole.includes("environment") || normalizedRole.includes("rangeland")) return "Environment & Rangeland Department";
  if (normalizedRole.includes("outreach") || normalizedRole.includes("community development")) return "Outreach & Community Development Department";
  if (normalizedRole.includes("field")) return "Field Operations Department";
  if (normalizedRole.includes("procurement")) return "Finance & Administration Department · Procurement Unit";
  if (normalizedRole === "it" || normalizedRole.includes("information technology")) return "Information Technology Department";
  return "Institutional Governance Workspace";
}

export function buildAuthenticatedLoginContext({ uid, email, firebaseClaims = {}, adminDocument, memberDocuments = [], employeeDocuments = [], toPlain }) {
  const clean = document => document ? { id: recordId(document), ...(toPlain(document) || {}) } : null;
  const admin = clean(adminDocument);
  const activeRecord = record => {
    if (!record) return false;
    const status = String(record.status || record.employmentStatus || record.registrationStatus || "Active").trim().toLowerCase();
    return !INACTIVE_STATUSES.has(status);
  };
  const uniqueById = records => [...new Map(records.filter(Boolean).map(item => [
    String(item.id || item.uid || item.employeeNumber || item.email), item
  ])).values()];
  const members = uniqueById(memberDocuments.map(clean)).filter(activeRecord);
  const employees = uniqueById(employeeDocuments.map(clean)).filter(activeRecord);
  const employee = employees[0] || null;
  const employeeRoles = [...new Set(employees.flatMap(record => [
    ...(Array.isArray(record?.roles) ? record.roles : []), record?.role,
    ...(Array.isArray(record?.assignedRoles) ? record.assignedRoles : []),
    ...(Array.isArray(record?.selectedRoles) ? record.selectedRoles : []),
    ...(Array.isArray(record?.roleAssignments) ? record.roleAssignments : [])
  ]).flatMap(value => splitRoles([value])))];

  const contextValues = employees.flatMap(record => [
    record?.department, record?.unit, record?.jobTitle, record?.position, record?.title, record?.designation
  ]).map(normalized).filter(Boolean);
  if (
    contextValues.some(value => value === "it" || value === "it unit" || value.includes("information technology") ||
      value.includes("it specialist") || value.includes("information technology officer")) &&
    !employeeRoles.some(role => ["IT Specialist", "Information Technology Officer"].includes(role))
  ) employeeRoles.push("IT Specialist");

  const configuredRoles = splitRoles(Array.isArray(firebaseClaims.irpaRoles) ? firebaseClaims.irpaRoles : []);
  if (firebaseClaims.admin === true && !configuredRoles.includes("Administrator")) configuredRoles.unshift("Administrator");
  const configuredAuthorityMap = new Map();
  configuredRoles.forEach(role => {
    const cleanRole = String(role || "").trim();
    if (!cleanRole) return;
    const authorityId = "IRPA-AUTH-" + cleanRole.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    configuredAuthorityMap.set(authorityId, {
      id: authorityId, authorityId, role: cleanRole, pathway: configuredPathwayFor(cleanRole),
      source: "Gateway Configuration", active: true
    });
  });

  const slug = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const authorityMap = new Map();
  const addAuthority = (role, record, source) => {
    const cleanRole = String(role || "").trim();
    if (!cleanRole) return;
    const suppliedId = String(record?.accessAuthorityId || record?.authorityId || "").trim();
    const authorityId = suppliedId || "IRPA-AUTH-" + slug(cleanRole) + (record?.unit ? "-" + slug(record.unit) : "");
    const existing = authorityMap.get(authorityId);
    const authority = {
      id: authorityId, authorityId, role: cleanRole, pathway: pathwayFor(cleanRole, record),
      department: record?.department || null, unit: record?.unit || null, source, active: true
    };
    authorityMap.set(authorityId, existing ? { ...existing, ...authority } : authority);
  };

  if (admin?.active === true) addAuthority("Administrator", admin, "Administrator Registry");
  members.forEach(record => {
    const values = [
      ...(Array.isArray(record?.roles) ? record.roles : []), record?.role, record?.boardPosition
    ].flatMap(value => splitRoles([value]));
    const guaranteed = values.length ? values : [String(record?.boardPosition || "Board Member").trim()];
    guaranteed.filter(Boolean).forEach(role => addAuthority(role, record, "Member Register"));
  });
  employees.forEach(record => {
    const values = [
      ...(Array.isArray(record?.roles) ? record.roles : []), record?.role,
      ...(Array.isArray(record?.assignedRoles) ? record.assignedRoles : []),
      ...(Array.isArray(record?.selectedRoles) ? record.selectedRoles : []),
      ...(Array.isArray(record?.roleAssignments) ? record.roleAssignments : [])
    ].flatMap(value => splitRoles([value]));
    const institutionalFallback = String(record?.jobTitle || record?.position || record?.title || record?.designation || record?.department || "Employee").trim();
    const guaranteed = values.length ? values : [institutionalFallback];
    guaranteed.filter(Boolean).forEach(role => addAuthority(role, record, "Employee Register"));
  });
  employeeRoles.forEach(role => addAuthority(role, employee, "Employee Register"));

  const authorities = [...configuredAuthorityMap.values(), ...authorityMap.values()]
    .filter((authority, index, list) => list.findIndex(item => String(item.authorityId) === String(authority.authorityId)) === index);

  return {
    ok: true, uid, email,
    administrator: admin?.active === true ? admin : null,
    member: members[0] || null,
    employee,
    roles: configuredRoles.length ? configuredRoles : employeeRoles,
    authorities,
    identityResolution: employee
      ? (String(employee.uid || "") === uid
        ? "UID"
        : String(employee.email || "").trim().toLowerCase() === email
          ? "EMAIL"
          : employee.administratorUid === uid || employee.adminUid === uid || employee.linkedAdministratorUid === uid
            ? "ADMINISTRATOR_LINK"
            : "UNIQUE_NAME")
      : "NONE"
  };
}

export function createLoginContextRoute(dependencies) {
  const {
    authenticateFirebaseRequest, getFirestoreAdminAccessToken, getFirestoreDocument,
    getFirestoreDocumentsByField, firestoreDocumentToPlain, json, corsHeaders
  } = dependencies;

  return async function loginContextRoute(request, env) {
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405, corsHeaders(request));
    const claims = await authenticateFirebaseRequest(request, env, { skipActivation: true });
    const uid = String(claims?.user_id || "").trim();
    if (!uid) return json({ ok: false, error: "Authentication is required to resolve the IRPA login context." }, 401, corsHeaders(request));

    const adminToken = await getFirestoreAdminAccessToken(env);
    const [adminDocument, directMember, directEmployee] = await Promise.all([
      getFirestoreDocument(env, `adminProfiles/${uid}`, adminToken),
      getFirestoreDocument(env, `members/${uid}`, adminToken),
      getFirestoreDocument(env, `employees/${uid}`, adminToken)
    ]);
    const memberDocuments = directMember ? [directMember] : [];
    const employeeDocuments = directEmployee ? [directEmployee] : [];
    const email = String(claims.email || "").trim().toLowerCase();

    const fallbackQueries = [];
    if (email && !directMember) {
      fallbackQueries.push(
        ["member", "email", email],
        ["member", "firebaseAuthEmail", email]
      );
    }
    if (email && !directEmployee) {
      fallbackQueries.push(
        ["employee", "email", email],
        ["employee", "firebaseAuthEmail", email]
      );
    }
    if (fallbackQueries.length) {
      const results = await Promise.all(fallbackQueries.map(async ([kind, field, value]) => [
        kind, await getFirestoreDocumentsByField(env, kind === "member" ? "members" : "employees", field, value, adminToken, 10)
      ]));
      results.forEach(([kind, documents]) => {
        (kind === "employee" ? employeeDocuments : memberDocuments).push(...documents);
      });
    }

    const admin = adminDocument ? firestoreDocumentToPlain(adminDocument) : null;
    if (admin?.active === true && !employeeDocuments.length) {
      const linkedFields = ["administratorUid", "adminUid", "linkedAdministratorUid"];
      for (const field of linkedFields) {
        const matches = await getFirestoreDocumentsByField(env, "employees", field, uid, adminToken, 10);
        employeeDocuments.push(...matches);
        if (matches.length) break;
      }
      if (!employeeDocuments.length) {
        const identityName = String(admin.name || admin.details?.name || claims.firebaseClaims?.name || "").trim();
        if (identityName) {
          const matches = await getFirestoreDocumentsByField(env, "employees", "name", identityName, adminToken, 2);
          const exactMatches = matches.filter(document => {
            const record = firestoreDocumentToPlain(document) || {};
            const status = String(record.status || record.employmentStatus || record.registrationStatus || "Active").trim().toLowerCase();
            return !INACTIVE_STATUSES.has(status) && normalized(record.name) === normalized(identityName);
          });
          if (exactMatches.length === 1) employeeDocuments.push(exactMatches[0]);
        }
      }
    }

    return json(buildAuthenticatedLoginContext({
      uid, email, firebaseClaims: claims.firebaseClaims || {},
      adminDocument, memberDocuments, employeeDocuments, toPlain: firestoreDocumentToPlain
    }), 200, corsHeaders(request));
  };
}
