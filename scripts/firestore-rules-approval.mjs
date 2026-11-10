import { readFile } from "node:fs/promises";

const API = "https://api.github.com";
const LABEL = "firestore-rules-approved";
const COMMENT_MARKER = "<!-- firestore-rules-approval-gate -->";
const REQUIRED_COMMENT = "firestore.rules changed. Production security rules deploy on merge to main. Owner approval is required: the repository owner adds the 'firestore-rules-approved' label after reviewing the diff. This label is the only approval.";

function latestByTime(items) {
  return [...items].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).at(-1);
}

export function evaluateApproval({ changedFiles, labels, labelEvents, rulesCommitEvents, allowedActors, apiError }) {
  if (apiError) return { pass: false, reason: `GitHub API verification failed closed: ${apiError}` };
  if (!Array.isArray(changedFiles) || !Array.isArray(labels) || !Array.isArray(labelEvents) ||
      !Array.isArray(rulesCommitEvents) || !Array.isArray(allowedActors)) {
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
  if (rulesCommitEvents.length === 0 || rulesCommitEvents.some(e => !e.created_at || !e.commit_id)) {
    return { pass: false, reason: "Cannot establish the server-recorded time of every rules-changing commit; failing closed." };
  }
  const latestRulesCommit = latestByTime(rulesCommitEvents);
  if (Date.parse(latestLabelEvent.created_at) <= Date.parse(latestRulesCommit.created_at)) {
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

async function loadApprovers() {
  const raw = await readFile(".github/firestore-rules-approvers.txt", "utf8");
  const logins = raw.split(/\r?\n/).map(line => line.replace(/#.*$/, "").trim()).filter(Boolean);
  if (!logins.includes("irpa2412-bit")) throw new Error("Approver allow-list must include repository owner irpa2412-bit.");
  return [...new Set(logins)];
}

async function upsertFailureComment({ repo, prNumber, token, reason }) {
  const [owner, name] = repo.split("/");
  const base = `${API}/repos/${owner}/${name}`;
  const comments = await apiPages(`${base}/issues/${prNumber}/comments?per_page=100`, token);
  const existing = comments.find(comment => comment.body?.includes(COMMENT_MARKER));
  const body = [COMMENT_MARKER, REQUIRED_COMMENT, "", `Rules diff: https://github.com/${repo}/pull/${prNumber}/files`, "", `Gate result: ${reason}`].join("\n");
  if (existing) await apiJson(`${base}/issues/comments/${existing.id}`, token, "PATCH", { body });
  else await apiJson(`${base}/issues/${prNumber}/comments`, token, "POST", { body });
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
      loadApprovers()
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
    const rulesCommitEvents = timeline
      .filter(event => event.event === "committed" && rulesCommitIds.includes(event.commit_id))
      .map(event => ({ commit_id: event.commit_id, created_at: event.created_at }));
    if (rulesCommitEvents.length !== rulesCommitIds.length) {
      throw new Error("GitHub PR timeline did not provide a server-timestamped committed event for every firestore.rules-changing commit.");
    }
    const result = evaluateApproval({
      changedFiles, labels: (pr.labels || []).map(label => label.name),
      labelEvents: events, rulesCommitEvents, allowedActors
    });
    if (result.pass) { console.log(`PASS: ${result.reason}`); return; }
    console.error(`FAIL: ${result.reason}`);
    await upsertFailureComment({ repo, prNumber, token, reason: result.reason });
    console.log("Updated the single Firestore rules approval comment.");
    process.exitCode = 1;
  } catch (error) {
    const reason = `GitHub API/evidence error; fail closed. ${error.message}`;
    console.error(`::error::${reason}`);
    try {
      await upsertFailureComment({ repo, prNumber, token, reason });
      console.error("Updated the single Firestore rules approval comment.");
    } catch (commentError) {
      console.error(`::error::Could not post/update the approval comment: ${commentError.message}`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
