const assert = require("node:assert/strict");

const index = require("./index");
const authorizationFunctions = require("./authorizationFunctions");

const expectedExisting = [
  "bootstrapPrimaryAdministrator",
  "createAdministrator",
  "listAdministrators",
  "removeAdministrator",
  "resetTrialData"
];

const expectedAuthorization = [
  "authorizeAction",
  "grantAuthorizationPermission",
  "revokeAuthorizationPermission",
  "getEffectiveAuthorizationPermissions"
];

for (const name of expectedExisting) {
  assert.equal(typeof index[name], "function", `Existing callable export missing: ${name}`);
}

for (const name of expectedAuthorization) {
  assert.equal(typeof authorizationFunctions[name], "function", `Authorization callable missing from isolated module: ${name}`);
  assert.equal(typeof index[name], "function", `Authorization callable not registered in Functions index: ${name}`);
  assert.strictEqual(index[name], authorizationFunctions[name], `Authorization callable reference mismatch: ${name}`);
}

const authorizationNames = new Set(expectedAuthorization);
assert.equal(authorizationNames.size, expectedAuthorization.length, "Authorization callable names must be unique.");

console.log("Authorization Functions integration boundary passed.", {
  existingExportsVerified: expectedExisting.length,
  authorizationExportsVerified: expectedAuthorization.length
});
