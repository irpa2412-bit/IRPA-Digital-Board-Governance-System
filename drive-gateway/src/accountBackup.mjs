const MAX_BACKUP_BYTES = 45 * 1024 * 1024;
const BACKUP_MIME = "application/vnd.irpa.account-backup+json";
const BACKUP_FOLDER_NAME = "IRPA Account Backups (Restricted)";
const BACKUP_FOLDER_KEY = "irpa:account-backup-folder:v1";

export function createAccountBackupRouter({ authenticateFirebaseRequest, getDriveAccessToken, corsHeaders, json }) {
  return async function accountBackupRouter(request, env, pathname) {
    if (!pathname.startsWith("/api/account-backup/")) return null;
    const headers = corsHeaders(request);
    if (request.method !== "POST") return json({ ok:false, error:"METHOD_NOT_ALLOWED" }, 405, headers);
    try {
      const claims = await authenticateFirebaseRequest(request, env);
      if (claims?.firebaseClaims?.admin !== true) return json({ ok:false, error:"ADMIN_REQUIRED" }, 403, headers);
      if (!env.DRIVE_KV) return json({ ok:false, error:"BACKUP_CUSTODY_REGISTRY_UNAVAILABLE" }, 503, headers);
      const custodianEmail = String(env.ACCOUNT_BACKUP_CUSTODIAN_EMAIL || env.AUTHORIZED_DRIVE_EMAIL || "").trim().toLowerCase();
      if (!custodianEmail) return json({ ok:false, error:"BACKUP_CUSTODIAN_NOT_CONFIGURED" }, 503, headers);
      const accessToken = await getDriveAccessToken(env);

      if (pathname === "/api/account-backup/provision") {
        const stored = await env.DRIVE_KV.get(BACKUP_FOLDER_KEY, "json");
        let folderId = String(stored?.folderId || "").trim();
        if (!folderId) {
          const query = "name='" + BACKUP_FOLDER_NAME.replace(/'/g, "\\'") + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
          const listResponse = await fetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(query) + "&spaces=drive&pageSize=20&fields=files(id,name,mimeType,owners(emailAddress),trashed)", { headers:{ Authorization:"Bearer " + accessToken } });
          const listed = await listResponse.json().catch(() => ({}));
          if (!listResponse.ok) return json({ ok:false, error:"BACKUP_FOLDER_DISCOVERY_FAILED" }, 502, headers);
          const existing = (listed.files || []).find(file => file.name === BACKUP_FOLDER_NAME && file.mimeType === "application/vnd.google-apps.folder" && file.trashed !== true);
          if (existing) folderId = existing.id;
          else {
            const createdResponse = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,owners(emailAddress)", {
              method:"POST",
              headers:{ Authorization:"Bearer " + accessToken, "Content-Type":"application/json" },
              body:JSON.stringify({ name:BACKUP_FOLDER_NAME, mimeType:"application/vnd.google-apps.folder", description:"Dedicated IRPA encrypted account backup custody folder. Separate from document, profile and meeting archive partitions." })
            });
            const created = await createdResponse.json().catch(() => ({}));
            if (!createdResponse.ok || !created.id) return json({ ok:false, error:"BACKUP_FOLDER_CREATION_FAILED" }, 502, headers);
            folderId = created.id;
          }
        }
        const verified = await verifyCustodianFolder(accessToken, folderId, custodianEmail);
        if (!verified.ok) return json({ ok:false, error:verified.error }, 403, headers);
        await env.DRIVE_KV.put(BACKUP_FOLDER_KEY, JSON.stringify({ folderId, folderName:BACKUP_FOLDER_NAME, custodianEmail, provisionedAt:new Date().toISOString() }));
        return json({ ok:true, provisioned:true, folderName:BACKUP_FOLDER_NAME, custodianEmail, restricted:true }, 200, headers);
      }

      const stored = await env.DRIVE_KV.get(BACKUP_FOLDER_KEY, "json");
      const folderId = String(stored?.folderId || "").trim();
      if (!folderId || stored?.folderName !== BACKUP_FOLDER_NAME || stored?.custodianEmail !== custodianEmail) {
        return json({ ok:false, error:"DEDICATED_BACKUP_DESTINATION_NOT_PROVISIONED" }, 503, headers);
      }
      const verified = await verifyCustodianFolder(accessToken, folderId, custodianEmail);
      if (!verified.ok) return json({ ok:false, error:verified.error }, 403, headers);

      if (pathname === "/api/account-backup/upload") {
        const body = await request.json().catch(() => null);
        const payload = String(body?.encryptedPayload || "");
        const digest = String(body?.sha256 || "").toLowerCase();
        const fileName = String(body?.fileName || "");
        if (!/^[a-zA-Z0-9._-]{1,120}\.enc\.json$/.test(fileName) || !/^[a-f0-9]{64}$/.test(digest) ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
          return json({ ok:false, error:"INVALID_ENCRYPTED_BACKUP_PAYLOAD" }, 400, headers);
        }
        const bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
        if (!bytes.length || bytes.length > MAX_BACKUP_BYTES) return json({ ok:false, error:"BACKUP_SIZE_OUT_OF_RANGE" }, 413, headers);
        const actualDigest = await sha256Hex(bytes);
        if (actualDigest !== digest) return json({ ok:false, error:"BACKUP_DIGEST_MISMATCH" }, 400, headers);
        const metadata = { name:fileName, mimeType:BACKUP_MIME, parents:[folderId], description:"Encrypted IRPA account backup; no plaintext account data" };
        const boundary = "irpa_backup_" + crypto.randomUUID().replace(/-/g, "");
        const head = new TextEncoder().encode("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + "\r\n--" + boundary + "\r\nContent-Type: application/octet-stream\r\n\r\n");
        const tail = new TextEncoder().encode("\r\n--" + boundary + "--");
        const multipart = new Uint8Array(head.length + bytes.length + tail.length);
        multipart.set(head); multipart.set(bytes, head.length); multipart.set(tail, head.length + bytes.length);
        const upload = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents,size", {
          method:"POST", headers:{ Authorization:"Bearer " + accessToken, "Content-Type":"multipart/related; boundary=" + boundary }, body:multipart
        });
        const uploaded = await upload.json().catch(() => ({}));
        if (!upload.ok || !uploaded.id || !(uploaded.parents || []).includes(folderId) || uploaded.name !== fileName) {
          return json({ ok:false, error:"BACKUP_UPLOAD_NOT_CONFIRMED" }, 502, headers);
        }
        return json({ ok:true, fileId:uploaded.id, fileName:uploaded.name, byteLength:bytes.length, sha256:actualDigest, destinationVerified:true }, 200, headers);
      }

      if (pathname === "/api/account-backup/verify") {
        const body = await request.json().catch(() => null);
        const fileId = String(body?.fileId || "").trim();
        const expectedDigest = String(body?.sha256 || "").toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(expectedDigest) || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) {
          return json({ ok:false, error:"INVALID_BACKUP_VERIFICATION_REQUEST" }, 400, headers);
        }
        const metadataResponse = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?fields=id,name,mimeType,parents,trashed", { headers:{ Authorization:"Bearer " + accessToken } });
        const metadata = await metadataResponse.json().catch(() => ({}));
        if (!metadataResponse.ok || metadata.trashed === true || metadata.mimeType !== BACKUP_MIME || !(metadata.parents || []).includes(folderId)) {
          return json({ ok:false, error:"BACKUP_FILE_OUTSIDE_CUSTODIAN_FOLDER" }, 403, headers);
        }
        const download = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media", { headers:{ Authorization:"Bearer " + accessToken } });
        if (!download.ok) return json({ ok:false, error:"BACKUP_READBACK_FAILED" }, 502, headers);
        const bytes = new Uint8Array(await download.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_BACKUP_BYTES) return json({ ok:false, error:"BACKUP_READBACK_SIZE_INVALID" }, 502, headers);
        const actualDigest = await sha256Hex(bytes);
        if (actualDigest !== expectedDigest) return json({ ok:false, error:"BACKUP_READBACK_DIGEST_MISMATCH" }, 409, headers);
        return json({ ok:true, verified:true, fileName:metadata.name, byteLength:bytes.length, sha256:actualDigest, destinationVerified:true }, 200, headers);
      }
      return json({ ok:false, error:"NOT_FOUND" }, 404, headers);
    } catch (error) {
      const status = Number(error?.status) || 503;
      return json({ ok:false, error:status === 401 ? "AUTHENTICATION_REQUIRED" : "ACCOUNT_BACKUP_GATEWAY_FAILED" }, status, headers);
    }
  };
}

async function verifyCustodianFolder(accessToken, folderId, custodianEmail) {
  const response = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(folderId) + "?fields=id,name,mimeType,trashed,owners(emailAddress)", { headers:{ Authorization:"Bearer " + accessToken } });
  const folder = await response.json().catch(() => ({}));
  const owners = Array.isArray(folder.owners) ? folder.owners.map(x => String(x.emailAddress || "").toLowerCase()) : [];
  if (!response.ok || folder.id !== folderId || folder.name !== BACKUP_FOLDER_NAME ||
      folder.mimeType !== "application/vnd.google-apps.folder" || folder.trashed === true || !owners.includes(custodianEmail)) {
    return { ok:false, error:"BACKUP_FOLDER_CUSTODY_OR_ACCESS_CHECK_FAILED" };
  }
  const permissions = [];
  let pageToken = "";
  do {
    const permissionUrl = new URL("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(folderId) + "/permissions");
    permissionUrl.searchParams.set("fields", "permissions(type,emailAddress,domain,role,permissionDetails),nextPageToken");
    permissionUrl.searchParams.set("pageSize", "100");
    if (pageToken) permissionUrl.searchParams.set("pageToken", pageToken);
    const permissionsResponse = await fetch(permissionUrl.toString(), { headers:{ Authorization:"Bearer " + accessToken } });
    const permissionData = await permissionsResponse.json().catch(() => ({}));
    if (!permissionsResponse.ok) return { ok:false, error:"BACKUP_FOLDER_PERMISSION_CHECK_FAILED" };
    permissions.push(...(permissionData.permissions || []));
    pageToken = permissionData.nextPageToken || "";
    if (permissions.length > 1000) return { ok:false, error:"BACKUP_FOLDER_PERMISSION_SET_EXCEEDS_SAFE_LIMIT" };
  } while (pageToken);
  const safeOwnerOnly = permissions.length === 1 &&
    permissions[0].type === "user" &&
    String(permissions[0].emailAddress || "").toLowerCase() === custodianEmail &&
    permissions[0].role === "owner";
  if (!safeOwnerOnly) return { ok:false, error:"BACKUP_FOLDER_HAS_UNAUTHORISED_ACCESS" };
  return { ok:true };
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
