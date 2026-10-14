const crypto = require("node:crypto");
const { RoomServiceClient, EgressClient, EncodedFileOutput, EncodedFileType } = require("livekit-server-sdk");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const endpoint = required("LIVEKIT_URL");
  const apiKey = required("LIVEKIT_API_KEY");
  const apiSecret = required("LIVEKIT_API_SECRET");
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "wss:" && parsed.protocol !== "https:") {
    throw new Error("Staging recording verification requires a secure wss:// or https:// endpoint.");
  }
  const host = endpoint.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  const roomService = new RoomServiceClient(host, apiKey, apiSecret);
  const egress = new EgressClient(host, apiKey, apiSecret);
  const suffix = crypto.randomBytes(8).toString("hex");
  const roomName = `irpa-staging-recording-check-${suffix}`;
  const filepath = `irpa-governance-recordings/staging-validation/${suffix}/verification.mp4`;
  let egressId = "";
  try {
    await roomService.createRoom({ name: roomName, emptyTimeout: 60, maxParticipants: 2 });
    const started = await egress.startRoomCompositeEgress(
      roomName,
      { file: new EncodedFileOutput({ filepath, fileType: EncodedFileType.MP4 }) },
      { layout: "grid", audioOnly: false }
    );
    egressId = String(started.egressId || "");
    if (!egressId) throw new Error("LiveKit Egress did not return an egress ID.");
    await wait(8000);
    await egress.stopEgress(egressId);
    let final = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const rows = await egress.listEgress("", egressId);
      final = rows.find(row => String(row.egressId) === egressId) || final;
      const state = Number(final?.status);
      if ([3, 4, 5, 6].includes(state)) break;
      await wait(2500);
    }
    if (!final || Number(final.status) !== 3) {
      throw new Error(`Staging Egress did not complete successfully (status=${String(final?.status ?? "UNKNOWN")}).`);
    }
    const files = Array.isArray(final.fileResults) ? final.fileResults : [];
    const stored = files.find(file => String(file.location || "").length > 0 && Number(file.size || 0) > 0);
    if (!stored) throw new Error("Egress completed without a verified non-empty output object location. Storage is not verified.");
    console.log(JSON.stringify({
      ok: true,
      check: "livekit-staging-recording-storage",
      egressCompleted: true,
      fileObjectVerified: true,
      roomName,
      egressId,
      expectedPathPrefix: "irpa-governance-recordings/staging-validation/",
      storedObject: {
        filename: String(stored.filename || ""),
        location: String(stored.location || ""),
        sizeBytes: Number(stored.size || 0)
      }
    }, null, 2));
  } finally {
    if (egressId) {
      try {
        const rows = await egress.listEgress("", egressId);
        const current = rows.find(row => String(row.egressId) === egressId);
        if (current && ![3, 4, 5, 6].includes(Number(current.status))) await egress.stopEgress(egressId);
      } catch {}
    }
    try { await roomService.deleteRoom(roomName); } catch {}
  }
}
main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    check: "livekit-staging-recording-storage",
    error: error?.message || "Unknown staging recording/storage verification failure"
  }, null, 2));
  process.exitCode = 1;
});
