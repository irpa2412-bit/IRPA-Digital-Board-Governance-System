
      if (url.pathname === "/oauth/callback" && request.method === "GET") {
        return await oauthCallback(request, env);
      }

      // Normalize trailing slashes so portal upload/archive actions cannot be blocked by URL formatting.
      const pathname = url.pathname.replace(/\\/+$/, "") || "/";

      if (pathname === "/api/upload" && request.method === "POST") {
        return await upload(request, env);
      }
