import test from "node:test";
import assert from "node:assert/strict";
import {
  findBillingDependencyViolations,
  findBillingImportViolations
} from "../scripts/check-no-billing-deps.mjs";

test("billing dependency audit permits browser SDKs and Firebase CLI tooling", () => {
  const manifest = {
    dependencies: { firebase: "^11.0.0", react: "^19.0.0" },
    devDependencies: { "firebase-tools": "^15.0.0", vite: "^7.0.0" }
  };
  const lockfile = {
    packages: {
      "": {
        dependencies: { firebase: "^11.0.0", react: "^19.0.0" },
        devDependencies: { "firebase-tools": "^15.0.0", vite: "^7.0.0" }
      }
    }
  };
  assert.deepEqual(findBillingDependencyViolations(manifest, lockfile), []);
});

test("billing dependency audit rejects Functions and Google Cloud runtime packages", () => {
  const manifest = {
    dependencies: { "firebase-functions": "^6.0.0" },
    devDependencies: { "@google-cloud/functions-framework": "^3.0.0" }
  };
  const lockfile = {
    packages: {
      "": {
        dependencies: { "firebase-admin": "^13.0.0" },
        devDependencies: { "@google-cloud/cloudbuild": "^4.0.0" }
      }
    }
  };
  assert.deepEqual(findBillingDependencyViolations(manifest, lockfile), [
    "@google-cloud/cloudbuild",
    "@google-cloud/functions-framework",
    "firebase-admin",
    "firebase-functions"
  ]);
});

test("billing dependency audit rejects server SDK imports from browser source", () => {
  const source = [
    'import { onCall } from "firebase-functions/v2/https";',
    'const admin = require("@google-cloud/functions-framework");'
  ].join("\n");
  assert.equal(findBillingImportViolations(source).length, 2);
});
