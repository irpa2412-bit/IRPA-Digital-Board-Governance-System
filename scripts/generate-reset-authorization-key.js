#!/usr/bin/env node
"use strict";

// Generate a high-entropy reset authorization for out-of-band provisioning.
// This script deliberately does not write the value to disk, Git, logs, or Firebase.
const crypto = require("node:crypto");

const key = crypto.randomBytes(48).toString("base64url");
process.stdout.write(
  "IRPA_RESET_DEVELOPER_SECRET (copy once; do not commit or send in chat):\n" +
  key +
  "\n\nNext: store this exact value in Firebase Secret Manager as " +
  "IRPA_RESET_DEVELOPER_SECRET, deploy the Functions that bind the secret, " +
  "then deliver the value to the authorized administrator through a separate trusted channel.\n"
);
