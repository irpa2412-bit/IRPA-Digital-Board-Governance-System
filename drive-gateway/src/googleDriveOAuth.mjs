/**
 * Build the Google Drive OAuth authorization parameters.
 *
 * Deliberately omit login_hint: Google documents that it can suppress the
 * account chooser. We must let the administrator explicitly select the
 * authorized IRPA Google account, then validate the account returned by
 * Google during the callback.
 */
export function buildGoogleDriveAuthorizationParams({ clientId, redirectUri, scope, state }) {
  return new URLSearchParams({
    client_id: String(clientId || ""),
    redirect_uri: String(redirectUri || ""),
    response_type: "code",
    access_type: "offline",
    prompt: "select_account consent",
    include_granted_scopes: "true",
    scope: String(scope || ""),
    state: String(state || "")
  });
}
