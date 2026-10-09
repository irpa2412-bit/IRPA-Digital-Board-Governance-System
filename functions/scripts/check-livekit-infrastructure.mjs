const { RoomServiceClient, AccessToken } = require("livekit-server-sdk");
const crypto = require("node:crypto");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Required environment variable ${name} is missing.`);
  return value;
}

async function main() {
  const configuredUrl = required("LIVEKIT_URL");
  const apiKey = required("LIVEKIT_API_KEY");
  const apiSecret = required("LIVEKIT_API_SECRET");

  const apiUrl = configuredUrl.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  const parsed = new URL(apiUrl);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("LIVEKIT_URL must use wss:// or https:// for a deployed endpoint.");
  }
  if (parsed.protocol !== "https:" && process.env.ALLOW_INSECURE_LIVEKIT_SMOKE_TEST !== "true") {
    throw new Error("Refusing an insecure LiveKit endpoint. Use wss:///https:// or explicitly opt in for local development.");
  }

  const service = new RoomServiceClient(apiUrl, apiKey, apiSecret);
  const roomName = `irpa-infra-smoke-${crypto.randomUUID()}`;
  let created = false;

  try {
    const room = await service.createRoom({
      name: roomName,
      emptyTimeout: 60,
      maxParticipants: 2,
      metadata: JSON.stringify({ purpose: "IRPA infrastructure smoke test", ephemeral: true })
    });
    created = true;

    const hostToken = new AccessToken(apiKey, apiSecret, {
      identity: `probe-host-${crypto.randomUUID()}`,
      ttl: "5m"
    });
    hostToken.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

    const guestToken = new AccessToken(apiKey, apiSecret, {
      identity: `probe-guest-${crypto.randomUUID()}`,
      ttl: "5m"
    });
    guestToken.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

    const rooms = await service.listRooms([roomName]);
    if (!rooms.some(item => item.name === roomName)) {
      throw new Error("LiveKit API accepted room creation but the room could not be read back.");
    }

    const hostJwt = await hostToken.toJwt();
    const guestJwt = await guestToken.toJwt();
    if (hostJwt.split(".").length !== 3 || guestJwt.split(".").length !== 3) {
      throw new Error("Unable to construct the two short-lived room-scoped participant tokens.");
    }

    console.log(JSON.stringify({
      ok: true,
      endpoint: parsed.origin,
      tls: parsed.protocol === "https:",
      apiCredentialsAccepted: true,
      roomCreateAndReadback: true,
      scopedShortLivedTokensConstructed: true,
      participantCountLimit: room.maxParticipants,
      temporaryRoom: roomName,
      mediaPlaneVerified: false,
      note: "This API probe does not establish a WebRTC media session."
    }, null, 2));
  } finally {
    if (created) {
      try {
        await service.deleteRoom(roomName);
        console.log(JSON.stringify({ cleanup: "temporary room deleted", room: roomName }));
      } catch (error) {
        console.error(JSON.stringify({
          cleanup: "FAILED",
          room: roomName,
          error: String(error?.message || error)
        }));
        process.exitCode = 2;
      }
    }
  }
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: String(error?.message || error),
    secretsPrinted: false
  }, null, 2));
  process.exitCode = 1;
});
