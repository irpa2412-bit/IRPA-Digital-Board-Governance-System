"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const publicKey = process.env.IRPA_MEMBER_AUDIT_REPORT_PUBLIC_KEY;
function loadKey() {
  if (!publicKey) throw new Error("OWNER_REPORT_PUBLIC_KEY_NOT_CONFIGURED");
  let key; try { key = crypto.createPublicKey(publicKey); } catch { throw new Error("OWNER_REPORT_PUBLIC_KEY_INVALID"); }
  if (key.asymmetricKeyType !== "rsa" || Number(key.asymmetricKeyDetails && key.asymmetricKeyDetails.modulusLength || 0) < 3072) throw new Error("OWNER_REPORT_PUBLIC_KEY_MUST_BE_RSA_3072_OR_STRONGER");
  return key;
}
try {
  const key = loadKey();
  if (process.argv.includes("--check")) { process.stdout.write("OWNER_REPORT_PUBLIC_KEY_VALID\n"); process.exit(0); }
  const input = path.resolve(process.argv[2] || "reports/member-account-compatibility-dry-run.json");
  const output = path.resolve(process.argv[3] || input.replace(/\.json$/, ".enc.json"));
  try {
    const plaintext = fs.readFileSync(input);
    const aesKey = crypto.randomBytes(32), iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrappedKey = crypto.publicEncrypt({key, oaepHash:"sha256", padding:crypto.constants.RSA_PKCS1_OAEP_PADDING}, aesKey);
    const envelope = {schemaVersion:1, algorithm:"RSA-OAEP-SHA256+A256GCM", wrappedKey:wrappedKey.toString("base64"), iv:iv.toString("base64"), authTag:cipher.getAuthTag().toString("base64"), ciphertext:ciphertext.toString("base64")};
    fs.writeFileSync(output, JSON.stringify(envelope) + "\n", {mode:0o600, flag:"wx"});
    process.stdout.write("ENCRYPTED_OWNER_REPORT_CREATED\n");
  } finally { try { fs.rmSync(input, {force:true}); } catch {} }
} catch (e) {
  const code = String(e && e.message || "ENCRYPTION_FAILED").replace(/[^A-Z0-9_:-]/gi, "_").slice(0,100);
  process.stderr.write("OWNER_REPORT_ENCRYPTION_FAILED=" + code + "\n"); process.exit(1);
}
