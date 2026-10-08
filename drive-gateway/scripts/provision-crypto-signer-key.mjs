#!/usr/bin/env node
import { spawn } from "node:child_process";
import { webcrypto } from "node:crypto";

const [signerUid, keyId = "IRPA-ESIGN-001", envName] = process.argv.slice(2);
if (!signerUid) {
  console.error("Usage: node scripts/provision-crypto-signer-key.mjs <signerUid> [keyId] [staging]");
  process.exit(2);
}
if (!/^[A-Za-z0-9._:-]{1,128}$/.test(signerUid)) {
  console.error("Invalid signer UID.");
  process.exit(2);
}

const subtle = webcrypto.subtle;
const pair = await subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey));
const publicKeyJwk = await subtle.exportKey("jwk", pair.publicKey);
const digest = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(signerUid)));
const hex = [...digest].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32).toUpperCase();
const secretName = "IRPA_CRYPTO_KEY_" + hex;
let binary = "";
for (let i = 0; i < pkcs8.length; i += 0x8000) binary += String.fromCharCode(...pkcs8.subarray(i, i + 0x8000));
const secretValue = JSON.stringify({
  version: 1,
  keyId: String(keyId),
  privateKeyPkcs8: Buffer.from(binary, "binary").toString("base64"),
  publicKeyJwk: {
    kty: publicKeyJwk.kty,
    crv: publicKeyJwk.crv,
    x: publicKeyJwk.x,
    y: publicKeyJwk.y,
    ext: true,
  },
});

const args = ["wrangler", "secret", "put", secretName];
if (envName) args.push("--env", envName);
const child = spawn("npx", args, {
  stdio: ["pipe", "inherit", "inherit"],
  shell: process.platform === "win32",
});
child.stdin.end(secretValue);
const code = await new Promise(resolve => child.on("close", resolve));
if (code !== 0) process.exit(code || 1);

console.log("Provisioned signer key secret:", secretName);
console.log("Signer UID:", signerUid);
console.log("Key ID:", keyId);
console.log("Private key material was generated in memory and was not written to disk.");
