const { RoomServiceClient } = require("livekit-server-sdk");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const endpoint = required("LIVEKIT_URL");
  const apiKey = required("LIVEKIT_API_KEY");
  const apiSecret = required("LIVEKIT_API_SECRET");
  const parsed = new URL(endpoint);
  if (!["wss:", "ws:", "https:", "http:"].includes(parsed.protocol)) {
    throw new Error("LIVEKIT_URL must use wss:// (production) or ws:// (local testing).");
  }
  if (parsed.protocol === "ws:" || parsed.protocol === "http:") {
    throw new Error("Insecure LiveKit URL rejected. Use wss:// for a deployed endpoint.");
  }
  const client = new RoomServiceClient(endpoint, apiKey, apiSecret);
  const rooms = await client.listRooms();
  console.log(JSON.stringify({
    ok: true,
    check: "livekit-control-plane-authenticated",
    endpoint: `${parsed.protocol}//${parsed.host}`,
    authenticatedApiRequest: true,
    visibleRoomCount: rooms.length
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    check: "livekit-control-plane-authenticated",
    error: error?.message || "Unknown verification failure"
  }, null, 2));
  process.exitCode = 1;
});
