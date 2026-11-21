import { buildMailMimeMessage, normalizeRecipientEmail } from "./mailDelivery.js";
import { validateRecipient } from "./invitationEmail.mjs";

export function buildSmtpRecipientEnvelope({from,to,subject,text,html,attachments=[]}) {
  const typedRecipient=validateRecipient(to);
  if(!typedRecipient)throw new Error("A valid single signer recipient email address is required.");
  const recipient=normalizeRecipientEmail(typedRecipient);
  const mime=buildMailMimeMessage({from,to:recipient,subject,text,html,attachments});
  return {recipient,rcptCommand:"RCPT TO:<"+recipient+">",toHeader:"<"+recipient+">",mime};
}
