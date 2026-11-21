const hosts = [
  "https://irpa-digital-board-governance.web.app/",
  "https://irpa-digital-board-governance-frontend.irpa-governance.workers.dev/"
];

function assetReferences(source, baseUrl, kind) {
  const refs = [];
  if (kind === "html") {
    for (const match of source.matchAll(/<(?:script|link)\\b[^>]*?(?:src|href)=["']([^"']+\\.(?:m?js|css)(?:\\?[^"']*)?)["'][^>]*>/gi)) refs.push(new URL(match[1], baseUrl).href);
  } else if (kind === "js") {
    const pattern = /(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*)["']([^"']+\\.(?:m?js|css)(?:\\?[^"']*)?)["']/g;
    for (const match of source.matchAll(pattern)) if (!match[1].startsWith("data:")) refs.push(new URL(match[1], baseUrl).href);
  } else if (kind === "css") {
    for (const match of source.matchAll(/@import\\s+(?:url\\()?["']?([^"')]+\\.css(?:\\?[^"')]+)?)["']?\\)?/gi)) refs.push(new URL(match[1], baseUrl).href);
  }
  return refs;
}

for (const host of hosts) {
  const root = await fetch(host, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (root.status !== 200) throw new Error(host + " returned HTTP " + root.status);
  const html = await root.text();
  const queue = assetReferences(html, host, "html");
  const visited = new Set();
  while (queue.length) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
    if (response.status !== 200) throw new Error(host + " asset " + url + " returned HTTP " + response.status);
    const source = await response.text();
    const pathname = new URL(url).pathname;
    const kind = pathname.endsWith(".css") ? "css" : "js";
    queue.push(...assetReferences(source, url, kind));
  }
  if (!visited.size) throw new Error(host + " did not expose any JS/CSS assets.");
  console.log(JSON.stringify({ host, rootStatus: root.status, assetCount: visited.size, allImportedAssetsHttp200: true }));
}
console.log("PASS: entry bundles and recursively imported JS/CSS chunks returned HTTP 200 on both public production hosts.");
