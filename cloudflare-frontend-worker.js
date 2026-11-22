export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__irpa_health") {
      return new Response(JSON.stringify({
        ok: true,
        service: "IRPA-DBGS frontend static assets",
        backendMode: "firebase-auth-and-firestore-retained"
      }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }
    return env.ASSETS.fetch(request);
  }
};
