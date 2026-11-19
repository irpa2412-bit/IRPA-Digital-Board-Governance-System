// Resolve the production Gateway SMTP transport from deployment bindings.
// Credentials remain Cloudflare secrets and are never included in diagnostics.
const DEFAULTS = Object.freeze({ host: "mail.irpa.or.tz", port: 465, from: "info@irpa.or.tz" });

export function resolveSmtpConfiguration(env = {}) {
  const host = String(env.SMTP_HOST || DEFAULTS.host).trim();
  const port = Number(env.SMTP_PORT || DEFAULTS.port);
  const from = String(env.SMTP_FROM || DEFAULTS.from).trim();
  const username = String(env.SMTP_USERNAME || from).trim();
  const password = String(env.SMTP_PASSWORD || "");
  if (!host || /[\\r\\n]/.test(host)) throw new Error("IRPA SMTP host configuration is invalid.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("IRPA SMTP port configuration is invalid.");
  if (!/^[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+$/.test(from) || /[\\r\\n]/.test(from)) throw new Error("IRPA SMTP sender configuration is invalid.");
  if (!username || /[\\r\\n<>]/.test(username)) throw new Error("IRPA SMTP username configuration is invalid.");
  return { host, port, from, username, password };
}
