"use strict";

const { RoomServiceClient } = require("livekit-server-sdk");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    console.error("MISSING: required environment setting " + name);
    process.exit(2);
  }
  return value;
}

async function main() {
  const rawUrl = required("LIVEKIT_URL");
  const apiKey = required("LIVEKIT_API_KEY");
  const apiSecret = required("LIVEKIT_API_SECRET");
  let httpUrl;
  try {
    const normalized = rawUrl.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
    const parsed = new URL(normalized);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
    if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      throw new Error("non-local LiveKit endpoints must use TLS (wss/https)");
    }
    httpUrl = parsed.origin;
  } catch (error) {
    console.error("INVALID: LIVEKIT_URL must be a valid wss:// or https:// endpoint (" + error.message + ")");
    process.exit(2);
  }

  const client = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("LiveKit API request timed out after 10 seconds")), 10000));
  try {
    const rooms = await Promise.race([client.listRooms(), timeout]);
    console.log("PASS: LiveKit endpoint is reachable over TLS and accepted the server-side API credentials.");
    console.log("PASS: authenticated RoomService request succeeded; active rooms returned: " + (Array.isArray(rooms) ? rooms.length : 0) + ".");
    console.log("LIMIT: this does not prove browser ICE/TURN routing or real audio/video; perform the two-browser acceptance test next.");
  } catch (error) {
    console.error("FAIL: LiveKit endpoint/credentials check failed: " + String(error && error.message || error).slice(0, 500));
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error("FAIL: LiveKit preflight could not complete: " + String(error && error.message || error).slice(0, 500));
  process.exitCode = 1;
});
