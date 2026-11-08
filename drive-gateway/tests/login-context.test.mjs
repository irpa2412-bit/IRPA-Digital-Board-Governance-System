import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthenticatedLoginContext, createLoginContextRoute } from "../src/loginContext.mjs";

function document(id, fields) {
  return { name: `projects/staging/databases/(default)/documents/${id}`, fields };
}
const plain = value => value?.fields || null;

test("login context combines active Member and Employee records for a dual-role identity", () => {
  const result = buildAuthenticatedLoginContext({
    uid: "uid-1", email: "daniel@example.test",
    firebaseClaims: { admin: true, irpaRoles: ["Executive Director"] },
    adminDocument: document("adminProfiles/uid-1", { active: true, email: "daniel@example.test" }),
    memberDocuments: [document("members/member-1", { status: "Active", role: "Board Member", boardPosition: "Board Secretary" })],
    employeeDocuments: [document("employees/employee-1", { uid: "uid-1", status: "Active", role: "Executive Director", department: "Executive Office" })],
    toPlain: plain
  });
  assert.equal(result.ok, true);
  assert.equal(result.uid, "uid-1");
  assert.equal(result.administrator.active, true);
  assert.equal(result.member.id, "member-1");
  assert.equal(result.employee.id, "employee-1");
  assert.equal(result.identityResolution, "UID");
  assert.ok(result.roles.includes("Administrator"));
  assert.ok(result.roles.includes("Executive Director"));
  assert.ok(result.authorities.some(item => item.role === "Board Secretary"));
  assert.ok(result.authorities.some(item => item.role === "Executive Director"));
});

test("inactive institutional records do not create authorities", () => {
  const result = buildAuthenticatedLoginContext({
    uid: "uid-2", email: "inactive@example.test",
    memberDocuments: [document("members/member-2", { status: "Suspended", role: "Board Member" })],
    employeeDocuments: [document("employees/employee-2", { employmentStatus: "Inactive", role: "Finance Manager" })],
    toPlain: plain
  });
  assert.equal(result.member, null);
  assert.equal(result.employee, null);
  assert.deepEqual(result.roles, []);
  assert.deepEqual(result.authorities, []);
  assert.equal(result.identityResolution, "NONE");
});

test("configured claims and register roles are de-duplicated by authority ID", () => {
  const result = buildAuthenticatedLoginContext({
    uid: "uid-3", email: "member@example.test",
    firebaseClaims: { irpaRoles: ["Finance Manager"] },
    memberDocuments: [document("members/member-3", { status: "Active", role: "Finance Manager", department: "Finance" })],
    toPlain: plain
  });
  assert.equal(result.authorities.filter(item => item.role === "Finance Manager").length, 1);
  assert.equal(result.authorities[0].source, "Gateway Configuration");
});

test("login context route returns 401 when Firebase authentication fails", async () => {
  const route = createLoginContextRoute({
    authenticateFirebaseRequest: async () => { throw new Error("Firebase authentication is required."); },
    getFirestoreAdminAccessToken: async () => "unused",
    getFirestoreDocument: async () => null,
    getFirestoreDocumentsByField: async () => [],
    firestoreDocumentToPlain: plain,
    json: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    corsHeaders: () => ({})
  });
  await assert.rejects(() => route(new Request("https://gateway.test/api/auth/login-context", { method: "POST" }), {}), /Firebase authentication is required/);
});

test("login context route resolves linked administrator Employee record and uses server-side Firestore identity", async () => {
  const calls = [];
  const route = createLoginContextRoute({
    authenticateFirebaseRequest: async (_request, _env, options) => {
      assert.equal(options.skipActivation, true);
      return { user_id: "admin-uid", email: "admin@example.test", firebaseClaims: { admin: true, name: "Admin Name" } };
    },
    getFirestoreAdminAccessToken: async () => "server-token",
    getFirestoreDocument: async (_env, path, token) => {
      assert.equal(token, "server-token");
      if (path === "adminProfiles/admin-uid") return document("adminProfiles/admin-uid", { active: true, name: "Admin Name" });
      return null;
    },
    getFirestoreDocumentsByField: async (_env, collection, field, value, token, limit) => {
      calls.push({ collection, field, value, token, limit });
      if (collection === "employees" && field === "administratorUid") return [document("employees/linked-employee", { uid: "different-uid", administratorUid: "admin-uid", status: "Active", role: "Executive Director" })];
      return [];
    },
    firestoreDocumentToPlain: plain,
    json: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    corsHeaders: () => ({})
  });
  const response = await route(new Request("https://gateway.test/api/auth/login-context", { method: "POST" }), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.identityResolution, "ADMINISTRATOR_LINK");
  assert.equal(body.employee.id, "linked-employee");
  assert.ok(calls.some(item => item.field === "administratorUid" && item.limit === 10));
});
