const API = "https://api.github.com";
const LABEL = "firestore-rules-approved";

function latestByTime(items) {
  return [...items].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).at(-1);
}

export function evaluateApproval({ changedFiles, labels, labelEvents, timeline, rulesCommitIds, allowedActors, apiError }) {
  if (apiError) return { pass: false, reason: `GitHub API verification failed closed: ${apiError}` };
  if (!Array.isArray(changedFiles) || !Array.isArray(labels) || !Array.isArray(labelEvents) ||
      !Array.isArray(timeline) || !Array.isArray(rulesCommitIds) || !Array.isArray(allowedActors)) {
    return { pass: false, reason: "Required approval evidence is incomplete; failing closed." };
  }
  if (!changedFiles.includes("firestore.rules")) return { pass: true, reason: "firestore.rules unchanged." };
  if (!labels.includes(LABEL)) return { pass: false, reason: "firestore.rules changed but the required approval label is absent." };

  const relevant = labelEvents.filter(e => e.label?.name === LABEL && ["labeled", "unlabeled"].includes(e.event));
  const latestLabelEvent = latestByTime(relevant);
  if (!latestLabelEvent || latestLabelEvent.event !== "labeled") {
    return { pass: false, reason: "The approval label is not currently backed by a latest label-applied event." };
  }
  const actor = latestLabelEvent.actor?.login;
  if (!actor || !allowedActors.includes(actor)) {
    return { pass: false, reason: `Approval label was applied by unauthorized actor: ${actor || "unknown"}.` };
  }
  if (!latestLabelEvent.id || rulesCommitIds.length === 0) {
    return { pass: false, reason: "Cannot establish the PR event order for the approval and rules commits; failing closed." };
  }
  const labelIndex = timeline.findIndex(event => event.id === latestLabelEvent.id && event.event === "labeled");
  const rulesCommitIndexes = rulesCommitIds.map(sha => timeline.findIndex(event => event.event === "committed" && event.sha === sha));
  if (labelIndex < 0 || rulesCommitIndexes.some(index => index < 0)) {
    return { pass: false, reason: "GitHub timeline is missing the approval event or a rules-changing commit; failing closed." };
  }
  if (labelIndex <= Math.max(...rulesCommitIndexes)) {
    return { pass: false, reason: "approval is stale; re-apply the label after reviewing the latest diff" };
  }
  return { pass: true, reason: `Valid approval by @${actor} after the latest firestore.rules commit.` };
}

function apiHeaders(token) {
  return { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" };
}

async function apiJson(url, token, method = "GET", body) {
  const response = await fetch(url, {
    method, headers: { ...apiHeaders(token), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`GitHub API ${method} ${url} returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  try { return raw ? JSON.parse(raw) : null; } catch { throw new Error(`GitHub API returned invalid JSON for ${url}`); }
}

function nextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] === "next") return match[1];
  }
  return null;
}

async function apiPages(url, token) {
  const all = [];
  let next = url, pages = 0;
  while (next) {
    if (++pages > 100) throw new Error("GitHub API pagination exceeded 100 pages.");
    const response = await fetch(next, { headers: apiHeaders(token) });
    const raw = await response.text();
    if (!response.ok) throw new Error(`GitHub API GET ${next} returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
    let page;
    try { page = JSON.parse(raw); } catch { throw new Error(`GitHub API returned invalid JSON for ${next}`); }
    if (!Array.isArray(page)) throw new Error(`Expected a paginated array from ${next}`);
    all.push(...page);
    next = nextLink(response.headers.get("link"));
  }
  return all;
}

async function loadApprovers(base, token) {
  const file = await apiJson(base + "/contents/.github/firestore-rules-approvers.txt?ref=main", token);
  if (file.encoding !== "base64" || !file.content) throw new Error("Base-branch approver allow-list was not readable.");
  const raw = Buffer.from(file.content, "base64").toString("utf8");
  const logins = raw.split(/\r?\n/).map(line => line.replace(/#.*$/, "").trim()).filter(Boolean);
  if (!logins.includes("irpa2412-bit")) throw new Error("Approver allow-list must include repository owner irpa2412-bit.");
  return [...new Set(logins)];
}


async function main() {
  const token = process.env.GH_TOKEN, repo = process.env.REPO, prNumber = process.env.PR_NUMBER;
  if (!token || !repo || !/^\d+$/.test(prNumber || "")) throw new Error("GH_TOKEN, REPO and numeric PR_NUMBER are required.");
  const [owner, name] = repo.split("/");
  const base = `${API}/repos/${owner}/${name}`;
  try {
    const [changed, pr, events, commits, timeline, allowedActors] = await Promise.all([
      apiPages(`${base}/pulls/${prNumber}/files?per_page=100`, token),
      apiJson(`${base}/issues/${prNumber}`, token),
      apiPages(`${base}/issues/${prNumber}/events?per_page=100`, token),
      apiPages(`${base}/pulls/${prNumber}/commits?per_page=100`, token),
      apiPages(`${base}/issues/${prNumber}/timeline?per_page=100`, token),
      loadApprovers(base, token)
    ]);
    const changedFiles = changed.map(file => file.filename);
    if (!changedFiles.includes("firestore.rules")) {
      console.log("PASS: firestore.rules unchanged.");
      return;
    }
    const rulesCommitIds = [];
    for (const commit of commits) {
      const detail = await apiJson(`${base}/commits/${commit.sha}`, token);
      if (!Array.isArray(detail.files)) throw new Error(`Commit ${commit.sha} did not return a files array.`);
      if (detail.files.length >= 300 && !detail.files.some(file => file.filename === "firestore.rules")) {
        throw new Error(`Commit ${commit.sha} may have a truncated file list; cannot verify rules history.`);
      }
      if (detail.files.some(file => file.filename === "firestore.rules")) rulesCommitIds.push(commit.sha);
    }
    const result = evaluateApproval({
      changedFiles, labels: (pr.labels || []).map(label => label.name),
      labelEvents: events, timeline, rulesCommitIds, allowedActors
    });
    if (result.pass) { console.log(`PASS: ${result.reason}`); return; }
    console.error(`FAIL: ${result.reason}`);
    process.exitCode = 1;
  } catch (error) {
    const reason = `GitHub API/evidence error; fail closed. ${error.message}`;
    console.error(`::error::${reason}`);

    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
