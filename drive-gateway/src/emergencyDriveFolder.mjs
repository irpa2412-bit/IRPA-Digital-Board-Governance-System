import { sha256Hex } from "./util.mjs";

export const EMERGENCY_DRIVE_FOLDER_NAME = "IRPA EMERGENCY RETRIEVAL (UNARCHIVED)";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const APP_MARKER = "irpa-emergency-retrieval-v1";

export class EmergencyDriveError extends Error {
  constructor(message, { status = 502, reasonCode = "DRIVE_REQUEST_FAILED", folderId = null } = {}) {
    super(message);
    this.name = "EmergencyDriveError";
    this.status = status;
    this.reasonCode = reasonCode;
    this.folderIdMasked = folderId ? "…" + String(folderId).slice(-6) : null;
  }
}

const safeReason = data => String(data?.error?.errors?.[0]?.reason || data?.error?.status || "DRIVE_REQUEST_FAILED")
  .replace(/[^A-Z0-9_.-]/gi, "").slice(0, 80) || "DRIVE_REQUEST_FAILED";
const maskId = value => value ? "…" + String(value).slice(-6) : null;
const escapeQuery = value => String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function eatIsoTimestamp(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Dar_es_Salaam",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const part = name => parts.find(item => item.type === name)?.value || "00";
  return part("year") + "-" + part("month") + "-" + part("day") + "T" +
    part("hour") + ":" + part("minute") + ":" + part("second") + "+03:00";
}

async function driveRequest(token, path, options = {}, folderId = null) {
  let response, data = {};
  try {
    response = await fetch("https://www.googleapis.com" + path, {
      ...options,
      headers: { Authorization: "Bearer " + token, ...(options.headers || {}) }
    });
    const raw = await response.text();
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  } catch {
    throw new EmergencyDriveError("Google Drive could not be reached.", {
      status: 503, reasonCode: "DRIVE_NETWORK_UNAVAILABLE", folderId
    });
  }
  if (!response.ok) {
    throw new EmergencyDriveError("Google Drive rejected the emergency retrieval operation.", {
      status: response.status, reasonCode: safeReason(data), folderId
    });
  }
  return data;
}

async function listAll(token, query, fields, folderId = null) {
  const files = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      q: query, corpora: "user", spaces: "drive", pageSize: "1000",
      supportsAllDrives: "true", includeItemsFromAllDrives: "true",
      fields: "nextPageToken,files(" + fields + ")"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await driveRequest(token, "/drive/v3/files?" + params.toString(), {}, folderId);
    files.push(...(Array.isArray(result.files) ? result.files : []));
    pageToken = result.nextPageToken || null;
  } while (pageToken);
  return files;
}

async function getDriveScopeSet(token, folderId = null) {
  const form = new URLSearchParams({ access_token: token });
  const result = await driveRequest(token, "/drive/v3/about?fields=user(emailAddress,permissionId)", {}, folderId);
  let scopes = [];
  try {
    const response = await fetch("https://oauth2.googleapis.com/tokeninfo", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("TOKENINFO_FAILED");
    scopes = String(data.scope || "").split(/\\s+/).filter(Boolean);
  } catch {
    throw new EmergencyDriveError("The Drive credential scopes could not be verified.", {
      status: 403, reasonCode: "DRIVE_SCOPE_VERIFICATION_FAILED", folderId
    });
  }
  const hasMetadataRead = scopes.includes("https://www.googleapis.com/auth/drive.metadata.readonly") ||
    scopes.includes("https://www.googleapis.com/auth/drive");
  const hasFileWrite = scopes.includes("https://www.googleapis.com/auth/drive.file") ||
    scopes.includes("https://www.googleapis.com/auth/drive");
  if (!hasMetadataRead || !hasFileWrite) {
    throw new EmergencyDriveError("The current Drive authorization cannot safely verify all same-name folders and create the emergency bundle.", {
      status: 403, reasonCode: "INSUFFICIENT_DRIVE_SCOPE", folderId
    });
  }
  const email = String(result.user?.emailAddress || "").trim().toLowerCase();
  if (!email) throw new EmergencyDriveError("The IRPA Drive account could not be identified.", {
    status: 403, reasonCode: "DRIVE_ACCOUNT_NOT_VERIFIED", folderId
  });
  return { email };
}

async function listPermissions(token, folderId) {
  const result = await driveRequest(token,
    "/drive/v3/files/" + encodeURIComponent(folderId) +
    "/permissions?supportsAllDrives=true&pageSize=100&fields=permissions(id,type,emailAddress,role,deleted)",
    {}, folderId);
  return Array.isArray(result.permissions) ? result.permissions.filter(p => p.deleted !== true) : [];
}

async function ensurePrivateFolder(token, { ownerEmail, envelopeId }) {
  const account = await getDriveScopeSet(token);
  const driveEmail = account.email;
  const normalizedOwner = String(ownerEmail || "").trim().toLowerCase();
  if (!normalizedOwner || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalizedOwner)) {
    throw new EmergencyDriveError("The authenticated envelope owner's email is unavailable.", {
      status: 403, reasonCode: "OWNER_EMAIL_NOT_VERIFIED"
    });
  }
  const root = await driveRequest(token, "/drive/v3/files/root?fields=id");
  const rootId = String(root.id || "");
  if (!rootId) throw new EmergencyDriveError("The IRPA Drive root could not be verified.", {
    status: 409, reasonCode: "DRIVE_ROOT_NOT_VERIFIED"
  });
  const query = "name='" + escapeQuery(EMERGENCY_DRIVE_FOLDER_NAME) + "' and mimeType='" + FOLDER_MIME + "' and trashed=false";
  const matches = await listAll(token, query, "id,name,mimeType,parents,owners(emailAddress),createdTime,appProperties,description");
  if (matches.length > 1) throw new EmergencyDriveError("More than one emergency folder has this exact name; no folder was selected.", {
    status: 409, reasonCode: "MULTIPLE_EMERGENCY_FOLDER_MATCHES"
  });
  let folder = matches[0] || null;
  if (folder) {
    const marker = folder.appProperties || {};
    const owners = (folder.owners || []).map(item => String(item.emailAddress || "").toLowerCase());
    if (marker.irpaEmergencyFolder !== APP_MARKER || marker.irpaEnvelopeId !== envelopeId ||
        marker.irpaCreatedBy !== "irpa-google-drive-gateway" || !owners.includes(driveEmail) ||
        !folder.createdTime) {
      throw new EmergencyDriveError("The matching folder was not verifiably created by this application for this envelope.", {
        status: 409, reasonCode: "EMERGENCY_FOLDER_CREATOR_MISMATCH", folderId: folder.id
      });
    }
    const parents = Array.isArray(folder.parents) ? folder.parents : [];
    if (parents.length !== 1 || parents[0] !== rootId) {
      throw new EmergencyDriveError("The matching folder is not separate from the official archive root.", {
        status: 409, reasonCode: "EMERGENCY_FOLDER_NOT_SEPARATE", folderId: folder.id
      });
    }
  } else {
    folder = await driveRequest(token, "/drive/v3/files?fields=id,name,parents,owners(emailAddress),createdTime,appProperties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: EMERGENCY_DRIVE_FOLDER_NAME,
        mimeType: FOLDER_MIME,
        parents: [rootId],
        description: "Private, unarchived emergency retrieval folder. Not the official IRPA document archive.",
        appProperties: {
          irpaEmergencyFolder: APP_MARKER,
          irpaCreatedBy: "irpa-google-drive-gateway",
          irpaEnvelopeId: envelopeId,
          irpaDataEnvironment: "TRIAL"
        }
      })
    });
    if (!folder.id) throw new EmergencyDriveError("Google Drive did not return the new emergency folder ID.", {
      status: 502, reasonCode: "EMERGENCY_FOLDER_CREATE_RESPONSE_INVALID"
    });
    const owners = (folder.owners || []).map(item => String(item.emailAddress || "").toLowerCase());
    if (!owners.includes(driveEmail)) throw new EmergencyDriveError("The new emergency folder is not owned by the IRPA Drive account.", {
      status: 409, reasonCode: "EMERGENCY_FOLDER_OWNER_MISMATCH", folderId: folder.id
    });
  }

  let permissions = await listPermissions(token, folder.id);
  const permitted = new Set([driveEmail, normalizedOwner]);
  if (permissions.some(p => p.type !== "user" || !permitted.has(String(p.emailAddress || "").toLowerCase()))) {
    throw new EmergencyDriveError("The emergency folder has access granted to an account other than the IRPA Drive account and the envelope owner.", {
      status: 409, reasonCode: "EMERGENCY_FOLDER_ACCESS_NOT_PRIVATE", folderId: folder.id
    });
  }
  const ownerPermission = permissions.find(p => String(p.emailAddress || "").toLowerCase() === normalizedOwner);
  if (normalizedOwner !== driveEmail && !ownerPermission) {
    await driveRequest(token, "/drive/v3/files/" + encodeURIComponent(folder.id) +
      "/permissions?sendNotificationEmail=false&supportsAllDrives=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user", role: "reader", emailAddress: normalizedOwner })
    }, folder.id);
    permissions = await listPermissions(token, folder.id);
  }
  const finalEmails = permissions.map(p => String(p.emailAddress || "").toLowerCase());
  if (permissions.some(p => p.type !== "user" || !permitted.has(String(p.emailAddress || "").toLowerCase())) ||
      (normalizedOwner !== driveEmail && !finalEmails.includes(normalizedOwner))) {
    throw new EmergencyDriveError("The emergency folder's final permissions could not be verified as owner-only.", {
      status: 409, reasonCode: "EMERGENCY_FOLDER_ACCESS_VERIFICATION_FAILED", folderId: folder.id
    });
  }
  return { id: folder.id, idMasked: maskId(folder.id), driveEmail, ownerEmail: normalizedOwner };
}

async function findNamedFiles(token, folderId, name) {
  const query = "'" + escapeQuery(folderId) + "' in parents and name='" + escapeQuery(name) + "' and trashed=false";
  return listAll(token, query, "id,name,mimeType,parents,appProperties,createdTime");
}

async function readFileBytes(token, fileId, folderId) {
  const response = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media", {
    headers: { Authorization: "Bearer " + token }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new EmergencyDriveError("An existing emergency file could not be verified.", {
      status: response.status, reasonCode: safeReason(data), folderId
    });
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function uploadFile(token, folderId, file, envelopeId, generatedAtEAT) {
  const boundary = "irpa-emergency-" + crypto.randomUUID();
  const encoder = new TextEncoder();
  const metadata = {
    name: file.name,
    mimeType: file.contentType,
    parents: [folderId],
    description: "Unarchived emergency retrieval copy. Not part of the official archive.",
    appProperties: {
      irpaEmergencyFile: APP_MARKER,
      irpaCreatedBy: "irpa-google-drive-gateway",
      irpaEnvelopeId: envelopeId,
      irpaDataEnvironment: "TRIAL",
      irpaBundleRole: file.role,
      irpaSha256: file.hash,
      irpaGeneratedAtEAT: generatedAtEAT
    }
  };
  const head = encoder.encode("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) + "\r\n--" + boundary + "\r\nContent-Type: " + file.contentType + "\r\n\r\n");
  const tail = encoder.encode("\r\n--" + boundary + "--");
  const body = new Uint8Array(head.length + file.bytes.length + tail.length);
  body.set(head);
  body.set(file.bytes, head.length);
  body.set(tail, head.length + file.bytes.length);
  const result = await driveRequest(token,
    "/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,parents,appProperties",
    {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body
    }, folderId);
  if (!result.id) throw new EmergencyDriveError("Google Drive did not confirm the uploaded emergency file.", {
    status: 502, reasonCode: "EMERGENCY_FILE_CREATE_RESPONSE_INVALID", folderId
  });
  return { id: result.id, idMasked: maskId(result.id), name: file.name, reused: false, hash: file.hash };
}

export async function saveEmergencyDriveBundle({ env, helpers, envelopeId, title, ownerEmail, pdfBytes, pdfHash, buildEvidenceReport, now = new Date() } = {}) {
  let token;
  try { token = await helpers.getDriveAccessToken(env); }
  catch (error) {
    throw new EmergencyDriveError("The IRPA Drive credential could not be refreshed.", {
      status: 401, reasonCode: String(error?.code || error?.name || "TOKEN_REFRESH_FAILED").replace(/[^A-Z0-9_.-]/g, "").slice(0, 80) || "TOKEN_REFRESH_FAILED"
    });
  }
  const folder = await ensurePrivateFolder(token, { ownerEmail, envelopeId });
  const cleanTitle = String(title || "Untitled document").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\\s+/g, " ").trim().slice(0, 120) || "Untitled document";
  const names = {
    pdf: cleanTitle + " - UNARCHIVED EMERGENCY COPY.pdf",
    report: cleanTitle + " - evidence report.pdf",
    hash: cleanTitle + " - SHA256.txt"
  };
  const fileRows = [];
  for (const role of ["pdf", "report", "hash"]) {
    const matches = await findNamedFiles(token, folder.id, names[role]);
    if (matches.length > 1) throw new EmergencyDriveError("Duplicate files exist for " + names[role] + "; no file was selected.", {
      status: 409, reasonCode: "DUPLICATE_EMERGENCY_FILE_MATCHES", folderId: folder.id
    });
    fileRows.push({ role, name: names[role], existing: matches[0] || null });
  }
  const existingTimes = [...new Set(fileRows.map(row => row.existing?.appProperties?.irpaGeneratedAtEAT).filter(Boolean))];
  if (existingTimes.length > 1) throw new EmergencyDriveError("Existing emergency files contain conflicting generated-time metadata.", {
    status: 409, reasonCode: "EMERGENCY_FILE_METADATA_CONFLICT", folderId: folder.id
  });
  const generatedAtEAT = existingTimes[0] || eatIsoTimestamp(now);
  const reportBytes = await buildEvidenceReport(generatedAtEAT);
  const hashText = [
    "SHA-256: " + pdfHash,
    "Envelope: " + envelopeId,
    "Environment: TRIAL",
    "Generated: " + generatedAtEAT + " EAT",
    "Status: UNARCHIVED EMERGENCY COPY, envelope is not yet Completed"
  ].join("\n") + "\n";
  const hashBytes = new TextEncoder().encode(hashText);
  const files = [
    { role: "pdf", name: names.pdf, bytes: pdfBytes, contentType: "application/pdf", hash: pdfHash },
    { role: "report", name: names.report, bytes: reportBytes, contentType: "application/pdf", hash: await sha256Hex(reportBytes) },
    { role: "hash", name: names.hash, bytes: hashBytes, contentType: "text/plain", hash: await sha256Hex(hashBytes) }
  ];
  for (const row of fileRows) {
    const file = files.find(item => item.role === row.role);
    if (!row.existing) continue;
    const props = row.existing.appProperties || {};
    if (props.irpaEmergencyFile !== APP_MARKER || props.irpaCreatedBy !== "irpa-google-drive-gateway" ||
        props.irpaEnvelopeId !== envelopeId || props.irpaDataEnvironment !== "TRIAL" ||
        props.irpaBundleRole !== row.role || props.irpaSha256 !== file.hash ||
        props.irpaGeneratedAtEAT !== generatedAtEAT) {
      throw new EmergencyDriveError("An existing emergency file has a different recorded hash or application marker.", {
        status: 409, reasonCode: "EMERGENCY_FILE_HASH_OR_OWNER_CONFLICT", folderId: folder.id
      });
    }
    const existingBytes = await readFileBytes(token, row.existing.id, folder.id);
    if (await sha256Hex(existingBytes) !== file.hash) {
      throw new EmergencyDriveError("An existing emergency file's bytes do not match its recorded SHA-256.", {
        status: 409, reasonCode: "EMERGENCY_FILE_CONTENT_HASH_MISMATCH", folderId: folder.id
      });
    }
  }
  const results = [];
  for (const row of fileRows) {
    const file = files.find(item => item.role === row.role);
    if (row.existing) {
      results.push({ idMasked: maskId(row.existing.id), name: row.name, reused: true, hash: file.hash });
    } else {
      results.push(await uploadFile(token, folder.id, file, envelopeId, generatedAtEAT));
    }
  }
  return {
    folderIdMasked: folder.idMasked,
    folderName: EMERGENCY_DRIVE_FOLDER_NAME,
    files: results,
    outputHash: pdfHash,
    generatedAtEAT,
    environment: "TRIAL",
    ownerOnly: true,
    separateFromOfficialArchive: true
  };
}
