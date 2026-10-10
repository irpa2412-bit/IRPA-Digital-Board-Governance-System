// IRPA-DGBS Cloudflare migration boundary.
// This endpoint is intentionally inert until verified Cloudflare bindings are available.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__irpa/cloudflare/health") {
      return Response.json({
        service: "IRPA-DGBS",
        layer: "cloudflare-migration-boundary",
        status: "ready-for-configuration",
        environment: env.IRPA_DGBS_ENV || "unknown"
      });
    }
    return new Response("IRPA-DGBS Cloudflare migration boundary is not enabled for production.", {
      status: 404,
      headers: { "cache-control": "no-store" }
    });
  }
};
