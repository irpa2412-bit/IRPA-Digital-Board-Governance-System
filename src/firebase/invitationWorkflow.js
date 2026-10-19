import { auth } from "./config";
import { resolveGatewayUrl } from "./gatewayEnvironment";

export async function provisionCurrentMemberFromInvitationV2(invitationId) {
  const id = String(invitationId || "").trim();
  const user = auth.currentUser;
  if (!id) throw new Error("An invitation record is required.");
  if (!user?.uid || !user.email) throw new Error("Sign in with the email address assigned to this invitation.");

  const token = await user.getIdToken(true);
  let response;
  try {
    response = await fetch(resolveGatewayUrl() + "/api/invitations/activate", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId: id })
    });
  } catch {
    throw new Error("IRPA could not reach the invitation activation service. Your invitation remains available. Please try again.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) {
    throw new Error(result.error || "The server could not activate this invitation.");
  }
  return result;
}
