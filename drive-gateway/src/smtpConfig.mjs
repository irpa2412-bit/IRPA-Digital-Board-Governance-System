import { normalizeRecipientEmail } from "./mailDelivery.js";

export function resolveSmtpConfig(env={},defaults={host:"mail.irpa.or.tz",port:465,from:"info@irpa.or.tz"}) {
  const host=String(env.SMTP_HOST||defaults.host||"").trim();
  const port=Number(env.SMTP_PORT||defaults.port||465);
  const from=normalizeRecipientEmail(env.SMTP_FROM||defaults.from||"");
  const username=normalizeRecipientEmail(env.SMTP_USERNAME||from);
  if(!host||!Number.isInteger(port)||port<1||port>65535)throw new Error("IRPA SMTP host or port configuration is invalid.");
  return {host,port,from,username};
}
